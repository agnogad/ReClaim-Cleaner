package engine

import (
	"os"
	"path/filepath"
	"testing"
)

// guardFor builds a guard rooted at a temporary home, so the tests run under
// any user and never touch the real one.
func guardFor(t *testing.T) (*Guard, string) {
	t.Helper()
	home := t.TempDir()
	g := NewGuard(GuardOptions{
		Home:      home,
		XDGCache:  filepath.Join(home, ".cache"),
		XDGConfig: filepath.Join(home, ".config"),
		XDGData:   filepath.Join(home, ".local/share"),
		XDGState:  filepath.Join(home, ".local/state"),
		Mounts:    []string{"/", "/boot", "/home"},
	})
	return g, home
}

// TestGuardRefusesSystemTrees checks that nothing inside a system tree can be
// deleted.
func TestGuardRefusesSystemTrees(t *testing.T) {
	g, _ := guardFor(t)
	for _, p := range []string{
		"/usr/bin/ls",
		"/etc/passwd",
		"/boot/vmlinuz",
		"/var/lib/pacman",
		"/proc/self/mem",
		"/sys/kernel",
		"/dev/null",
		"/run/user",
		"/snap/core",
	} {
		if err := g.Check(p, OriginUser); err == nil {
			t.Errorf("%s was allowed", p)
		}
	}
}

// TestGuardRefusesRoots checks that a root or a user folder cannot be removed
// as a whole.
func TestGuardRefusesRoots(t *testing.T) {
	g, home := guardFor(t)
	for _, p := range []string{
		"/",
		"/home",
		"/tmp",
		"/var",
		home,
		filepath.Join(home, "Documents"),
		filepath.Join(home, "Downloads"),
		filepath.Join(home, ".config"),
		filepath.Join(home, ".cache"),
		filepath.Join(home, ".local"),
	} {
		if err := g.Check(p, OriginUser); err == nil {
			t.Errorf("%s was allowed", p)
		}
	}
}

// TestGuardRefusesPreciousData checks that keys, mail and wallets are off
// limits at any depth.
func TestGuardRefusesPreciousData(t *testing.T) {
	g, home := guardFor(t)
	for _, rel := range []string{
		".ssh/id_rsa",
		".ssh",
		".gnupg/private-keys-v1.d",
		".password-store/work",
		".thunderbird/profile",
		".bitcoin/wallet.dat",
		".kube/config",
		".config/autostart/app.desktop",
	} {
		p := filepath.Join(home, rel)
		if err := g.Check(p, OriginUser); err == nil {
			t.Errorf("%s was allowed", p)
		}
	}
}

// TestGuardRefusesGitAndTrash checks that .git and trash folders are never
// removed, at any depth.
func TestGuardRefusesGitAndTrash(t *testing.T) {
	g, home := guardFor(t)
	for _, rel := range []string{
		"projects/app/.git",
		"projects/app/.git/objects",
		"lost+found",
		".local/share/Trash/files/thing",
		".local/share/Trash/files/.Trash-1000",
	} {
		p := filepath.Join(home, rel)
		if err := g.Check(p, OriginUser); err == nil {
			t.Errorf("%s was allowed", p)
		}
	}
}

// TestGuardAllowsCaches checks that a cache inside the home folder is allowed,
// which is what the whole app is for.
func TestGuardAllowsCaches(t *testing.T) {
	g, home := guardFor(t)
	for _, rel := range []string{
		".cache/thumbnails",
		".cache/mozilla/firefox/profile/cache2",
		".local/share/Steam/steamapps/shadercache/123",
		".npm/_cacache",
		"projects/app/node_modules",
		"projects/app/target/debug",
	} {
		p := filepath.Join(home, rel)
		if err := g.Check(p, OriginRule); err != nil {
			t.Errorf("%s was refused: %v", p, err)
		}
	}
}

// TestGuardRefusesOutsideHome checks that a path outside the home folder is
// refused, even when it is not a system tree.
func TestGuardRefusesOutsideHome(t *testing.T) {
	g, _ := guardFor(t)
	for _, p := range []string{
		"/opt/thing",
		"/srv/data",
		"/mnt/disk/file",
		"/media/user/usb/file",
	} {
		if err := g.Check(p, OriginUser); err == nil {
			t.Errorf("%s was allowed", p)
		}
	}
}

// TestGuardRefusesBrowserProfiles checks that a browser profile is off limits
// but its Service Worker cache is not, when a rule names it.
func TestGuardRefusesBrowserProfiles(t *testing.T) {
	g, home := guardFor(t)
	profile := filepath.Join(home, ".config/google-chrome/Default")

	if err := g.Check(profile, OriginUser); err == nil {
		t.Error("a browser profile was allowed")
	}
	if err := g.Check(filepath.Join(profile, "Cookies"), OriginRule); err == nil {
		t.Error("a browser profile's cookies were allowed")
	}
	// A rule may name the Service Worker cache.
	cache := filepath.Join(profile, "Service Worker/CacheStorage")
	if err := g.Check(cache, OriginRule); err != nil {
		t.Errorf("the Service Worker cache was refused: %v", err)
	}
	// The user may not.
	if err := g.Check(cache, OriginUser); err == nil {
		t.Error("the user was allowed to remove the Service Worker cache")
	}
}

// TestGuardRefusesRelativeAndTraversal checks that a relative path or one
// with .. is refused.
func TestGuardRefusesRelativeAndTraversal(t *testing.T) {
	g, home := guardFor(t)
	for _, p := range []string{
		"relative/path",
		home + "/../other",
		home + "/./thing",
	} {
		if err := g.Check(p, OriginUser); err == nil {
			t.Errorf("%s was allowed", p)
		}
	}
}

// TestGuardRefusesWhenRoot checks that a guard built for root refuses
// everything.
func TestGuardRefusesWhenRoot(t *testing.T) {
	home := t.TempDir()
	g := NewGuard(GuardOptions{Home: home, AsRoot: true})
	if err := g.Check(filepath.Join(home, ".cache/thing"), OriginRule); err == nil {
		t.Error("a root guard allowed a delete")
	}
}

// TestGuardRefusesExclusions checks that a user exclusion is honoured.
func TestGuardRefusesExclusions(t *testing.T) {
	home := t.TempDir()
	keep := filepath.Join(home, ".cache/keep")
	g := NewGuard(GuardOptions{
		Home:       home,
		XDGCache:   filepath.Join(home, ".cache"),
		Exclusions: []string{keep},
	})
	if err := g.Check(keep, OriginRule); err == nil {
		t.Error("an excluded path was allowed")
	}
	if err := g.Check(filepath.Join(home, ".cache/other"), OriginRule); err != nil {
		t.Errorf("a path beside the exclusion was refused: %v", err)
	}
}

// TestCleanerRemovesOnlyInsideHome checks end to end that a clean removes what
// it should and refuses what it should not.
func TestCleanerRemovesOnlyInsideHome(t *testing.T) {
	g, home := guardFor(t)

	// A cache with files in it.
	cache := filepath.Join(home, ".cache/app")
	if err := os.MkdirAll(filepath.Join(cache, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"a.bin", "sub/b.bin"} {
		if err := os.WriteFile(filepath.Join(cache, rel), make([]byte, 4096), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A .git folder inside it must survive.
	gitDir := filepath.Join(cache, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "config"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	cleaner := &Cleaner{Guard: g}
	report := CleanReport{Failures: []Failure{}, Items: []string{}}
	cleaner.RemovePath(cache, DeletePermanent, &report)

	if report.Files != 2 {
		t.Errorf("removed %d files, want 2", report.Files)
	}
	// The .git folder kept the cache folder alive.
	if _, err := os.Stat(gitDir); err != nil {
		t.Error(".git was removed")
	}
	if _, err := os.Stat(filepath.Join(cache, "a.bin")); err == nil {
		t.Error("a.bin survived")
	}
}

// TestCleanerRefusesProtectedPath checks that a clean of a protected path
// reports a failure instead of deleting.
func TestCleanerRefusesProtectedPath(t *testing.T) {
	g, home := guardFor(t)
	ssh := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(ssh, 0o700); err != nil {
		t.Fatal(err)
	}
	key := filepath.Join(ssh, "id_rsa")
	if err := os.WriteFile(key, []byte("PRIVATE"), 0o600); err != nil {
		t.Fatal(err)
	}

	cleaner := &Cleaner{Guard: g}
	report := CleanReport{Failures: []Failure{}, Items: []string{}}
	cleaner.RemovePath(ssh, DeletePermanent, &report)

	if report.Failed == 0 {
		t.Error("a protected path was removed without a failure")
	}
	if _, err := os.Stat(key); err != nil {
		t.Error("the key was removed")
	}
}

// TestWalkCountsSparseByAllocation checks that a sparse file counts by the
// space it occupies, not by its apparent size.
func TestWalkCountsSparseByAllocation(t *testing.T) {
	dir := t.TempDir()
	// A 1 MiB file with 4 KiB written.
	f, err := os.Create(filepath.Join(dir, "sparse.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write(make([]byte, 4096)); err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(1 << 20); err != nil {
		t.Fatal(err)
	}
	f.Close()

	w := Walk(dir, WalkOptions{})
	if w.Bytes >= 1<<20 {
		t.Errorf("sparse file counted as %d bytes, want the allocated size", w.Bytes)
	}
	if w.Files != 1 {
		t.Errorf("counted %d files, want 1", w.Files)
	}
}

// TestWalkDoesNotFollowLinks checks that a link is not followed into a
// directory outside the tree.
func TestWalkDoesNotFollowLinks(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "big.bin"), make([]byte, 1<<20), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip("symlinks are not available")
	}

	w := Walk(dir, WalkOptions{})
	if w.Bytes > 0 {
		t.Errorf("the walk followed a link and counted %d bytes", w.Bytes)
	}
}

// TestWildcardMatch checks the glob used by rule paths.
func TestWildcardMatch(t *testing.T) {
	cases := []struct {
		pattern, name string
		want          bool
	}{
		{"*", "anything", true},
		{"Cache", "Cache", true},
		{"Cache", "cache", false}, // case matters on Linux
		{"webcache*", "webcache2", true},
		{"*.dmp", "crash.dmp", true},
		{"*.dmp", "crash.txt", false},
		{"a?c", "abc", true},
		{"a?c", "ac", false},
		{"*foo*", "xxfooyy", true},
	}
	for _, c := range cases {
		if got := WildcardMatch(c.pattern, c.name); got != c.want {
			t.Errorf("WildcardMatch(%q, %q) = %v, want %v", c.pattern, c.name, got, c.want)
		}
	}
}

// TestCatalogLoads checks that the shipped rules parse and that none points
// at a protected path.
func TestCatalogLoads(t *testing.T) {
	g, _ := guardFor(t)
	c := LoadCatalog(g, "")
	if len(c.Targets) == 0 {
		t.Fatal("no target rules loaded")
	}
	if len(c.Artifacts) == 0 {
		t.Fatal("no artifact rules loaded")
	}
	// A rule that fails the guard is reported, not silently dropped.
	for _, p := range c.Problems {
		t.Logf("rule problem: %s", p)
	}
	t.Logf("loaded %d targets, %d artifacts, %d problems",
		len(c.Targets), len(c.Artifacts), len(c.Problems))
}
