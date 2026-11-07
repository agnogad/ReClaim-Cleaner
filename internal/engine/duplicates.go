package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// dupFile is a candidate the duplicate finder is considering.
type dupFile struct {
	path  string
	size  int64
	mtime int64
	dev   uint64
	ino   uint64
}

// FindDuplicates finds identical files below the given roots. It works in
// three passes, cheapest first: group by size, then by a hash of the first
// 64 KiB, then by a full hash. Hard links are counted once.
func FindDuplicates(roots []string, minBytes int64, guard *Guard, mounts *MountTable, progress *Progress, cancel *Canceller) []DupGroup {
	// Pass 1: collect candidates by size.
	bySize := map[int64][]dupFile{}
	seenInode := map[[2]uint64]bool{}

	for _, root := range roots {
		if cancel != nil && cancel.Cancelled() {
			return nil
		}
		walk := Walk(root, WalkOptions{
			StayOnMount: true,
			SkipPrivate: true,
			Guard:       guard,
			Mounts:      mounts,
			Cancel:      cancel,
		})
		if walk.Root == nil {
			continue
		}
		var collect func(d *DirStat)
		collect = func(d *DirStat) {
			for _, f := range d.Entries {
				if f.Bytes < minBytes {
					continue
				}
				dev, ino, err := DeviceOf(f.Path)
				if err != nil {
					continue
				}
				// A hard link is the same file: count it once.
				key := [2]uint64{dev, ino}
				if seenInode[key] {
					continue
				}
				seenInode[key] = true
				bySize[f.Bytes] = append(bySize[f.Bytes], dupFile{
					path: f.Path, size: f.Bytes, mtime: f.Mtime, dev: dev, ino: ino,
				})
			}
			for _, c := range d.Children {
				collect(c)
			}
		}
		collect(walk.Root)
		if progress != nil {
			progress.Stage("duplicates", root)
		}
	}

	// Pass 2: a partial hash of the first 64 KiB splits the size groups.
	type partialKey struct {
		size int64
		hash string
	}
	byPartial := map[partialKey][]dupFile{}
	for size, files := range bySize {
		if len(files) < 2 {
			continue
		}
		for _, f := range files {
			if cancel != nil && cancel.Cancelled() {
				return nil
			}
			h, err := hashPrefix(f.path, 64*1024)
			if err != nil {
				continue
			}
			k := partialKey{size: size, hash: h}
			byPartial[k] = append(byPartial[k], f)
		}
	}

	// Pass 3: a full hash confirms the groups that survived.
	var groups []DupGroup
	for _, files := range byPartial {
		if len(files) < 2 {
			continue
		}
		byFull := map[string][]dupFile{}
		for _, f := range files {
			if cancel != nil && cancel.Cancelled() {
				return groups
			}
			h, err := hashFull(f.path)
			if err != nil {
				continue
			}
			byFull[h] = append(byFull[h], f)
		}
		for h, same := range byFull {
			if len(same) < 2 {
				continue
			}
			sort.Slice(same, func(i, j int) bool { return same[i].path < same[j].path })
			g := DupGroup{Hash: h, Bytes: same[0].size, Files: []DupFile{}}
			for _, f := range same {
				g.Files = append(g.Files, DupFile{Path: f.path, Mtime: f.mtime})
			}
			// Every copy but one is wasted space.
			g.Wasted = same[0].size * int64(len(same)-1)
			groups = append(groups, g)
		}
	}

	sort.Slice(groups, func(i, j int) bool { return groups[i].Wasted > groups[j].Wasted })
	return groups
}

// hashPrefix hashes the first n bytes of a file.
func hashPrefix(path string, n int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.CopyN(h, f, n); err != nil && err != io.EOF {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)[:16]), nil
}

// hashFull hashes a whole file.
func hashFull(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)[:16]), nil
}

// FindEmptyFolders finds folders with nothing in them, deepest first.
func FindEmptyFolders(roots []string, guard *Guard, mounts *MountTable, cancel *Canceller) []EmptyFolder {
	var out []EmptyFolder
	var mu sync.Mutex

	for _, root := range roots {
		if cancel != nil && cancel.Cancelled() {
			break
		}
		var walk func(dir string, depth int) int
		walk = func(dir string, depth int) int {
			if cancel != nil && cancel.Cancelled() {
				return 0
			}
			if depth > 64 {
				return 0
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				return 0
			}
			// A folder holding only empty folders is itself empty, and is
			// reported with how many folders go with it.
			nested := 0
			hasContent := false
			for _, e := range entries {
				full := filepath.Join(dir, e.Name())
				if e.IsDir() {
					if mounts != nil && mounts.IsMountRoot(full) {
						hasContent = true
						continue
					}
					if guard != nil && (guard.IsPrivate(full) || guard.IsExcluded(full)) {
						hasContent = true
						continue
					}
					n := walk(full, depth+1)
					if n == 0 {
						hasContent = true
					} else {
						nested += n
					}
					continue
				}
				hasContent = true
			}
			if hasContent {
				return 0
			}
			if guard != nil {
				if err := guard.Check(dir, OriginUser); err != nil {
					return 0
				}
			}
			mtime := int64(0)
			if st, err := os.Stat(dir); err == nil {
				mtime = st.ModTime().UnixMilli()
			}
			mu.Lock()
			out = append(out, EmptyFolder{Path: dir, Mtime: mtime, Nested: nested})
			mu.Unlock()
			return nested + 1
		}
		walk(root, 0)
	}

	// Deepest first: removing a child before its parent is what works.
	sort.Slice(out, func(i, j int) bool {
		di := len(out[i].Path)
		dj := len(out[j].Path)
		if di != dj {
			return di > dj
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// FindArtifacts finds build folders inside project folders.
func FindArtifacts(roots []string, rules []ArtifactRule, guard *Guard, mounts *MountTable, progress *Progress, cancel *Canceller) []Project {
	var projects []Project

	for _, root := range roots {
		if cancel != nil && cancel.Cancelled() {
			break
		}
		projects = append(projects, collectProjects(root, rules, guard, mounts, cancel)...)
		if progress != nil {
			progress.Stage("projects", root)
		}
	}

	sort.Slice(projects, func(i, j int) bool { return projects[i].Bytes > projects[j].Bytes })
	return projects
}

// collectProjects walks a root and returns each folder that holds artifacts.
func collectProjects(root string, rules []ArtifactRule, guard *Guard, mounts *MountTable, cancel *Canceller) []Project {
	var out []Project
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if depth > 8 || (cancel != nil && cancel.Cancelled()) {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		var hits []ArtifactHit
		var lastActivity int64
		for _, e := range entries {
			full := filepath.Join(dir, e.Name())
			if st, err := e.Info(); err == nil {
				if m := st.ModTime().UnixMilli(); m > lastActivity {
					lastActivity = m
				}
			}
			if !e.IsDir() {
				continue
			}
			if mounts != nil && mounts.IsMountRoot(full) {
				continue
			}
			if guard != nil && (guard.IsPrivate(full) || guard.IsExcluded(full)) {
				continue
			}
			rule, ok := matchArtifactRule(rules, e.Name(), dir)
			if !ok {
				continue
			}
			w := Walk(full, WalkOptions{StayOnMount: true, Mounts: mounts, Cancel: cancel})
			hits = append(hits, ArtifactHit{
				Path:    full,
				RuleID:  rule.ID,
				DirName: e.Name(),
				Risk:    rule.Risk,
				Bytes:   w.Bytes,
				Files:   w.Files,
			})
		}
		if len(hits) > 0 {
			p := Project{
				Path:         dir,
				Name:         BaseName(dir),
				LastActivity: lastActivity,
				HasGit:       hasGit(dir),
				Artifacts:    hits,
			}
			for _, h := range hits {
				p.Bytes += h.Bytes
			}
			out = append(out, p)
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if name == ".git" || name == "node_modules" || name == ".venv" || name == "target" || name == "dist" || name == "build" {
				continue
			}
			full := filepath.Join(dir, name)
			if mounts != nil && mounts.IsMountRoot(full) {
				continue
			}
			if guard != nil && (guard.IsPrivate(full) || guard.IsExcluded(full)) {
				continue
			}
			walk(full, depth+1)
		}
	}
	walk(root, 0)
	return out
}

// matchArtifactRule finds the rule for a folder name, given the folder that
// holds it. A rule applies when its dirName matches and one of its markers is
// present in the parent.
func matchArtifactRule(rules []ArtifactRule, dirName, parent string) (ArtifactRule, bool) {
	for _, r := range rules {
		if r.DirName != dirName {
			continue
		}
		if len(r.Markers) == 0 {
			return r, true
		}
		for _, m := range r.Markers {
			if _, err := os.Stat(filepath.Join(parent, m)); err == nil {
				return r, true
			}
		}
	}
	return ArtifactRule{}, false
}

// hasGit reports whether a folder is a git repository.
func hasGit(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}
