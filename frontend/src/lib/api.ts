import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AnalyzeRequest,
  AppInfo,
  CloseResult,
  HiddenSpace,
  LockReport,
  MenuStatus,
  SteamReport,
  CleanOutcome,
  CleanReport,
  CommandResult,
  Crumb,
  DeleteMethod,
  Drive,
  DupGroup,
  EmptyFolder,
  AiModel,
  AssistantData,
  DownloadsReport,
  ExtStat,
  ImageKind,
  FileView,
  HistoryEntry,
  InstalledApp,
  InstallerFile,
  NodeView,
  ProgressEvent,
  Project,
  RecycleBinInfo,
  RulesPayload,
  ScanSummary,
  Settings,
  StartupItem,
  StartupSource,
  SystemFile,
  TargetResult,
  ToolId,
  UninstallResult,
} from "./types";

/** Error with a stable code from the engine; `message` is the technical detail. */
export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new ApiError("desktop_only", "This view needs the ReClaim desktop app.");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      const p = e as { code: string; message: string };
      throw new ApiError(p.code, p.message);
    }
    throw new ApiError("other", String(e));
  }
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  drives: () => call<Drive[]>("drives"),
  systemFiles: () => call<SystemFile[]>("system_files"),
  recycleBinInfo: () => call<RecycleBinInfo>("recycle_bin_info"),
  settingsGet: () => call<Settings>("settings_get"),
  settingsSet: (settings: Settings) => call<Settings>("settings_set", { settings }),
  rules: () => call<RulesPayload>("rules_list"),
  cancel: (kind: string) => call<void>("job_cancel", { kind }),
  reveal: (path: string) => call<void>("reveal_path", { path }),
  open: (path: string) => call<void>("open_path", { path }),
  restartElevated: () => call<boolean>("restart_elevated"),

  explorerScan: (root: string, selection?: string[]) => call<ScanSummary>("explorer_scan", { root, selection: selection ?? null }),
  explorerSummary: () => call<ScanSummary | null>("explorer_summary"),
  explorerNode: (id: number, depth: number, limit: number) => call<NodeView | null>("explorer_node", { id, depth, limit }),
  explorerAncestors: (id: number) => call<Crumb[]>("explorer_ancestors", { id }),
  explorerFind: (path: string) => call<number | null>("explorer_find", { path }),
  explorerLarge: (minBytes: number, limit: number) => call<FileView[]>("explorer_large", { minBytes, limit }),
  explorerExtensions: (limit: number) => call<ExtStat[]>("explorer_extensions", { limit }),

  junkScan: () => call<TargetResult[]>("junk_scan"),
  junkClean: (ids: string[], method: DeleteMethod) => call<CleanOutcome>("junk_clean", { ids, method }),
  ruleCommand: (id: string) => call<CommandResult>("rule_command", { id }),

  projectsScan: (roots: string[]) => call<Project[]>("projects_scan", { roots }),
  duplicatesScan: (roots: string[], minBytes: number) => call<DupGroup[]>("duplicates_scan", { roots, minBytes }),
  emptyScan: (roots: string[]) => call<EmptyFolder[]>("empty_scan", { roots }),
  installersScan: () => call<InstallerFile[]>("installers_scan"),
  pathsClean: (kind: string, paths: string[], method: DeleteMethod) => call<CleanReport>("paths_clean", { kind, paths, method }),
  recycleBinEmpty: () => call<CleanReport>("recycle_bin_empty"),

  apps: () => call<InstalledApp[]>("apps_list"),
  storeApps: () => call<InstalledApp[]>("apps_store"),
  uninstall: (id: string) => call<UninstallResult>("app_uninstall", { id }),
  startup: () => call<StartupItem[]>("startup_list"),
  startupSet: (source: StartupSource, name: string, enabled: boolean) => call<void>("startup_set", { source, name, enabled }),
  tool: (id: ToolId) => call<CommandResult>("tool_run", { id }),

  shellImages: (paths: string[], size: number, kind: ImageKind) => call<Record<string, string | null>>("shell_images", { paths, size, kind }),
  aiModels: () => call<AiModel[]>("ai_models"),
  ollamaRemove: (id: string) => call<void>("ollama_remove", { id }),
  assistantData: () => call<AssistantData[]>("assistant_data"),
  downloads: () => call<DownloadsReport>("downloads_report"),
  appRemoveEntry: (id: string) => call<string>("app_remove_entry", { id }),

  hiddenSpace: (root: string) => call<HiddenSpace>("hidden_space", { root }),
  hiddenMeasure: () => call<boolean>("hidden_measure"),
  locksFind: (path: string) => call<LockReport>("locks_find", { path }),
  locksClose: (path: string, pid: number, started: number) => call<CloseResult>("locks_close", { path, pid, started }),
  steamReport: () => call<SteamReport>("steam_report"),
  steamClean: (appIds: string[], method: DeleteMethod) => call<CleanReport>("steam_clean", { appIds, method }),
  shellMenuStatus: () => call<MenuStatus>("shell_menu_status"),
  shellMenuSet: (enabled: boolean, lang: string) => call<MenuStatus>("shell_menu_set", { enabled, lang }),
  shellTakePending: () => call<AnalyzeRequest | null>("shell_take_pending"),
  shellMenuDefault: (lang: string) => call<boolean>("shell_menu_default", { lang }),
  quickCleanTake: () => call<boolean>("quick_clean_take"),
  jumpListSet: (title: string, description: string) => call<void>("jump_list_set", { title, description }),
  desktopShortcutCreate: (title: string, description: string) => call<string>("desktop_shortcut_create", { title, description }),

  history: (limit: number) => call<HistoryEntry[]>("history_list", { limit }),
  historyClear: () => call<void>("history_clear"),
};

/** Fires when Explorer asked the running app to analyze folders. */
export function onShellAnalyze(cb: () => void): Promise<UnlistenFn> {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen("shell-analyze", () => cb());
}

/** Fires when a shortcut or jump list task asked the running app for a quick clean. */
export function onQuickClean(cb: () => void): Promise<UnlistenFn> {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen("quick-clean", () => cb());
}

export function onProgress(cb: (e: ProgressEvent) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<ProgressEvent>("job-progress", (e) => cb(e.payload));
}

export async function pickFolders(multiple = true): Promise<string[]> {
  if (!isDesktop()) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function openUrl(url: string): Promise<void> {
  if (!isDesktop()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl: open } = await import("@tauri-apps/plugin-opener");
  await open(url);
}
