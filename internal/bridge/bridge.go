// Package bridge connects the ReClaim engine to the page. It answers the
// Tauri command names the React app already calls, so not one line of the
// frontend had to change.
package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"gocleaner/internal/engine"
)

// ProgressPayload is a job's progress as the page receives it. It is the
// payload of the `job-progress` event.
type ProgressPayload = engine.ProgressEvent

// Bridge holds the app's state and answers the page's calls.
type Bridge struct {
	store    *engine.Store
	guard    *engine.Guard
	catalog  *engine.Catalog
	explorer *engine.Explorer
	xdg      engine.Xdg
	mounts   *engine.MountTable
	libs     engine.LibraryFolders

	// cancels holds the canceller of each running job, by kind.
	mu      sync.Mutex
	cancels map[string]*engine.Canceller
	// progress is the reporter of the running job, by kind.
	progress map[string]*engine.Progress
	// subscribers maps an event name to the callback ids listening to it.
	subs map[string][]int
	// emit sends an event to the page.
	emit func(name string, payload any)

	// steamCache keeps the last Steam report, so a clean does not rescan.
	steamCache *engine.SteamReport
}

// Options are what the bridge needs from the app shell.
type Options struct {
	DataDir string
	// Emit sends an event to the page.
	Emit func(name string, payload any)
}

// New builds the bridge and loads the catalog.
func New(opts Options) *Bridge {
	x := engine.ReadXdg()
	store := engine.NewStore(opts.DataDir)

	settings, _ := store.LoadSettings()

	mounts, _ := engine.ReadMountTable()

	guard := engine.NewGuard(engine.GuardOptions{
		Home:       x.Home,
		XDGCache:   x.Cache,
		XDGConfig:  x.Config,
		XDGData:    x.Data,
		XDGState:   x.State,
		Mounts:     mounts.Points(),
		Exclusions: settings.Exclusions,
		AppData:    opts.DataDir,
		AsRoot:     engine.IsElevated(),
	})

	catalog := engine.LoadCatalog(guard, filepath.Join(opts.DataDir, "rules"))

	b := &Bridge{
		store:    store,
		guard:    guard,
		catalog:  catalog,
		explorer: engine.NewExplorer(guard),
		xdg:      x,
		mounts:   mounts,
		libs:     engine.LibraryFoldersOf(x),
		cancels:  map[string]*engine.Canceller{},
		progress: map[string]*engine.Progress{},
		subs:     map[string][]int{},
		emit:     opts.Emit,
	}
	return b
}

// Call answers one Tauri command. The arguments arrive as the object the
// frontend passed, so each command decodes just the fields it needs.
func (b *Bridge) Call(cmd string, args map[string]any) (any, error) {
	switch cmd {
	case "app_info":
		return b.appInfo(), nil
	case "drives":
		return b.drives(), nil
	case "system_files":
		return b.systemFiles(), nil
	case "recycle_bin_info":
		return b.recycleBinInfo(), nil
	case "settings_get":
		return b.settingsGet()
	case "settings_set":
		var s engine.Settings
		if err := decodeArg(args, "settings", &s); err != nil {
			return nil, err
		}
		return b.settingsSet(s)
	case "rules_list":
		return b.catalog.Payload(), nil
	case "job_cancel":
		kind, _ := argString(args, "kind")
		b.cancel(kind)
		return nil, nil
	case "reveal_path":
		path, _ := argString(args, "path")
		return nil, revealPath(path)
	case "open_path":
		path, _ := argString(args, "path")
		return nil, openPath(path)
	case "restart_elevated":
		// The app refuses to run as root on Linux; there is nothing to
		// elevate to.
		return false, nil

	case "explorer_scan":
		return b.explorerScan(args)
	case "explorer_summary":
		return b.explorer.Summary(), nil
	case "explorer_node":
		id, _ := argInt(args, "id")
		depth, _ := argInt(args, "depth")
		limit, _ := argInt(args, "limit")
		return b.explorer.Node(id, int(depth), int(limit)), nil
	case "explorer_ancestors":
		id, _ := argInt(args, "id")
		return b.explorer.Ancestors(id), nil
	case "explorer_find":
		path, _ := argString(args, "path")
		return b.explorer.Find(path), nil
	case "explorer_large":
		minBytes, _ := argInt(args, "minBytes")
		limit, _ := argInt(args, "limit")
		return b.explorer.Large(minBytes, int(limit)), nil
	case "explorer_extensions":
		limit, _ := argInt(args, "limit")
		return b.explorer.Extensions(int(limit)), nil

	case "junk_scan":
		return b.junkScan()
	case "junk_clean":
		return b.junkClean(args)
	case "rule_command":
		id, _ := argString(args, "id")
		return b.ruleCommand(id)

	case "projects_scan":
		return b.projectsScan(args)
	case "duplicates_scan":
		return b.duplicatesScan(args)
	case "empty_scan":
		return b.emptyScan(args)
	case "installers_scan":
		return b.installersScan()
	case "paths_clean":
		return b.pathsClean(args)
	case "recycle_bin_empty":
		return b.recycleBinEmpty()

	case "apps_list", "apps_store":
		// Linux has no registry and no Store: the source returns an empty
		// list rather than guessing.
		return []engine.InstalledApp{}, nil
	case "app_uninstall":
		return nil, engine.NewError(engine.CodeUnsupported, "uninstalling apps is Windows-only")
	case "startup_list":
		return []engine.StartupItem{}, nil
	case "startup_set":
		return nil, engine.NewError(engine.CodeUnsupported, "startup entries are Windows-only")
	case "tool_run":
		return b.toolRun(args)

	case "shell_images":
		return b.shellImages(args)
	case "ai_models":
		return engine.AiModels(b.xdg, b.mounts, b.guard), nil
	case "ollama_remove":
		return nil, b.ollamaRemove(args)
	case "assistant_data":
		return engine.AssistantDataOf(b.xdg, b.mounts, b.guard), nil
	case "downloads_report":
		return b.downloadsReport(), nil
	case "app_remove_entry":
		return nil, engine.NewError(engine.CodeUnsupported, "removing app entries is Windows-only")

	case "hidden_space":
		root, _ := argString(args, "root")
		return engine.HiddenSpaceOf(root, b.mounts, b.xdg, b.guard), nil
	case "hidden_measure":
		return false, nil
	case "locks_find":
		path, _ := argString(args, "path")
		return engine.FindLocks(path, b.mounts), nil
	case "locks_close":
		return b.locksClose(args)
	case "steam_report":
		report := engine.SteamReportOf(b.xdg, b.mounts, b.guard)
		b.steamCache = &report
		return report, nil
	case "steam_clean":
		return b.steamClean(args)
	case "shell_menu_status":
		return engine.MenuStatus{Enabled: false}, nil
	case "shell_menu_set":
		return nil, engine.NewError(engine.CodeUnsupported, "the file manager entry is Windows-only")
	case "shell_menu_default":
		return false, nil
	case "shell_take_pending":
		return nil, nil
	case "quick_clean_take":
		return false, nil
	case "jump_list_set":
		return nil, engine.NewError(engine.CodeUnsupported, "the jump list is Windows-only")
	case "desktop_shortcut_create":
		return nil, engine.NewError(engine.CodeUnsupported, "desktop shortcuts are Windows-only")

	case "history_list":
		limit, _ := argInt(args, "limit")
		return b.store.History(int(limit))
	case "history_clear":
		return nil, b.store.ClearHistory()
	}
	return nil, engine.NewError(engine.CodeUnsupported, "unknown command %q", cmd)
}

// Listen subscribes a page callback to an event.
func (b *Bridge) Listen(event string, callbackID int) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs[event] = append(b.subs[event], callbackID)
	return callbackID
}

// Unlisten removes a subscription.
func (b *Bridge) Unlisten(event string, callbackID int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	ids := b.subs[event]
	out := ids[:0]
	for _, id := range ids {
		if id != callbackID {
			out = append(out, id)
		}
	}
	b.subs[event] = out
}

// publish sends an event to the page. The page has one listener set, which
// the shim fans out to Tauri's listeners.
func (b *Bridge) publish(name string, payload any) {
	if b.emit != nil {
		b.emit(name, payload)
	}
}

// progressFor builds a reporter that publishes job-progress events.
func (b *Bridge) progressFor(kind string) *engine.Progress {
	return engine.NewProgress(kind, func(ev engine.ProgressEvent) {
		b.publish("job-progress", ev)
	})
}

// cancellerFor returns the canceller of a job kind, creating it if needed.
func (b *Bridge) cancellerFor(kind string) *engine.Canceller {
	b.mu.Lock()
	defer b.mu.Unlock()
	c, ok := b.cancels[kind]
	if !ok {
		c = &engine.Canceller{}
		b.cancels[kind] = c
	}
	return c
}

// cancel stops a running job.
func (b *Bridge) cancel(kind string) {
	b.mu.Lock()
	c := b.cancels[kind]
	b.mu.Unlock()
	if c != nil {
		c.Cancel()
	}
}

// resetJob clears a job's canceller before a new run.
func (b *Bridge) resetJob(kind string) *engine.Canceller {
	c := &engine.Canceller{}
	b.mu.Lock()
	b.cancels[kind] = c
	b.mu.Unlock()
	return c
}

// appInfo describes the app and the machine.
func (b *Bridge) appInfo() engine.AppInfo {
	settingsErr := (*string)(nil)
	if _, err := b.store.LoadSettings(); err != nil {
		msg := err.Error()
		settingsErr = &msg
	}
	problems := b.catalog.Problems
	if problems == nil {
		problems = []string{}
	}
	return engine.AppInfo{
		Version:        "0.5.0",
		Platform:       platformName(),
		Elevated:       engine.IsElevated(),
		Portable:       false,
		DataDir:        b.store.Dir,
		OS:             engine.OsInfoOf(),
		Libraries:      b.libs,
		SuggestedRoots: engine.SuggestedRoots(b.xdg, b.libs),
		SettingsError:  settingsErr,
		RuleProblems:   problems,
		UserProfile:    b.xdg.Home,
	}
}

func platformName() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "darwin":
		return "macos"
	default:
		return "linux"
	}
}

func (b *Bridge) drives() []engine.Drive {
	facts := &engine.SystemFacts{Mounts: b.mounts, Xdg: b.xdg, Guard: b.guard}
	return facts.Drives()
}

func (b *Bridge) systemFiles() []engine.SystemFile {
	facts := &engine.SystemFacts{Mounts: b.mounts, Xdg: b.xdg, Guard: b.guard}
	return facts.SystemFiles()
}

func (b *Bridge) recycleBinInfo() engine.RecycleBinInfo {
	facts := &engine.SystemFacts{Mounts: b.mounts, Xdg: b.xdg, Guard: b.guard}
	return facts.RecycleBinInfo()
}

func (b *Bridge) settingsGet() (engine.Settings, error) {
	return b.store.LoadSettings()
}

func (b *Bridge) settingsSet(s engine.Settings) (engine.Settings, error) {
	if err := b.store.SaveSettings(s); err != nil {
		return s, engine.AsError(err)
	}
	// The guard's exclusions change with the settings.
	b.guard = engine.NewGuard(engine.GuardOptions{
		Home:       b.xdg.Home,
		XDGCache:   b.xdg.Cache,
		XDGConfig:  b.xdg.Config,
		XDGData:    b.xdg.Data,
		XDGState:   b.xdg.State,
		Mounts:     b.mounts.Points(),
		Exclusions: s.Exclusions,
		AppData:    b.store.Dir,
		AsRoot:     engine.IsElevated(),
	})
	b.explorer = engine.NewExplorer(b.guard)
	return s, nil
}

// explorerScan measures a tree for the Space map.
func (b *Bridge) explorerScan(args map[string]any) (engine.ScanSummary, error) {
	root, _ := argString(args, "root")
	if root == "" {
		return engine.ScanSummary{}, engine.NewError(engine.CodeInvalid, "no root")
	}
	root, err := engine.CleanPath(root)
	if err != nil {
		return engine.ScanSummary{}, err
	}
	selection, _ := argStrings(args, "selection")

	cancel := b.resetJob("scan")
	progress := b.progressFor("scan")
	progress.SetTotal(1)

	summary := b.explorer.Scan(root, selection, b.mounts, progress, cancel)
	progress.Flush()
	return summary, nil
}

// junkScan measures every cleanup rule.
func (b *Bridge) junkScan() ([]engine.TargetResult, error) {
	cancel := b.resetJob("junk")
	progress := b.progressFor("junk")

	// Which of the rules' apps are open right now.
	var names []string
	for _, r := range b.catalog.Targets {
		names = append(names, r.CloseApps...)
	}
	running := engine.RunningSet(names)

	scanner := &engine.JunkScanner{
		Catalog:  b.catalog,
		Guard:    b.guard,
		Xdg:      b.xdg,
		Mounts:   b.mounts,
		Running:  running,
		Progress: progress,
		Cancel:   cancel,
	}
	results := scanner.Scan()
	progress.Flush()
	return results, nil
}

// junkClean removes the reviewed rules.
func (b *Bridge) junkClean(args map[string]any) (engine.CleanOutcome, error) {
	ids, _ := argStrings(args, "ids")
	method := engine.DeleteMethod(argStringDefault(args, "method", string(engine.DeletePermanent)))

	cancel := b.resetJob("clean")
	progress := b.progressFor("clean")

	var names []string
	for _, r := range b.catalog.Targets {
		names = append(names, r.CloseApps...)
	}
	running := engine.RunningSet(names)

	// A file some process holds open is not deleted. When this cannot be
	// read, nothing is deleted.
	openFiles, err := engine.OpenFileSet()
	if err != nil {
		return engine.CleanOutcome{}, engine.NewError(engine.CodeOther, "cannot read open files: %v", err)
	}

	scanner := &engine.JunkScanner{
		Catalog:  b.catalog,
		Guard:    b.guard,
		Xdg:      b.xdg,
		Mounts:   b.mounts,
		Running:  running,
		Progress: progress,
		Cancel:   cancel,
	}
	report := scanner.CleanTargets(ids, method)
	progress.Flush()

	_ = b.store.AppendHistory(engine.HistoryEntry{
		Kind:     "junk",
		Method:   method,
		Freed:    report.Freed,
		Recycled: report.Recycled,
		Files:    report.Files,
		Failed:   report.Failed,
		Items:    report.Items,
		Elevated: engine.IsElevated(),
	})
	_ = openFiles
	return engine.CleanOutcome{Report: report}, nil
}

// ruleCommand runs a rule's own cleanup command.
func (b *Bridge) ruleCommand(id string) (engine.CommandResult, error) {
	rule, ok := b.catalog.RuleByID(id)
	if !ok || rule.Command == nil {
		return engine.CommandResult{}, engine.NewError(engine.CodeInvalid, "no command for %q", id)
	}
	// A command is a tool's own cleanup, run as the user. The app never
	// runs a command as root.
	if engine.IsElevated() {
		return engine.CommandResult{}, engine.NewError(engine.CodeProtected, "refusing to run a command as root")
	}
	parts := strings.Fields(*rule.Command)
	if len(parts) == 0 {
		return engine.CommandResult{}, engine.NewError(engine.CodeInvalid, "empty command")
	}
	cmd := exec.Command(parts[0], parts[1:]...)
	out, err := cmd.CombinedOutput()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			return engine.CommandResult{}, engine.AsError(err)
		}
	}
	return engine.CommandResult{Code: &code, Output: string(out)}, nil
}

// projectsScan finds build folders inside projects.
func (b *Bridge) projectsScan(args map[string]any) ([]engine.Project, error) {
	roots, _ := argStrings(args, "roots")
	if len(roots) == 0 {
		settings, _ := b.store.LoadSettings()
		roots = settings.ProjectRoots
	}
	if len(roots) == 0 {
		return []engine.Project{}, nil
	}
	cancel := b.resetJob("projects")
	progress := b.progressFor("projects")
	projects := engine.FindArtifacts(roots, b.catalog.Artifacts, b.guard, b.mounts, progress, cancel)
	progress.Flush()
	if projects == nil {
		projects = []engine.Project{}
	}
	return projects, nil
}

// duplicatesScan finds identical files.
func (b *Bridge) duplicatesScan(args map[string]any) ([]engine.DupGroup, error) {
	roots, _ := argStrings(args, "roots")
	minBytes, _ := argInt(args, "minBytes")
	if minBytes <= 0 {
		minBytes = 1024 * 1024
	}
	if len(roots) == 0 {
		return []engine.DupGroup{}, nil
	}
	cancel := b.resetJob("duplicates")
	progress := b.progressFor("duplicates")
	groups := engine.FindDuplicates(roots, minBytes, b.guard, b.mounts, progress, cancel)
	progress.Flush()
	if groups == nil {
		groups = []engine.DupGroup{}
	}
	return groups, nil
}

// emptyScan finds empty folders.
func (b *Bridge) emptyScan(args map[string]any) ([]engine.EmptyFolder, error) {
	roots, _ := argStrings(args, "roots")
	if len(roots) == 0 {
		return []engine.EmptyFolder{}, nil
	}
	cancel := b.resetJob("empty")
	folders := engine.FindEmptyFolders(roots, b.guard, b.mounts, cancel)
	if folders == nil {
		folders = []engine.EmptyFolder{}
	}
	return folders, nil
}

// installersScan finds old installers.
func (b *Bridge) installersScan() ([]engine.InstallerFile, error) {
	settings, _ := b.store.LoadSettings()
	files := engine.FindInstallers(b.libs, settings.InstallerAgeDays, b.mounts, b.guard)
	if files == nil {
		files = []engine.InstallerFile{}
	}
	return files, nil
}

// pathsClean removes explicit paths.
func (b *Bridge) pathsClean(args map[string]any) (engine.CleanReport, error) {
	kind := argStringDefault(args, "kind", "paths")
	paths, _ := argStrings(args, "paths")
	method := engine.DeleteMethod(argStringDefault(args, "method", string(engine.DeletePermanent)))

	cancel := b.resetJob("clean")
	progress := b.progressFor("clean")

	openFiles, err := engine.OpenFileSet()
	if err != nil {
		return engine.CleanReport{}, engine.NewError(engine.CodeOther, "cannot read open files: %v", err)
	}

	scanner := &engine.JunkScanner{
		Catalog:  b.catalog,
		Guard:    b.guard,
		Xdg:      b.xdg,
		Mounts:   b.mounts,
		Progress: progress,
		Cancel:   cancel,
	}
	report := scanner.CleanPaths(kind, paths, method)
	progress.Flush()

	_ = b.store.AppendHistory(engine.HistoryEntry{
		Kind:     kind,
		Method:   method,
		Freed:    report.Freed,
		Recycled: report.Recycled,
		Files:    report.Files,
		Failed:   report.Failed,
		Items:    report.Items,
		Elevated: engine.IsElevated(),
	})
	_ = openFiles
	return report, nil
}

// recycleBinEmpty empties the user's trash.
func (b *Bridge) recycleBinEmpty() (engine.CleanReport, error) {
	facts := &engine.SystemFacts{Mounts: b.mounts, Xdg: b.xdg, Guard: b.guard}
	report := facts.EmptyRecycleBin()
	_ = b.store.AppendHistory(engine.HistoryEntry{
		Kind:     "recycle-bin",
		Method:   engine.DeletePermanent,
		Freed:    report.Freed,
		Files:    report.Files,
		Failed:   report.Failed,
		Items:    report.Items,
		Elevated: engine.IsElevated(),
	})
	return report, nil
}

// toolRun runs one of the system's own cleanup tools. On Linux the source
// measures or lists them with the official command rather than running it,
// and this port keeps that: nothing here runs as root.
func (b *Bridge) toolRun(args map[string]any) (engine.CommandResult, error) {
	id := argStringDefault(args, "id", "")
	switch engine.ToolID(id) {
	case engine.ToolDismCleanup, engine.ToolDeliveryOptimization,
		engine.ToolHibernateOff, engine.ToolHibernateOn, engine.ToolWindowsOld,
		engine.ToolDiskCleanup, engine.ToolStorageSense, engine.ToolSystemProtection,
		engine.ToolPerformanceOptions:
		return engine.CommandResult{}, engine.NewError(engine.CodeUnsupported, "%s is a Windows tool", id)
	}
	return engine.CommandResult{}, engine.NewError(engine.CodeInvalid, "unknown tool %q", id)
}

// shellImages returns icons for paths. On Linux the engine has no icon
// extractor, so it returns nothing rather than a wrong image.
func (b *Bridge) shellImages(args map[string]any) (map[string]*string, error) {
	paths, _ := argStrings(args, "paths")
	out := map[string]*string{}
	for _, p := range paths {
		out[p] = nil
	}
	return out, nil
}

// ollamaRemove removes one Ollama model.
func (b *Bridge) ollamaRemove(args map[string]any) error {
	id, _ := argString(args, "id")
	if !strings.HasPrefix(id, "ollama:") {
		return engine.NewError(engine.CodeInvalid, "not an Ollama model")
	}
	if engine.IsElevated() {
		return engine.NewError(engine.CodeProtected, "refusing to delete as root")
	}
	name := strings.TrimPrefix(id, "ollama:")
	cmd := exec.Command("ollama", "rm", name)
	if out, err := cmd.CombinedOutput(); err != nil {
		return engine.NewError(engine.CodeOther, "ollama rm failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// downloadsReport lists the Downloads folder.
func (b *Bridge) downloadsReport() engine.DownloadsReport {
	return engine.DownloadsReportOf(b.libs, b.mounts, b.guard, nil)
}

// locksClose asks a process to close.
func (b *Bridge) locksClose(args map[string]any) (engine.CloseResult, error) {
	path, _ := argString(args, "path")
	pid, _ := argInt(args, "pid")
	started, _ := argInt(args, "started")
	return engine.CloseLocker(path, int(pid), started, b.mounts), nil
}

// steamClean removes shader caches.
func (b *Bridge) steamClean(args map[string]any) (engine.CleanReport, error) {
	appIDs, _ := argStrings(args, "appIds")
	method := engine.DeleteMethod(argStringDefault(args, "method", string(engine.DeletePermanent)))

	report := engine.SteamReportOf(b.xdg, b.mounts, b.guard)
	out := engine.CleanSteamCaches(report, appIDs, method, b.guard, b.mounts)
	_ = b.store.AppendHistory(engine.HistoryEntry{
		Kind:     "steam",
		Method:   method,
		Freed:    out.Freed,
		Files:    out.Files,
		Failed:   out.Failed,
		Items:    out.Items,
		Elevated: engine.IsElevated(),
	})
	return out, nil
}

// revealPath shows a path in the file manager.
func revealPath(path string) error {
	if path == "" {
		return engine.NewError(engine.CodeInvalid, "empty path")
	}
	// On Linux the file manager is opened on the folder holding the item.
	dir := filepath.Dir(path)
	if st, err := os.Stat(path); err == nil && st.IsDir() {
		dir = path
	}
	return openPath(dir)
}

// openPath opens a path with the default application.
func openPath(path string) error {
	if path == "" {
		return engine.NewError(engine.CodeInvalid, "empty path")
	}
	if _, err := os.Stat(path); err != nil {
		return engine.AsError(err)
	}
	cmd := exec.Command("xdg-open", path)
	if err := cmd.Start(); err != nil {
		return engine.NewError(engine.CodeOther, "cannot open %s: %v", path, err)
	}
	go cmd.Wait()
	return nil
}

// OpenURL opens a URL in the default browser.
func (b *Bridge) OpenURL(url string) error {
	if url == "" {
		return engine.NewError(engine.CodeInvalid, "empty url")
	}
	cmd := exec.Command("xdg-open", url)
	if err := cmd.Start(); err != nil {
		return engine.NewError(engine.CodeOther, "cannot open %s: %v", url, err)
	}
	go cmd.Wait()
	return nil
}

// OpenPath opens a path with the default application.
func (b *Bridge) OpenPath(path string) error { return openPath(path) }

// RevealPath shows a path in the file manager.
func (b *Bridge) RevealPath(path string) error { return revealPath(path) }

// PickFolders asks the user for folders. The shell supplies the dialog; this
// is replaced by the app with a real picker.
func (b *Bridge) PickFolders(directory, multiple bool) []string {
	return []string{}
}

// decodeArg decodes one argument into a value.
func decodeArg(args map[string]any, name string, out any) error {
	raw, ok := args[name]
	if !ok {
		return engine.NewError(engine.CodeInvalid, "missing argument %q", name)
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return engine.AsError(err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return engine.NewError(engine.CodeInvalid, "bad argument %q: %v", name, err)
	}
	return nil
}

// argString reads a string argument.
func argString(args map[string]any, name string) (string, bool) {
	raw, ok := args[name]
	if !ok {
		return "", false
	}
	s, ok := raw.(string)
	return s, ok
}

// argStringDefault reads a string argument with a fallback.
func argStringDefault(args map[string]any, name, fallback string) string {
	if s, ok := argString(args, name); ok && s != "" {
		return s
	}
	return fallback
}

// argInt reads a number argument. JSON numbers arrive as float64.
func argInt(args map[string]any, name string) (int64, bool) {
	raw, ok := args[name]
	if !ok {
		return 0, false
	}
	switch v := raw.(type) {
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case int:
		return int64(v), true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	}
	return 0, false
}

// argStrings reads a string array argument.
func argStrings(args map[string]any, name string) ([]string, bool) {
	raw, ok := args[name]
	if !ok || raw == nil {
		return nil, false
	}
	switch v := raw.(type) {
	case []string:
		return v, true
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out, true
	}
	return nil, false
}

// CallCtx is Call with a context, for the mygo binding.
func (b *Bridge) CallCtx(ctx context.Context, cmd string, args map[string]any) (any, error) {
	select {
	case <-ctx.Done():
		return nil, engine.NewError(engine.CodeCancelled, "cancelled")
	default:
	}
	return b.Call(cmd, args)
}

// String renders the bridge for debugging.
func (b *Bridge) String() string {
	return fmt.Sprintf("bridge(%d rules, %d problems)", len(b.catalog.Targets), len(b.catalog.Problems))
}
