// Package engine is the ReClaim Cleaner engine: everything that touches the
// file system, the mount table or other processes. It is a port of the Rust
// crate `reclaim-core` and keeps its semantics, its safety rules and its
// vocabulary.
package engine

// Risk is how safe a location is to remove.
type Risk string

const (
	RiskSafe    Risk = "safe"
	RiskReview  Risk = "review"
	RiskCaution Risk = "caution"
)

// Group is the family a cleanup target belongs to.
type Group string

const (
	GroupSystem  Group = "system"
	GroupBrowser Group = "browser"
	GroupApps    Group = "apps"
	GroupDev     Group = "dev"
	GroupGames   Group = "games"
	GroupAI      Group = "ai"
	GroupMedia   Group = "media"
)

// Mode is what a rule removes.
type Mode string

const (
	// ModeContents deletes everything inside each path and keeps the folder.
	ModeContents Mode = "contents"
	// ModeFolder deletes each path itself.
	ModeFolder Mode = "folder"
	// ModeFiles deletes files directly inside each path that match Include.
	ModeFiles Mode = "files"
	// ModeReport only measures; cleaning happens through Command.
	ModeReport Mode = "report"
)

// DeleteMethod is how a delete reaches the file system.
type DeleteMethod string

const (
	DeletePermanent DeleteMethod = "permanent"
	DeleteRecycle   DeleteMethod = "recycle"
)

// Category colours a treemap node.
type Category string

const (
	CatProjects Category = "projects"
	CatMedia    Category = "media"
	CatCaches   Category = "caches"
	CatApps     Category = "apps"
	CatAI       Category = "ai"
	CatSystem   Category = "system"
	CatOther    Category = "other"
)

// NodeKind tells a folder from a file from a node too small to draw.
type NodeKind string

const (
	NodeDir   NodeKind = "dir"
	NodeFile  NodeKind = "file"
	NodeSmall NodeKind = "small"
)

// MountKind marks a mount a scan did not enter.
type MountKind string

const (
	MountLocal  MountKind = "local"
	MountRemote MountKind = "remote"
	MountMemory MountKind = "memory"
)

// OsInfo is the operating system, as the About panel shows it.
type OsInfo struct {
	Name           string `json:"name"`
	DisplayVersion string `json:"displayVersion"`
	Build          string `json:"build"`
}

// LibraryFolders are the user's well-known folders, null where absent.
type LibraryFolders struct {
	Desktop   *string `json:"desktop"`
	Documents *string `json:"documents"`
	Downloads *string `json:"downloads"`
	Pictures  *string `json:"pictures"`
	Music     *string `json:"music"`
	Videos    *string `json:"videos"`
}

// AppInfo is what the shell tells the UI about itself.
type AppInfo struct {
	Version        string         `json:"version"`
	Platform       string         `json:"platform"`
	Elevated       bool           `json:"elevated"`
	Portable       bool           `json:"portable"`
	DataDir        string         `json:"dataDir"`
	OS             OsInfo         `json:"os"`
	Libraries      LibraryFolders `json:"libraries"`
	SuggestedRoots []string       `json:"suggestedRoots"`
	SettingsError  *string        `json:"settingsError"`
	RuleProblems   []string       `json:"ruleProblems"`
	UserProfile    string         `json:"userProfile"`
}

// Drive is a mounted file system the Overview lists.
type Drive struct {
	Root       string `json:"root"`
	Label      string `json:"label"`
	FileSystem string `json:"fileSystem"`
	Total      int64  `json:"total"`
	Free       int64  `json:"free"`
	Removable  bool   `json:"removable"`
	System     bool   `json:"system"`
}

// SystemFile is a large file the system keeps outside the user's folders.
type SystemFile struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
}

// RecycleBinInfo is the size of the user's trash.
type RecycleBinInfo struct {
	Bytes int64 `json:"bytes"`
	Items int64 `json:"items"`
}

// Settings are the user's choices, stored as a plain JSON file.
type Settings struct {
	Language                   string       `json:"language"`
	Theme                      string       `json:"theme"`
	CacheDelete                DeleteMethod `json:"cacheDelete"`
	FilesDelete                DeleteMethod `json:"filesDelete"`
	ShowCaution                bool         `json:"showCaution"`
	Exclusions                 []string     `json:"exclusions"`
	ProjectRoots               []string     `json:"projectRoots"`
	IdleDays                   int          `json:"idleDays"`
	LargeMinMb                 int          `json:"largeMinMb"`
	DuplicateMinKb             int          `json:"duplicateMinKb"`
	InstallerAgeDays           int          `json:"installerAgeDays"`
	CheckUpdates               bool         `json:"checkUpdates"`
	Onboarded                  bool         `json:"onboarded"`
	ExplorerMenuDefaultApplied bool         `json:"explorerMenuDefaultApplied"`
}

// DefaultSettings is what a fresh install starts from.
func DefaultSettings() Settings {
	return Settings{
		Language:                   "system",
		Theme:                      "system",
		CacheDelete:                DeletePermanent,
		FilesDelete:                DeleteRecycle,
		ShowCaution:                false,
		Exclusions:                 []string{},
		ProjectRoots:               []string{},
		IdleDays:                   30,
		LargeMinMb:                 100,
		DuplicateMinKb:             1024,
		InstallerAgeDays:           30,
		CheckUpdates:               false,
		Onboarded:                  false,
		ExplorerMenuDefaultApplied: false,
	}
}

// TargetRule is one cleanup location, loaded from rules/targets.json.
type TargetRule struct {
	ID            string   `json:"id"`
	Group         Group    `json:"group"`
	Name          string   `json:"name"`
	NameTr        string   `json:"nameTr"`
	Description   string   `json:"description"`
	DescriptionTr string   `json:"descriptionTr"`
	Paths         []string `json:"paths"`
	Mode          Mode     `json:"mode"`
	Include       []string `json:"include"`
	Exclude       []string `json:"exclude"`
	MinAgeHours   *int     `json:"minAgeHours"`
	Risk          Risk     `json:"risk"`
	Admin         bool     `json:"admin"`
	CloseApps     []string `json:"closeApps"`
	Command       *string  `json:"command"`
	Verified      bool     `json:"verified"`
	Source        *string  `json:"source"`
	User          bool     `json:"user"`
}

// ArtifactRule recognises a build folder inside a project.
type ArtifactRule struct {
	ID            string   `json:"id"`
	DirName       string   `json:"dirName"`
	Markers       []string `json:"markers"`
	Contains      []string `json:"contains"`
	Risk          Risk     `json:"risk"`
	Description   string   `json:"description"`
	DescriptionTr string   `json:"descriptionTr"`
}

// RulesPayload is what the Cleaner page loads once.
type RulesPayload struct {
	Targets   []TargetRule   `json:"targets"`
	Artifacts []ArtifactRule `json:"artifacts"`
}

// ProgressSnapshot is how far a running job has got.
type ProgressSnapshot struct {
	Files   int64  `json:"files"`
	Dirs    int64  `json:"dirs"`
	Bytes   int64  `json:"bytes"`
	Errors  int64  `json:"errors"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
	Stage   string `json:"stage"`
	Current string `json:"current"`
}

// ProgressEvent is a snapshot plus the job it belongs to.
type ProgressEvent struct {
	ProgressSnapshot
	Kind string `json:"kind"`
}

// FoundPath is one path a rule matched.
type FoundPath struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
	Files int64  `json:"files"`
}

// TargetResult is what a scan found for one rule.
type TargetResult struct {
	ID               string      `json:"id"`
	Bytes            int64       `json:"bytes"`
	Files            int64       `json:"files"`
	Found            []FoundPath `json:"found"`
	Running          []string    `json:"running"`
	Partial          bool        `json:"partial"`
	CommandAvailable bool        `json:"commandAvailable"`
}

// Failure is one path a clean could not remove, and why.
type Failure struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// CleanReport is the result of one reviewed plan.
type CleanReport struct {
	Freed     int64     `json:"freed"`
	Recycled  int64     `json:"recycled"`
	Files     int64     `json:"files"`
	Dirs      int64     `json:"dirs"`
	Failed    int64     `json:"failed"`
	Failures  []Failure `json:"failures"`
	Cancelled bool      `json:"cancelled"`
	Items     []string  `json:"items"`
}

// CleanOutcome wraps a report with whether elevation was declined.
type CleanOutcome struct {
	Report             CleanReport `json:"report"`
	ElevationCancelled bool        `json:"elevationCancelled"`
}

// CommandResult is a tool's own cleanup command, run for the user.
type CommandResult struct {
	Code      *int   `json:"code"`
	Output    string `json:"output"`
	Cancelled bool   `json:"cancelled"`
}

// ScanSummary describes one finished scan of a tree.
type ScanSummary struct {
	Root       string   `json:"root"`
	Bytes      int64    `json:"bytes"`
	Files      int64    `json:"files"`
	Dirs       int64    `json:"dirs"`
	Denied     int64    `json:"denied"`
	Millis     int64    `json:"millis"`
	ScannedAt  int64    `json:"scannedAt"`
	Cancelled  bool     `json:"cancelled"`
	CloudBytes int64    `json:"cloudBytes"`
	CloudFiles int64    `json:"cloudFiles"`
	Selection  []string `json:"selection"`
}

// NodeView is one node of the treemap, as the UI receives it.
type NodeView struct {
	ID             int64      `json:"id"`
	Name           string     `json:"name"`
	Path           string     `json:"path"`
	Kind           NodeKind   `json:"kind"`
	Category       Category   `json:"category"`
	Bytes          int64      `json:"bytes"`
	Files          int64      `json:"files"`
	Mtime          int64      `json:"mtime"`
	Denied         bool       `json:"denied"`
	ReclaimSafe    int64      `json:"reclaimSafe"`
	ReclaimReview  int64      `json:"reclaimReview"`
	Marked         *Risk      `json:"marked"`
	Mount          *MountKind `json:"mount,omitempty"`
	UnreadableName bool       `json:"unreadableName,omitempty"`
	ChildCount     int        `json:"childCount"`
	Children       []NodeView `json:"children"`
	RestBytes      int64      `json:"restBytes"`
	RestCount      int        `json:"restCount"`
}

// Crumb is one step of the path above the current node.
type Crumb struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// FileView is one row of the Large files list.
type FileView struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Path     string   `json:"path"`
	Bytes    int64    `json:"bytes"`
	Mtime    int64    `json:"mtime"`
	Category Category `json:"category"`
}

// ExtStat is one row of the extension breakdown.
type ExtStat struct {
	Ext   string `json:"ext"`
	Bytes int64  `json:"bytes"`
	Files int64  `json:"files"`
}

// ArtifactHit is one build folder found inside a project.
type ArtifactHit struct {
	Path    string `json:"path"`
	RuleID  string `json:"ruleId"`
	DirName string `json:"dirName"`
	Risk    Risk   `json:"risk"`
	Bytes   int64  `json:"bytes"`
	Files   int64  `json:"files"`
}

// Project is one project folder and the build folders inside it.
type Project struct {
	Path         string        `json:"path"`
	Name         string        `json:"name"`
	LastActivity int64         `json:"lastActivity"`
	HasGit       bool          `json:"hasGit"`
	Artifacts    []ArtifactHit `json:"artifacts"`
	Bytes        int64         `json:"bytes"`
}

// DupFile is one copy of a duplicated file.
type DupFile struct {
	Path  string `json:"path"`
	Mtime int64  `json:"mtime"`
}

// DupGroup is a set of identical files.
type DupGroup struct {
	Hash   string    `json:"hash"`
	Bytes  int64     `json:"bytes"`
	Files  []DupFile `json:"files"`
	Wasted int64     `json:"wasted"`
}

// EmptyFolder is a folder with nothing in it.
type EmptyFolder struct {
	Path   string `json:"path"`
	Mtime  int64  `json:"mtime"`
	Nested int    `json:"nested"`
}

// InstallerFile is an old installer or archive in Downloads or on the Desktop.
type InstallerFile struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
	Mtime int64  `json:"mtime"`
	Ext   string `json:"ext"`
}

// InstalledApp is a desktop or Store app.
type InstalledApp struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Publisher      string  `json:"publisher"`
	Version        string  `json:"version"`
	Installed      *string `json:"installed"`
	Bytes          *int64  `json:"bytes"`
	Location       *string `json:"location"`
	Icon           *string `json:"icon"`
	Uninstall      *string `json:"uninstall"`
	QuietUninstall *string `json:"quietUninstall"`
	Scope          string  `json:"scope"`
	Source         string  `json:"source"`
	Broken         bool    `json:"broken"`
}

// LeftoverConfidence is how sure a leftover folder belongs to a removed app.
type LeftoverConfidence string

const (
	ConfidenceHigh LeftoverConfidence = "high"
	ConfidenceLow  LeftoverConfidence = "low"
)

// LeftoverReason says why a folder was matched.
type LeftoverReason string

const (
	ReasonInstall       LeftoverReason = "install"
	ReasonName          LeftoverReason = "name"
	ReasonPublisherName LeftoverReason = "publisherName"
	ReasonPublisher     LeftoverReason = "publisher"
	ReasonSimilar       LeftoverReason = "similar"
)

// Leftover is a folder an uninstalled app left behind.
type Leftover struct {
	Path       string             `json:"path"`
	Bytes      int64              `json:"bytes"`
	Files      int64              `json:"files"`
	Confidence LeftoverConfidence `json:"confidence"`
	Reason     LeftoverReason     `json:"reason"`
	Admin      bool               `json:"admin"`
}

// UninstallResult is what an uninstall left behind.
type UninstallResult struct {
	Cancelled bool       `json:"cancelled"`
	ExitCode  *int       `json:"exitCode"`
	Removed   bool       `json:"removed"`
	Leftovers []Leftover `json:"leftovers"`
}

// StartupSource is where a startup entry lives.
type StartupSource string

const (
	StartupRunUser      StartupSource = "runUser"
	StartupRunMachine   StartupSource = "runMachine"
	StartupRunMachine32 StartupSource = "runMachine32"
	StartupFolderUser   StartupSource = "folderUser"
	StartupFolderCommon StartupSource = "folderCommon"
)

// StartupItem is one program that starts with the session.
type StartupItem struct {
	Name       string        `json:"name"`
	Command    string        `json:"command"`
	Source     StartupSource `json:"source"`
	Enabled    bool          `json:"enabled"`
	NeedsAdmin bool          `json:"needsAdmin"`
}

// HistoryEntry is one line of the cleanup log.
type HistoryEntry struct {
	Time     string       `json:"time"`
	Kind     string       `json:"kind"`
	Method   DeleteMethod `json:"method"`
	Freed    int64        `json:"freed"`
	Recycled int64        `json:"recycled"`
	Files    int64        `json:"files"`
	Failed   int64        `json:"failed"`
	Items    []string     `json:"items"`
	Elevated bool         `json:"elevated"`
}

// ToolID names one of the system's own cleanup tools.
type ToolID string

const (
	ToolDismCleanup          ToolID = "dism-cleanup"
	ToolDeliveryOptimization ToolID = "delivery-optimization"
	ToolHibernateOff         ToolID = "hibernate-off"
	ToolHibernateOn          ToolID = "hibernate-on"
	ToolWindowsOld           ToolID = "windows-old"
	ToolDiskCleanup          ToolID = "disk-cleanup"
	ToolStorageSense         ToolID = "storage-sense"
	ToolSystemProtection     ToolID = "system-protection"
	ToolPerformanceOptions   ToolID = "performance-options"
)

// ImageKind is whether an icon or a thumbnail is wanted.
type ImageKind string

const (
	ImageIcon  ImageKind = "icon"
	ImageThumb ImageKind = "thumb"
)

// AiModel is one model file a local AI tool keeps.
type AiModel struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Source  string   `json:"source"`
	Kind    string   `json:"kind"`
	Formats []string `json:"formats"`
	Bytes   int64    `json:"bytes"`
	Files   int64    `json:"files"`
	Mtime   int64    `json:"mtime"`
	Path    string   `json:"path"`
	Remove  []string `json:"remove"`
	Command *string  `json:"command"`
	SameAs  []string `json:"sameAs"`
}

// DataItem is one folder inside an assistant's data.
type DataItem struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
	Files int64  `json:"files"`
	Mtime int64  `json:"mtime"`
}

// AssistantData is what one AI assistant keeps on disk.
type AssistantData struct {
	ID    string     `json:"id"`
	Tool  string     `json:"tool"`
	Path  string     `json:"path"`
	Bytes int64      `json:"bytes"`
	Files int64      `json:"files"`
	Mtime int64      `json:"mtime"`
	Risk  Risk       `json:"risk"`
	Items []DataItem `json:"items"`
}

// DownloadFile is one file in the Downloads folder.
type DownloadFile struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Folder string `json:"folder"`
	Ext    string `json:"ext"`
	Bytes  int64  `json:"bytes"`
	Mtime  int64  `json:"mtime"`
	Copy   bool   `json:"copy"`
}

// DownloadsReport is the Downloads folder by type and age.
type DownloadsReport struct {
	Root      string         `json:"root"`
	Bytes     int64          `json:"bytes"`
	Files     []DownloadFile `json:"files"`
	Truncated bool           `json:"truncated"`
}

// HiddenKind names one part of the space a drive uses but its folders do not.
type HiddenKind string

const (
	HiddenShadowCopies    HiddenKind = "shadowCopies"
	HiddenReservedStorage HiddenKind = "reservedStorage"
	HiddenPageFile        HiddenKind = "pageFile"
	HiddenHiberFile       HiddenKind = "hiberFile"
	HiddenSwapFile        HiddenKind = "swapFile"
	HiddenMft             HiddenKind = "mft"
	HiddenRecycleBin      HiddenKind = "recycleBin"
	HiddenVirtualDisk     HiddenKind = "virtualDisk"
	HiddenUnreadable      HiddenKind = "unreadable"
	HiddenCloudOnly       HiddenKind = "cloudOnly"
)

// HiddenPart is one part of the hidden space.
type HiddenPart struct {
	Kind       HiddenKind `json:"kind"`
	Bytes      *int64     `json:"bytes"`
	InScan     bool       `json:"inScan"`
	Path       *string    `json:"path"`
	Label      *string    `json:"label"`
	Limit      *int64     `json:"limit"`
	Count      *int64     `json:"count"`
	NeedsAdmin bool       `json:"needsAdmin"`
}

// HiddenSpace is what a drive uses beyond what its folders add up to.
type HiddenSpace struct {
	Root        string       `json:"root"`
	Total       int64        `json:"total"`
	Free        int64        `json:"free"`
	Used        int64        `json:"used"`
	Scanned     *int64       `json:"scanned"`
	Parts       []HiddenPart `json:"parts"`
	Unexplained *int64       `json:"unexplained"`
	DeniedPaths []string     `json:"deniedPaths"`
}

// LockerKind classifies the process holding a file.
type LockerKind string

const (
	LockerApp        LockerKind = "app"
	LockerBackground LockerKind = "background"
	LockerService    LockerKind = "service"
	LockerExplorer   LockerKind = "explorer"
	LockerConsole    LockerKind = "console"
	LockerSystem     LockerKind = "system"
)

// Locker is one process holding a file or folder.
type Locker struct {
	PID       int        `json:"pid"`
	Started   int64      `json:"started"`
	Name      string     `json:"name"`
	Exe       *string    `json:"exe"`
	Service   *string    `json:"service"`
	Kind      LockerKind `json:"kind"`
	UsesFiles bool       `json:"usesFiles"`
	RunsFrom  bool       `json:"runsFrom"`
	CanClose  bool       `json:"canClose"`
}

// LockReport is what holds a path.
type LockReport struct {
	Path      string   `json:"path"`
	IsDir     bool     `json:"isDir"`
	Checked   int      `json:"checked"`
	Folders   int      `json:"folders"`
	Truncated bool     `json:"truncated"`
	Unchecked int      `json:"unchecked"`
	Lockers   []Locker `json:"lockers"`
}

// CloseOutcome is what asking a process to close did.
type CloseOutcome string

const (
	CloseClosed       CloseOutcome = "closed"
	CloseStillRunning CloseOutcome = "stillRunning"
	CloseDenied       CloseOutcome = "denied"
	CloseGone         CloseOutcome = "gone"
	CloseNotAllowed   CloseOutcome = "notAllowed"
)

// CloseResult is a close attempt and the report after it.
type CloseResult struct {
	Outcome CloseOutcome `json:"outcome"`
	Report  LockReport   `json:"report"`
}

// SteamGame is one installed Steam game.
type SteamGame struct {
	AppID string `json:"appId"`
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
}

// SteamLibrary is one Steam library folder.
type SteamLibrary struct {
	Path  string      `json:"path"`
	Games []SteamGame `json:"games"`
	Bytes int64       `json:"bytes"`
	Free  *int64      `json:"free"`
}

// ShaderCache is one game's shader cache.
type ShaderCache struct {
	AppID     string  `json:"appId"`
	Name      *string `json:"name"`
	Installed bool    `json:"installed"`
	Risk      Risk    `json:"risk"`
	Library   string  `json:"library"`
	Path      string  `json:"path"`
	Bytes     int64   `json:"bytes"`
	Files     int64   `json:"files"`
}

// SteamReport is every Steam library and shader cache.
type SteamReport struct {
	Root      *string        `json:"root"`
	Running   bool           `json:"running"`
	Libraries []SteamLibrary `json:"libraries"`
	Caches    []ShaderCache  `json:"caches"`
}

// MenuStatus is whether the file manager entry is installed.
type MenuStatus struct {
	Enabled   bool    `json:"enabled"`
	Exe       *string `json:"exe"`
	Current   bool    `json:"current"`
	ExeExists bool    `json:"exeExists"`
}

// AnalyzeRequest is what the file manager asked the app to analyze.
type AnalyzeRequest struct {
	Kind   string   `json:"kind"`
	Path   string   `json:"path,omitempty"`
	Parent string   `json:"parent,omitempty"`
	Names  []string `json:"names,omitempty"`
}
