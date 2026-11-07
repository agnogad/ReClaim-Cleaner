// Mirrors of the Rust types serialized by the Tauri commands (camelCase on the wire).

export type Risk = "safe" | "review" | "caution";
export type Group = "system" | "browser" | "apps" | "dev" | "games" | "ai" | "media";
export type Mode = "contents" | "folder" | "files" | "report";
export type DeleteMethod = "permanent" | "recycle";
export type Category = "projects" | "media" | "caches" | "apps" | "ai" | "system" | "other";
export type NodeKind = "dir" | "file" | "small";
export type MountKind = "local" | "remote" | "memory";

export interface OsInfo {
  name: string;
  displayVersion: string;
  build: string;
}

export interface LibraryFolders {
  desktop: string | null;
  documents: string | null;
  downloads: string | null;
  pictures: string | null;
  music: string | null;
  videos: string | null;
}

export interface AppInfo {
  version: string;
  /** Rust's `std::env::consts::OS`: `windows`, `linux`, `macos`. */
  platform: string;
  elevated: boolean;
  portable: boolean;
  dataDir: string;
  os: OsInfo;
  libraries: LibraryFolders;
  suggestedRoots: string[];
  settingsError: string | null;
  ruleProblems: string[];
  userProfile: string;
}

export interface Drive {
  root: string;
  label: string;
  fileSystem: string;
  total: number;
  free: number;
  removable: boolean;
  system: boolean;
}

export interface SystemFile {
  name: string;
  path: string;
  bytes: number;
}

export interface RecycleBinInfo {
  bytes: number;
  items: number;
}

export interface Settings {
  /** `system` or a code from src/i18n/languages.ts. */
  language: string;
  theme: "system" | "light" | "dark";
  cacheDelete: DeleteMethod;
  filesDelete: DeleteMethod;
  showCaution: boolean;
  exclusions: string[];
  projectRoots: string[];
  idleDays: number;
  largeMinMb: number;
  duplicateMinKb: number;
  installerAgeDays: number;
  checkUpdates: boolean;
  onboarded: boolean;
  /** Set by the app once the Explorer entry's default has been applied. */
  explorerMenuDefaultApplied: boolean;
}

export interface TargetRule {
  id: string;
  group: Group;
  name: string;
  nameTr: string;
  description: string;
  descriptionTr: string;
  paths: string[];
  mode: Mode;
  include: string[];
  exclude: string[];
  minAgeHours: number | null;
  risk: Risk;
  admin: boolean;
  closeApps: string[];
  command: string | null;
  verified: boolean;
  source: string | null;
  user: boolean;
}

export interface ArtifactRule {
  id: string;
  dirName: string;
  markers: string[];
  contains: string[];
  risk: Risk;
  description: string;
  descriptionTr: string;
}

export interface RulesPayload {
  targets: TargetRule[];
  artifacts: ArtifactRule[];
}

export interface ProgressSnapshot {
  files: number;
  dirs: number;
  bytes: number;
  errors: number;
  done: number;
  total: number;
  stage: string;
  current: string;
}

export interface ProgressEvent extends ProgressSnapshot {
  kind: string;
}

export interface FoundPath {
  path: string;
  bytes: number;
  files: number;
}

export interface TargetResult {
  id: string;
  bytes: number;
  files: number;
  found: FoundPath[];
  running: string[];
  partial: boolean;
  commandAvailable: boolean;
}

export interface Failure {
  path: string;
  reason: string;
}

export interface CleanReport {
  freed: number;
  recycled: number;
  files: number;
  dirs: number;
  failed: number;
  failures: Failure[];
  cancelled: boolean;
  items: string[];
}

export interface CleanOutcome {
  report: CleanReport;
  elevationCancelled: boolean;
}

export interface CommandResult {
  code: number | null;
  output: string;
  cancelled: boolean;
}

export interface ScanSummary {
  root: string;
  bytes: number;
  files: number;
  dirs: number;
  denied: number;
  millis: number;
  scannedAt: number;
  cancelled: boolean;
  cloudBytes: number;
  cloudFiles: number;
  /** Folders scanned inside `root` when only a selection was scanned; empty for the whole root. */
  selection: string[];
}

export interface NodeView {
  id: number;
  name: string;
  path: string;
  kind: NodeKind;
  category: Category;
  bytes: number;
  files: number;
  mtime: number;
  denied: boolean;
  reclaimSafe: number;
  reclaimReview: number;
  marked: Risk | null;
  /** Set on a mount the scan did not enter: no bytes, no children. Never set on Windows. */
  mount?: MountKind | null;
  /** The name is not valid text: shown with U+FFFD, and only removable with its folder. */
  unreadableName?: boolean;
  childCount: number;
  children: NodeView[];
  restBytes: number;
  restCount: number;
}

export interface Crumb {
  id: number;
  name: string;
}

export interface FileView {
  id: number;
  name: string;
  path: string;
  bytes: number;
  mtime: number;
  category: Category;
}

export interface ExtStat {
  ext: string;
  bytes: number;
  files: number;
}

export interface ArtifactHit {
  path: string;
  ruleId: string;
  dirName: string;
  risk: Risk;
  bytes: number;
  files: number;
}

export interface Project {
  path: string;
  name: string;
  lastActivity: number;
  hasGit: boolean;
  artifacts: ArtifactHit[];
  bytes: number;
}

export interface DupFile {
  path: string;
  mtime: number;
}

export interface DupGroup {
  hash: string;
  bytes: number;
  files: DupFile[];
  wasted: number;
}

export interface EmptyFolder {
  path: string;
  mtime: number;
  nested: number;
}

export interface InstallerFile {
  path: string;
  name: string;
  bytes: number;
  mtime: number;
  ext: string;
}

export interface InstalledApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  installed: string | null;
  bytes: number | null;
  location: string | null;
  icon: string | null;
  uninstall: string | null;
  quietUninstall: string | null;
  scope: string;
  source: "desktop" | "store";
  broken: boolean;
}

export type LeftoverConfidence = "high" | "low";
export type LeftoverReason = "install" | "name" | "publisherName" | "publisher" | "similar";

export interface Leftover {
  path: string;
  bytes: number;
  files: number;
  confidence: LeftoverConfidence;
  reason: LeftoverReason;
  /** Below Program Files or ProgramData, where removing usually needs administrator rights. */
  admin: boolean;
}

export interface UninstallResult {
  cancelled: boolean;
  exitCode: number | null;
  removed: boolean;
  /** High confidence first. Empty unless the app was removed. */
  leftovers: Leftover[];
}

export type StartupSource = "runUser" | "runMachine" | "runMachine32" | "folderUser" | "folderCommon";

export interface StartupItem {
  name: string;
  command: string;
  source: StartupSource;
  enabled: boolean;
  needsAdmin: boolean;
}

export interface HistoryEntry {
  time: string;
  kind: string;
  method: DeleteMethod;
  freed: number;
  recycled: number;
  files: number;
  failed: number;
  items: string[];
  elevated: boolean;
}

export type ToolId = "dism-cleanup" | "delivery-optimization" | "hibernate-off" | "hibernate-on" | "windows-old" | "disk-cleanup" | "storage-sense" | "system-protection" | "performance-options";

export type ImageKind = "icon" | "thumb";

export interface AiModel {
  id: string;
  name: string;
  source: "huggingface" | "lmstudio" | "ollama" | "comfyui";
  kind: string;
  formats: string[];
  bytes: number;
  files: number;
  mtime: number;
  path: string;
  remove: string[];
  command: string | null;
  sameAs: string[];
}

export interface DataItem {
  name: string;
  path: string;
  bytes: number;
  files: number;
  mtime: number;
}

export interface AssistantData {
  id: string;
  tool: string;
  path: string;
  bytes: number;
  files: number;
  mtime: number;
  risk: Risk;
  items: DataItem[];
}

export interface DownloadFile {
  path: string;
  name: string;
  folder: string;
  ext: string;
  bytes: number;
  mtime: number;
  copy: boolean;
}

export interface DownloadsReport {
  root: string;
  bytes: number;
  files: DownloadFile[];
  truncated: boolean;
}

export type HiddenKind = "shadowCopies" | "reservedStorage" | "pageFile" | "hiberFile" | "swapFile" | "mft" | "recycleBin" | "virtualDisk" | "unreadable" | "cloudOnly";

export interface HiddenPart {
  kind: HiddenKind;
  bytes: number | null;
  inScan: boolean;
  path: string | null;
  label: string | null;
  limit: number | null;
  count: number | null;
  needsAdmin: boolean;
}

export interface HiddenSpace {
  root: string;
  total: number;
  free: number;
  used: number;
  scanned: number | null;
  parts: HiddenPart[];
  unexplained: number | null;
  deniedPaths: string[];
}

export type LockerKind = "app" | "background" | "service" | "explorer" | "console" | "system";

export interface Locker {
  pid: number;
  started: number;
  name: string;
  exe: string | null;
  service: string | null;
  kind: LockerKind;
  usesFiles: boolean;
  runsFrom: boolean;
  canClose: boolean;
}

export interface LockReport {
  path: string;
  isDir: boolean;
  checked: number;
  folders: number;
  truncated: boolean;
  unchecked: number;
  lockers: Locker[];
}

export type CloseOutcome = "closed" | "stillRunning" | "denied" | "gone" | "notAllowed";

export interface CloseResult {
  outcome: CloseOutcome;
  report: LockReport;
}

export interface SteamGame {
  appId: string;
  name: string;
  bytes: number;
}

export interface SteamLibrary {
  path: string;
  games: SteamGame[];
  bytes: number;
  free: number | null;
}

export interface ShaderCache {
  appId: string;
  name: string | null;
  installed: boolean;
  risk: Risk;
  library: string;
  path: string;
  bytes: number;
  files: number;
}

export interface SteamReport {
  root: string | null;
  running: boolean;
  libraries: SteamLibrary[];
  caches: ShaderCache[];
}

export interface MenuStatus {
  enabled: boolean;
  exe: string | null;
  current: boolean;
  exeExists: boolean;
}

export type AnalyzeRequest = { kind: "one"; path: string } | { kind: "selection"; parent: string; names: string[] };
