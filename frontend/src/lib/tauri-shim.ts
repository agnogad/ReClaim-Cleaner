/**
 * The Tauri IPC surface, backed by MyGo.
 *
 * ReClaim's React code talks to the engine through `@tauri-apps/api`, which
 * calls `window.__TAURI_INTERNALS__.invoke(cmd, args)`. MyGo exposes Go
 * services as `window.mygo.call("Service.Method", ...)`. This file bridges the
 * two so that not one line of the React app has to change.
 *
 * Loaded before the app's own modules (see index.html), it installs:
 *   - `__TAURI_INTERNALS__.invoke`      -> MyGo service call
 *   - `__TAURI_INTERNALS__.transformCallback` / `unregisterCallback`
 *   - `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`
 *   - `__TAURI_INTERNALS__.convertFileSrc`
 *
 * The Go side is a single service named `Reclaim` whose `Call` method takes
 * the Tauri command name and its arguments.
 */

type Callback = (payload: unknown) => void;

interface Internals {
  invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  transformCallback: (cb: Callback, once?: boolean) => number;
  unregisterCallback: (id: number) => void;
  convertFileSrc: (path: string, protocol?: string) => string;
  metadata?: Record<string, unknown>;
}

const callbacks = new Map<number, Callback>();
let nextCallbackId = 1;

/** Tauri's own event names, which the app may listen to. */
const EVENT_PREFIX = "plugin:event|";

function registerCallback(cb: Callback, once = false): number {
  const id = nextCallbackId++;
  callbacks.set(id, once ? (payload: unknown) => {
    callbacks.delete(id);
    cb(payload);
  } : cb);
  return id;
}

/**
 * Delivers an event to the callback Tauri's `listen` registered. Called by the
 * Go side through the `Reclaim.Deliver` method, which the bridge invokes as a
 * plain function on the page.
 */
export function deliverEvent(callbackId: number, payload: unknown): void {
  const cb = callbacks.get(callbackId);
  if (cb) cb(payload);
}

interface MyGoRuntime {
  call: <T = unknown>(method: string, ...args: unknown[]) => Promise<T>;
  on: <T = unknown>(name: string, listener: (payload: T) => void) => () => void;
  platform?: string;
}

function runtime(): MyGoRuntime | null {
  const rt = (globalThis as { mygo?: MyGoRuntime }).mygo;
  return rt ?? null;
}

/**
 * Tauri command names that are not engine commands but plugin plumbing. The
 * event plugin is emulated here; everything else is forwarded to Go.
 */
async function invoke(
  cmd: string,
  args: Record<string, unknown> = {},
  _options?: unknown,
): Promise<unknown> {
  const rt = runtime();
  if (!rt) {
    throw { code: "desktop_only", message: "This view needs the ReClaim desktop app." };
  }

  // Tauri's event plugin: listen / unlisten / emit / emit_to.
  if (cmd.startsWith(EVENT_PREFIX)) {
    const action = cmd.slice(EVENT_PREFIX.length);
    if (action === "listen") {
      const event = String(args.event ?? "");
      const handlerId = Number(args.handler ?? 0);
      // Progress is the event the engine actually pushes. It arrives on
      // MyGo's own channel, so the listener is wired to that here.
      if (event === "job-progress") {
        const off = addProgressListener((payload) => deliverEvent(handlerId, payload));
        progressUnsubs.set(handlerId, off);
        return handlerId;
      }
      // Any other event is registered with Go, which pushes it itself.
      return await rt.call<number>("Reclaim.Listen", event, handlerId);
    }
    if (action === "unlisten") {
      const handlerId = Number(args.eventId ?? 0);
      const off = progressUnsubs.get(handlerId);
      if (off) {
        off();
        progressUnsubs.delete(handlerId);
        return undefined;
      }
      await rt.call("Reclaim.Unlisten", String(args.event ?? ""), handlerId);
      return undefined;
    }
    if (action === "emit" || action === "emit_to") {
      return undefined;
    }
  }

  // Dialog plugin: the app only opens folder pickers.
  if (cmd === "plugin:dialog|open") {
    const options = (args.options ?? {}) as { directory?: boolean; multiple?: boolean };
    return await rt.call<string[] | string | null>(
      "Reclaim.PickFolders",
      Boolean(options.directory),
      Boolean(options.multiple ?? false),
    );
  }

  // Opener plugin: open a URL in the browser, or reveal a path.
  if (cmd === "plugin:opener|open_url") {
    await rt.call("Reclaim.OpenUrl", String(args.url ?? ""));
    return undefined;
  }
  if (cmd === "plugin:opener|open_path") {
    await rt.call("Reclaim.OpenPath", String(args.path ?? ""));
    return undefined;
  }
  if (cmd === "plugin:opener|reveal_item_in_dir") {
    const paths = (args.paths ?? []) as string[];
    for (const p of paths) await rt.call("Reclaim.RevealPath", p);
    return undefined;
  }

  // Everything else is an engine command.
  return await rt.call("Reclaim.Call", cmd, args);
}

/**
 * `convertFileSrc` turns a local path into a URL the page can load. ReClaim
 * uses it for app icons, which the engine already returns as data URLs, so
 * this only needs to be present.
 */
function convertFileSrc(path: string, protocol = "asset"): string {
  return `${protocol}://localhost/${encodeURIComponent(path)}`;
}

const internals: Internals = {
  invoke,
  transformCallback: registerCallback,
  unregisterCallback: (id: number) => {
    callbacks.delete(id);
  },
  convertFileSrc,
  metadata: {
    currentWindow: { label: "main" },
    currentWebview: { windowLabel: "main", label: "main" },
  },
};

const w = window as unknown as {
  __TAURI_INTERNALS__?: Internals;
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener: (event: string, eventId: number) => void;
  };
};

w.__TAURI_INTERNALS__ = internals;
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {
    /* the Go side unregisters through plugin:event|unlisten */
  },
};

// The Go side calls this to hand an event to a listener.
(globalThis as Record<string, unknown>).__reclaimDeliver = deliverEvent;

/**
 * The engine pushes progress on MyGo's own event channel. Tauri's listeners
 * expect it as `job-progress`, so the two are wired together here: every
 * `listen("job-progress")` in the app is served from this one subscription.
 */
const progressListeners = new Set<Callback>();
// The unsubscribe function of each progress listener, by its Tauri id.
const progressUnsubs = new Map<number, () => void>();

function subscribeProgress(): void {
  const rt = runtime();
  if (!rt || typeof rt.on !== "function") return;
  rt.on<unknown>("reclaim:progress", (payload) => {
    for (const cb of progressListeners) {
      try {
        cb({ event: "job-progress", id: 0, payload });
      } catch {
        /* a listener that throws must not stop the others */
      }
    }
  });
}

// MyGo injects the runtime before the page's scripts run, so this is safe at
// module load; the guard is for a page opened in a plain browser.
subscribeProgress();

/** Registers a Tauri event listener for the events the engine pushes. */
export function addProgressListener(cb: Callback): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}
