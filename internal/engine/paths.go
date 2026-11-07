package engine

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Error is an engine error with a stable code the UI switches on.
type Error struct {
	Code string
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

// NewError builds an engine error.
func NewError(code, format string, args ...any) *Error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, args...)}
}

// Stable error codes, as the UI expects them.
const (
	CodeProtected   = "protected"
	CodeExcluded    = "excluded"
	CodeOutsideHome = "outside_home"
	CodeNotFound    = "not_found"
	CodeUnsupported = "unsupported"
	CodeCancelled   = "cancelled"
	CodeInUse       = "in_use"
	CodeUnreadable  = "unreadable_name"
	CodePermission  = "permission"
	CodeInvalid     = "invalid"
	CodeOther       = "other"
)

// AsError maps any error to an engine error, keeping a code when there is one.
func AsError(err error) *Error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if errors.Is(err, os.ErrPermission) {
		return &Error{Code: CodePermission, Msg: err.Error()}
	}
	if errors.Is(err, os.ErrNotExist) {
		return &Error{Code: CodeNotFound, Msg: err.Error()}
	}
	return &Error{Code: CodeOther, Msg: err.Error()}
}

// Origin says who asked for a delete: a rule from the catalog, or the user
// naming a path by hand.
type Origin int

const (
	// OriginRule is a cleanup rule, which may name a browser profile's
	// Service Worker cache.
	OriginRule Origin = iota
	// OriginUser is a path the user picked.
	OriginUser
)

// Folder names that are never deleted wherever they appear. Only an "empty
// trash" action may touch a trash folder.
var protectedNames = []string{".git", "lost+found", ".Trash"}

func isProtectedName(seg string) bool {
	for _, p := range protectedNames {
		if seg == p {
			return true
		}
	}
	return strings.HasPrefix(seg, ".Trash-")
}

// Nothing inside these may be deleted: kernels and bootloaders, files the
// package manager owns, kernel interfaces, package databases and read-only
// system trees.
var linuxSubtree = []string{
	"/boot", "/efi", "/boot/efi", "/usr", "/bin", "/sbin", "/lib", "/lib32",
	"/lib64", "/libx32", "/etc", "/proc", "/sys", "/dev", "/run", "/var/lib",
	"/snap", "/nix/store", "/sysroot", "/ostree",
}

// May not be removed or emptied as a whole; rules may target named children.
var linuxNoWipe = []string{
	"/", "/home", "/root", "/opt", "/srv", "/usr/local", "/var", "/var/cache",
	"/var/log", "/var/tmp", "/tmp", "/var/spool", "/var/mail", "/var/crash",
	"/media", "/mnt",
}

// Below the home folder, under the same rule as linuxNoWipe.
var homeNoWipe = []string{
	".config", ".local", ".local/share", ".local/state", ".local/bin",
	".cache", ".var", ".var/app", "snap", ".local/share/flatpak",
}

// Common names of the user's folders. user-dirs.dirs is what counts, but it
// can be missing on a minimal desktop, and then these are still the user's
// own folders.
var homeUserFolders = []string{
	"Desktop", "Downloads", "Templates", "Public", "Documents", "Music",
	"Pictures", "Videos",
}

// Below the home folder: keys and passwords, mail, wallets, browser profiles
// without an HTTP cache of their own, and what decides which programs start.
// Never inside a rule.
var homePrecious = []string{
	".ssh", ".gnupg", ".password-store", ".local/share/keyrings",
	".gnome2/keyrings", ".local/share/kwalletd", ".pki", ".mozilla",
	".config/mozilla", ".librewolf", ".config/librewolf", ".zen", ".waterfox",
	".thunderbird", ".mozilla-thunderbird", ".config/thunderbird",
	".local/share/evolution", ".bitcoin", ".electrum", ".ethereum", ".kube",
	".docker/config.json", ".local/share/applications", ".config/autostart",
	".config/systemd",
	// The freedesktop trash. Only an "empty trash" action may touch it, and
	// that action removes items itself rather than going through the guard.
	".local/share/Trash",
}

// Browser profiles below the config folder. These browsers keep their HTTP
// cache in ~/.cache, so the profile can be protected whole.
var browserProfiles = []string{
	"google-chrome", "google-chrome-beta", "google-chrome-unstable",
	"chromium", "microsoft-edge", "vivaldi", "opera", "net.imput.helium",
}

// Brave adds a folder for its channel: BraveSoftware/Brave-Browser/<profile>.
var browserProfilesInChannels = []string{"BraveSoftware"}

// Guard refuses deletes that would reach something the user cannot afford to
// lose. It is the only thing standing between a rule and the file system, so
// it is built from facts, not from the UI's state.
type Guard struct {
	home         []string
	subtree      []string
	whole        []string
	precious     []string
	browserRoots [][2]interface{} // (root string, depth int)
	exclusions   []string
	appData      string
	refuseAll    string
}

// browserRoot is a protected browser profile and how deep its profile folder
// sits below it.
type browserRoot struct {
	root  string
	depth int
}

// GuardOptions are the facts a guard is built from.
type GuardOptions struct {
	Home       string
	XDGCache   string
	XDGConfig  string
	XDGData    string
	XDGState   string
	Mounts     []string
	Exclusions []string
	AppData    string
	AsRoot     bool
	// PasswordStore is the resolved path of a password store, if any.
	PasswordStore string
}

// NewGuard builds the guard for the current user.
func NewGuard(opts GuardOptions) *Guard {
	g := &Guard{
		exclusions: normalizeAll(opts.Exclusions),
		appData:    opts.AppData,
	}
	if opts.AsRoot {
		g.refuseAll = "running as root"
	}
	home := opts.Home
	if home == "" {
		return g
	}
	g.home = []string{key(home)}

	// System trees.
	for _, p := range linuxSubtree {
		g.subtree = append(g.subtree, key(p))
	}
	// Folders that may not go as a whole.
	for _, p := range linuxNoWipe {
		g.whole = append(g.whole, key(p))
	}
	g.whole = append(g.whole, key(home))
	for _, sub := range homeNoWipe {
		g.whole = append(g.whole, key(filepath.Join(home, sub)))
	}
	for _, sub := range homeUserFolders {
		g.whole = append(g.whole, key(filepath.Join(home, sub)))
	}
	// The XDG folders themselves.
	for _, x := range []string{opts.XDGCache, opts.XDGConfig, opts.XDGData, opts.XDGState} {
		if x != "" {
			g.whole = append(g.whole, key(x))
		}
	}
	// Every mount point.
	for _, m := range opts.Mounts {
		if m != "" {
			g.whole = append(g.whole, key(m))
		}
	}
	// Private user data.
	for _, sub := range homePrecious {
		g.precious = append(g.precious, key(filepath.Join(home, sub)))
	}
	if opts.PasswordStore != "" {
		g.precious = append(g.precious, key(opts.PasswordStore))
	}
	// Browser profiles below the config folder.
	config := opts.XDGConfig
	if config == "" {
		config = filepath.Join(home, ".config")
	}
	for _, name := range browserProfiles {
		g.addBrowserRoot(filepath.Join(config, name), 0)
	}
	for _, ch := range browserProfilesInChannels {
		g.addBrowserRoot(filepath.Join(config, ch, "Brave-Browser"), 0)
	}
	return g
}

func (g *Guard) addBrowserRoot(root string, depth int) {
	g.browserRoots = append(g.browserRoots, [2]interface{}{key(root), depth})
}

// browserRootsList decodes the packed roots.
func (g *Guard) browserRootsList() []browserRoot {
	out := make([]browserRoot, 0, len(g.browserRoots))
	for _, r := range g.browserRoots {
		out = append(out, browserRoot{root: r[0].(string), depth: r[1].(int)})
	}
	return out
}

// Check refuses a path that may not be deleted.
func (g *Guard) Check(path string, origin Origin) error {
	return g.check(path, origin, g.whole)
}

// CheckWipe refuses a folder that may not be emptied.
func (g *Guard) CheckWipe(dir string) error {
	return g.check(dir, OriginUser, g.whole)
}

func (g *Guard) check(path string, origin Origin, whole []string) error {
	deny := func(why string) error {
		return NewError(CodeProtected, "%s (%s)", path, why)
	}
	if g.refuseAll != "" {
		return deny(g.refuseAll)
	}
	if !filepath.IsAbs(path) {
		return deny("not absolute")
	}
	// A "." or ".." segment is refused before cleaning hides it: the path
	// the user wrote is the path they meant.
	for _, seg := range strings.Split(filepath.ToSlash(path), "/") {
		if seg == ".." || seg == "." {
			return deny("not absolute")
		}
	}
	written := key(path)

	// The path as written is what the rules are checked against: a rule may
	// name a folder inside a protected one, which is the whole point of a
	// cache rule.
	if err := g.checkOne(written, origin, whole); err != nil {
		return err
	}

	// The real location is what a delete would reach, so it must be inside
	// the home folder. A link's parent is resolved, but the last name is
	// not followed: a link is checked itself.
	real, ok := resolveParent(path)
	if !ok {
		return deny("root folder")
	}
	realKey := key(real)
	if realKey != written {
		if err := g.checkOne(realKey, origin, whole); err != nil {
			return err
		}
	}
	if !g.insideHome(realKey) {
		return deny("outside the home folder")
	}
	return nil
}

// checkOne applies every rule to one spelling of a path.
func (g *Guard) checkOne(k string, origin Origin, whole []string) error {
	deny := func(why string) error {
		return NewError(CodeProtected, "%s (%s)", k, why)
	}
	if isDriveRoot(k) {
		return deny("root folder")
	}
	for _, seg := range strings.Split(k, "/") {
		if isProtectedName(seg) {
			return deny("protected folder")
		}
	}
	// Removing a folder removes everything protected below it, so ancestors
	// count too.
	for _, p := range whole {
		if isWithin(p, k) {
			return deny("system or user folder")
		}
	}
	for _, p := range g.subtree {
		if isWithin(k, p) || isWithin(p, k) {
			return deny("system folder")
		}
	}
	for _, p := range g.precious {
		if isWithin(k, p) || isWithin(p, k) {
			return deny("private user data")
		}
	}
	if g.touchesBrowserProfile(k, origin) {
		return deny("private user data")
	}
	if g.isExcluded(k) {
		return deny("excluded in settings")
	}
	return nil
}

func (g *Guard) insideHome(k string) bool {
	for _, h := range g.home {
		if isWithin(k, h) {
			return true
		}
	}
	return false
}

// touchesBrowserProfile reports whether k is a browser profile, or inside one
// except its Service Worker cache, which a rule may name.
func (g *Guard) touchesBrowserProfile(k string, origin Origin) bool {
	for _, br := range g.browserRootsList() {
		if isWithin(br.root, k) {
			return true
		}
		rest, ok := strings.CutPrefix(k, br.root)
		if !ok {
			continue
		}
		rest, ok = strings.CutPrefix(rest, "/")
		if !ok {
			continue
		}
		segs := strings.Split(rest, "/")
		cache := len(segs) > br.depth+2 &&
			segs[br.depth+1] == "Service Worker" &&
			segs[br.depth+2] == "CacheStorage"
		if !(origin == OriginRule && cache) {
			return true
		}
	}
	return false
}

// IsPrivate reports whether a path is private user data, which scans for
// duplicates and large files stay out of.
func (g *Guard) IsPrivate(path string) bool {
	k := key(path)
	for _, p := range g.precious {
		if isWithin(k, p) || isWithin(p, k) {
			return true
		}
	}
	return g.touchesBrowserProfile(k, OriginUser)
}

func (g *Guard) isExcluded(k string) bool {
	for _, ex := range g.exclusions {
		if isWithin(k, ex) || isWithin(ex, k) {
			return true
		}
	}
	return false
}

// ExclusionsInside lists the user's exclusions below a folder, so a clean can
// skip them.
func (g *Guard) ExclusionsInside(dir string) []string {
	d := key(dir)
	var out []string
	for _, ex := range g.exclusions {
		if isWithin(ex, d) && ex != d {
			out = append(out, ex)
		}
	}
	return out
}

// IsExcluded reports whether a path is excluded in settings.
func (g *Guard) IsExcluded(path string) bool { return g.isExcluded(key(path)) }

// key normalizes a path for comparison: absolute, cleaned, forward slashes,
// no trailing slash. Linux compares exact bytes, without lowercasing.
func key(p string) string {
	if p == "" {
		return ""
	}
	c := filepath.Clean(p)
	c = filepath.ToSlash(c)
	if len(c) > 1 && strings.HasSuffix(c, "/") {
		c = strings.TrimSuffix(c, "/")
	}
	return c
}

func normalizeAll(paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		out = append(out, key(p))
	}
	return out
}

// isWithin reports whether child is parent or below it.
func isWithin(child, parent string) bool {
	if parent == "" || child == "" {
		return false
	}
	if child == parent {
		return true
	}
	if parent == "/" {
		return strings.HasPrefix(child, "/")
	}
	return strings.HasPrefix(child, parent+"/")
}

// isDriveRoot reports whether a key is a file system root.
func isDriveRoot(k string) bool {
	if k == "/" {
		return true
	}
	// A Windows drive root, should one ever reach this code.
	if len(k) == 2 && k[1] == ':' {
		return true
	}
	return false
}

// resolveParent resolves a path's parent, so a folder link cannot lead a
// delete elsewhere. The last name is not followed: a link is checked itself.
func resolveParent(path string) (string, bool) {
	parent := filepath.Dir(path)
	if parent == path {
		return "", false
	}
	real, err := filepath.EvalSymlinks(parent)
	if err != nil {
		// The parent may not exist yet, or may not be readable. Fall back to
		// the path itself, cleaned: still an absolute location, and still
		// the thing a delete would reach.
		return filepath.Clean(path), true
	}
	return filepath.Join(real, filepath.Base(path)), true
}
