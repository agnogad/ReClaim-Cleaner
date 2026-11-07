// Shell icons and thumbnails, fetched in batches and cached for the session. Rows call
// useShellImage(path) and re-render when their image arrives.

import { useEffect, useSyncExternalStore } from "react";
import { api, isDesktop } from "./api";
import { pathKey } from "./paths";
import type { ImageKind } from "./types";

const cache = new Map<string, string | null>();
const inflight = new Set<string>();
const queue = new Map<string, Set<string>>();
const subscribers = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const keyOf = (kind: ImageKind, size: number, path: string) => `${kind}|${size}|${pathKey(path)}`;

function notify() {
  version++;
  for (const f of subscribers) f();
}

function flush() {
  timer = undefined;
  for (const [group, set] of queue) {
    queue.delete(group);
    const [kind, size] = group.split("|") as [ImageKind, string];
    const paths = [...set];
    for (let i = 0; i < paths.length; i += 48) {
      const chunk = paths.slice(i, i + 48);
      const done = (map: Record<string, string | null>) => {
        for (const p of chunk) {
          const k = keyOf(kind, Number(size), p);
          cache.set(k, map[p] ?? null);
          inflight.delete(k);
        }
        notify();
      };
      api.shellImages(chunk, Number(size), kind).then(done, () => done({}));
    }
  }
}

export function requestImages(paths: string[], size: number, kind: ImageKind) {
  if (!isDesktop()) return;
  let added = false;
  for (const p of paths) {
    const k = keyOf(kind, size, p);
    if (cache.has(k) || inflight.has(k)) continue;
    inflight.add(k);
    const group = `${kind}|${size}`;
    const set = queue.get(group) ?? new Set<string>();
    set.add(p);
    queue.set(group, set);
    added = true;
  }
  if (added && timer === undefined) timer = setTimeout(flush, 30);
}

function subscribe(f: () => void) {
  subscribers.add(f);
  return () => subscribers.delete(f);
}

/** The image for `path` once loaded: a data URL, `null` when the system has none, `undefined` while loading. */
export function useShellImage(path: string | null | undefined, size = 32, kind: ImageKind = "icon"): string | null | undefined {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (path) requestImages([path], size, kind);
  }, [path, size, kind]);
  return path ? cache.get(keyOf(kind, size, path)) : null;
}
