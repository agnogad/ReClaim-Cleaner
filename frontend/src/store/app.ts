import { create } from "zustand";
import i18n, { applyPlatformWording, setLanguage } from "../i18n";
import { ApiError, api } from "../lib/api";
import { pageAvailable } from "../lib/platform";
import type { AnalyzeRequest, AppInfo, Drive, InstallerFile, ProgressEvent, Project, RulesPayload, ScanSummary, Settings, TargetResult } from "../lib/types";

export type PageId = "overview" | "explorer" | "large" | "duplicates" | "empty" | "junk" | "projects" | "models" | "assistants" | "downloads" | "games" | "apps" | "startup" | "tools" | "history" | "settings";

export interface Toast {
  id: number;
  tone: "positive" | "danger" | "warning" | "neutral";
  text: string;
}

interface AppState {
  page: PageId;
  ready: boolean;
  bootError: string | null;
  info: AppInfo | null;
  /** From `app_info`. Windows until it answers, which happens before anything is shown. */
  platform: string;
  drives: Drive[];
  settings: Settings | null;
  rules: RulesPayload | null;
  progress: Record<string, ProgressEvent | undefined>;
  running: Record<string, boolean>;
  junk: TargetResult[] | null;
  /** Unix seconds of the last junk scan. */
  junkAt: number | null;
  projects: Project[] | null;
  installers: InstallerFile[] | null;
  explorer: ScanSummary | null;
  /** Bumped after deletes so views re-read the explorer tree. */
  explorerVersion: number;
  /** A shortcut or jump list task asked for the quick clean review; the Overview takes it. */
  quickCleanPending: boolean;
  toasts: Toast[];

  go: (page: PageId) => void;
  boot: () => Promise<void>;
  refreshDrives: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  scanJunk: () => Promise<void>;
  scanProjects: (roots?: string[]) => Promise<void>;
  scanInstallers: () => Promise<void>;
  scanExplorer: (root: string, selection?: string[]) => Promise<ScanSummary | null>;
  /** Opens the space map for folders Explorer asked to analyze. */
  analyze: (req: AnalyzeRequest) => Promise<void>;
  /** Opens the Overview and its quick clean review, as a shortcut or jump list task asked. */
  requestQuickClean: () => void;
  scanAll: () => Promise<void>;
  setProgress: (e: ProgressEvent) => void;
  setRunning: (kind: string, on: boolean) => void;
  bumpExplorer: () => void;
  toast: (tone: Toast["tone"], text: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    return i18n.exists(key) ? `${i18n.t(key)} ${e.code === "other" || e.code === "io" ? e.message : ""}`.trim() : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function applyTheme(pref: string) {
  const root = document.documentElement;
  if (pref === "light" || pref === "dark") root.setAttribute("data-theme", pref);
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem("reclaim:theme", pref);
  } catch {
    // Not fatal: the theme still applies for this session.
  }
}

/** Project roots to search: the user's list, or the suggested ones when the list is empty. */
export function effectiveRoots(settings: Settings | null, info: AppInfo | null): string[] {
  if (settings && settings.projectRoots.length > 0) return settings.projectRoots;
  return info?.suggestedRoots ?? [];
}

export const useApp = create<AppState>((set, get) => ({
  page: "overview",
  ready: false,
  bootError: null,
  info: null,
  platform: "windows",
  drives: [],
  settings: null,
  rules: null,
  progress: {},
  running: {},
  junk: null,
  junkAt: null,
  projects: null,
  installers: null,
  explorer: null,
  explorerVersion: 0,
  quickCleanPending: false,
  toasts: [],

  // Pages a system lacks stay out of the navigation; this also covers links from anywhere else.
  go: (page) => {
    if (pageAvailable(get().platform, page)) set({ page });
  },

  boot: async () => {
    try {
      const appInfo = api.appInfo();
      // Gates and wording need the platform even if another call below fails.
      void appInfo.then(
        ({ platform }) => {
          applyPlatformWording(platform);
          set({ platform });
        },
        () => undefined,
      );
      const [info, settings, drives, rules, explorer] = await Promise.all([appInfo, api.settingsGet(), api.drives(), api.rules(), api.explorerSummary()]);
      setLanguage(settings.language);
      applyTheme(settings.theme);
      set({ info, settings, drives, rules, explorer, ready: true });
    } catch (e) {
      set({ bootError: errorText(e), ready: true });
    }
  },

  refreshDrives: async () => {
    try {
      set({ drives: await api.drives() });
    } catch {
      // Drive info is decorative here; keep the last known values.
    }
  },

  saveSettings: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      const saved = await api.settingsSet(next);
      set({ settings: saved, info: get().info ? { ...get().info!, settingsError: null } : null });
      if (patch.language) setLanguage(saved.language);
      if (patch.theme) applyTheme(saved.theme);
    } catch (e) {
      set({ settings: current });
      get().toast("danger", errorText(e));
    }
  },

  scanJunk: async () => {
    get().setRunning("junk", true);
    try {
      set({ junk: await api.junkScan(), junkAt: Date.now() / 1000 });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "cancelled")) get().toast("danger", errorText(e));
    } finally {
      get().setRunning("junk", false);
    }
  },

  scanProjects: async (roots) => {
    const list = roots ?? effectiveRoots(get().settings, get().info);
    if (list.length === 0) {
      set({ projects: [] });
      return;
    }
    get().setRunning("projects", true);
    try {
      set({ projects: await api.projectsScan(list) });
    } catch (e) {
      get().toast("danger", errorText(e));
    } finally {
      get().setRunning("projects", false);
    }
  },

  scanInstallers: async () => {
    try {
      set({ installers: await api.installersScan() });
    } catch {
      set({ installers: [] });
    }
  },

  scanExplorer: async (root, selection) => {
    get().setRunning("explorer", true);
    try {
      const summary = await api.explorerScan(root, selection);
      set({ explorer: summary, explorerVersion: get().explorerVersion + 1 });
      return summary;
    } catch (e) {
      get().toast("danger", errorText(e));
      return null;
    } finally {
      get().setRunning("explorer", false);
    }
  },

  analyze: async (req) => {
    set({ page: "explorer" });
    if (req.kind === "one") await get().scanExplorer(req.path);
    else await get().scanExplorer(req.parent, req.names);
  },

  requestQuickClean: () => set({ page: "overview", quickCleanPending: true }),

  scanAll: async () => {
    await Promise.all([get().scanJunk(), get().scanProjects(), get().scanInstallers(), get().refreshDrives()]);
  },

  setProgress: (e) => set({ progress: { ...get().progress, [e.kind]: e } }),
  setRunning: (kind, on) => set({ running: { ...get().running, [kind]: on } }),
  bumpExplorer: () => set({ explorerVersion: get().explorerVersion + 1 }),

  toast: (tone, text) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, tone, text }] });
    window.setTimeout(() => get().dismissToast(id), tone === "danger" ? 8000 : 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
