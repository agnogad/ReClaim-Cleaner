package engine

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Explorer keeps the last scan's tree, so the UI can ask for one node at a
// time instead of receiving the whole tree.
type Explorer struct {
	mu       sync.RWMutex
	root     *DirStat
	byID     map[int64]*DirStat
	idOfNode map[*DirStat]int64
	nextID   int64
	summary  *ScanSummary
	guard    *Guard
	// large and exts are computed once per scan.
	large []FileView
	exts  []ExtStat
}

// NewExplorer builds an empty explorer.
func NewExplorer(guard *Guard) *Explorer {
	return &Explorer{
		guard:    guard,
		byID:     map[int64]*DirStat{},
		idOfNode: map[*DirStat]int64{},
	}
}

// Scan measures a tree and keeps it for the treemap.
func (e *Explorer) Scan(root string, selection []string, mounts *MountTable, progress *Progress, cancel *Canceller) ScanSummary {
	start := nowMillis()

	// When a selection is given, only those folders inside the root are
	// scanned; the root keeps the rest as it was.
	walkRoot := root
	var selectionStat *DirStat
	if len(selection) > 0 {
		selectionStat = &DirStat{Path: root}
		for _, sel := range selection {
			full := sel
			if !filepath.IsAbs(full) {
				full = filepath.Join(root, sel)
			}
			if !isWithin(key(full), key(root)) {
				continue
			}
			walk := Walk(full, WalkOptions{
				StayOnMount: true,
				Mounts:      mounts,
				Progress:    progress,
				Cancel:      cancel,
			})
			if walk.Root != nil {
				selectionStat.Children = append(selectionStat.Children, walk.Root)
			}
		}
		FoldTotals(selectionStat)
	} else {
		walk := Walk(walkRoot, WalkOptions{
			StayOnMount: true,
			Mounts:      mounts,
			Progress:    progress,
			Cancel:      cancel,
		})
		selectionStat = walk.Root
	}

	SortChildren(selectionStat)

	e.mu.Lock()
	e.root = selectionStat
	e.byID = map[int64]*DirStat{}
	e.idOfNode = map[*DirStat]int64{}
	e.nextID = 0
	e.assignIDs(selectionStat)
	e.large = e.collectLarge(selectionStat, 0)
	e.exts = e.collectExts(selectionStat)
	summary := ScanSummary{
		Root:       root,
		Bytes:      selectionStat.Bytes,
		Files:      selectionStat.Files,
		Dirs:       selectionStat.Dirs,
		Denied:     countDenied(selectionStat),
		Millis:     nowMillis() - start,
		ScannedAt:  nowMillis(),
		Cancelled:  cancel != nil && cancel.Cancelled(),
		CloudBytes: selectionStat.Cloud,
		CloudFiles: selectionStat.CloudCnt,
		Selection:  selection,
	}
	if summary.Selection == nil {
		summary.Selection = []string{}
	}
	e.summary = &summary
	e.mu.Unlock()

	return summary
}

// assignIDs numbers the tree depth-first so the UI can ask for a node by id.
// The root is 0: the UI starts at node 0 and treats it as the scan's root.
func (e *Explorer) assignIDs(d *DirStat) {
	id := e.nextID
	e.nextID++
	e.byID[id] = d
	e.idOfNode[d] = id
	for _, c := range d.Children {
		e.assignIDs(c)
	}
}

// Summary returns the last scan's summary.
func (e *Explorer) Summary() *ScanSummary {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.summary
}

// Node returns one node and its children, up to a depth and a count.
func (e *Explorer) Node(id int64, depth, limit int) *NodeView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	d, ok := e.byID[id]
	if !ok {
		return nil
	}
	return e.view(d, id, depth, limit)
}

// view builds the NodeView of one node.
func (e *Explorer) view(d *DirStat, id int64, depth, limit int) *NodeView {
	nv := &NodeView{
		ID:         id,
		Name:       BaseName(d.Path),
		Path:       d.Path,
		Bytes:      d.Bytes,
		Files:      d.Files,
		Mtime:      d.Mtime,
		Denied:     d.Denied,
		Mount:      d.Mount,
		ChildCount: len(d.Children),
		Children:   []NodeView{},
	}
	if d.Mount != nil {
		nv.Kind = NodeDir
		return nv
	}
	if len(d.Children) == 0 && len(d.Entries) == 0 {
		nv.Kind = NodeFile
	} else {
		nv.Kind = NodeDir
	}
	nv.Category = categorize(d.Path, false)

	if depth > 0 {
		shown := 0
		for _, c := range d.Children {
			if limit > 0 && shown >= limit {
				nv.RestBytes += c.Bytes
				nv.RestCount++
				continue
			}
			childID := e.idOf(c)
			if childID == 0 {
				continue
			}
			nv.Children = append(nv.Children, *e.view(c, childID, depth-1, limit))
			shown++
		}
	}
	return nv
}

// idOf finds the id assigned to a node.
func (e *Explorer) idOf(d *DirStat) int64 {
	return e.idOfNode[d]
}

// Ancestors returns the path from the root down to a node.
func (e *Explorer) Ancestors(id int64) []Crumb {
	e.mu.RLock()
	defer e.mu.RUnlock()
	target, ok := e.byID[id]
	if !ok {
		return nil
	}
	var chain []*DirStat
	var find func(d *DirStat) bool
	find = func(d *DirStat) bool {
		chain = append(chain, d)
		if d == target {
			return true
		}
		for _, c := range d.Children {
			if find(c) {
				return true
			}
		}
		chain = chain[:len(chain)-1]
		return false
	}
	if e.root == nil || !find(e.root) {
		return nil
	}
	out := make([]Crumb, 0, len(chain))
	for _, d := range chain {
		out = append(out, Crumb{ID: e.idOf(d), Name: BaseName(d.Path)})
	}
	return out
}

// Find returns the id of the node at a path.
func (e *Explorer) Find(path string) *int64 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	k := key(path)
	for id, d := range e.byID {
		if key(d.Path) == k {
			found := id
			return &found
		}
	}
	return nil
}

// Large returns the biggest files in the last scan.
func (e *Explorer) Large(minBytes int64, limit int) []FileView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]FileView, 0, limit)
	for _, f := range e.large {
		if f.Bytes < minBytes {
			continue
		}
		out = append(out, f)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// Extensions returns the extension breakdown of the last scan.
func (e *Explorer) Extensions(limit int) []ExtStat {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if limit > 0 && len(e.exts) > limit {
		return e.exts[:limit]
	}
	return e.exts
}

// collectLarge walks the tree for files above a floor.
func (e *Explorer) collectLarge(d *DirStat, depth int) []FileView {
	var out []FileView
	var rec func(d *DirStat)
	rec = func(d *DirStat) {
		for _, f := range d.Entries {
			// Duplicates and Large files stay out of private folders.
			if e.guard != nil && e.guard.IsPrivate(f.Path) {
				continue
			}
			out = append(out, FileView{
				ID:       0,
				Name:     f.Name,
				Path:     f.Path,
				Bytes:    f.Bytes,
				Mtime:    f.Mtime,
				Category: categorize(f.Path, true),
			})
		}
		for _, c := range d.Children {
			rec(c)
		}
	}
	rec(d)
	sort.Slice(out, func(i, j int) bool { return out[i].Bytes > out[j].Bytes })
	for i := range out {
		out[i].ID = int64(i + 1)
	}
	return out
}

// collectExts sums the tree by extension.
func (e *Explorer) collectExts(d *DirStat) []ExtStat {
	byExt := map[string]*ExtStat{}
	var rec func(d *DirStat)
	rec = func(d *DirStat) {
		for _, f := range d.Entries {
			ext := strings.ToLower(filepath.Ext(f.Name))
			if ext == "" {
				ext = "(none)"
			}
			s, ok := byExt[ext]
			if !ok {
				s = &ExtStat{Ext: ext}
				byExt[ext] = s
			}
			s.Bytes += f.Bytes
			s.Files++
		}
		for _, c := range d.Children {
			rec(c)
		}
	}
	rec(d)
	out := make([]ExtStat, 0, len(byExt))
	for _, s := range byExt {
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Bytes > out[j].Bytes })
	return out
}

// categorize colours a path by what it holds.
func categorize(path string, isFile bool) Category {
	k := strings.ToLower(key(path))
	base := strings.ToLower(filepath.Base(path))

	// Caches first: they are what the Cleanup view paints.
	for _, marker := range []string{"/.cache/", "/cache/", "/caches/", "/tmp/", "/.npm/", "/.cargo/", "/.gradle/", "/.m2/", "/node_modules/", "/.venv/", "/__pycache__/"} {
		if strings.Contains(k, marker) {
			return CatCaches
		}
	}
	if strings.Contains(k, "/.git/") || strings.Contains(k, "/target/") || strings.Contains(k, "/dist/") || strings.Contains(k, "/build/") {
		return CatProjects
	}
	// AI models.
	for _, marker := range []string{"huggingface", "ollama", "lm-studio", "lmstudio", "comfyui", "/models/"} {
		if strings.Contains(k, marker) {
			return CatAI
		}
	}
	// Media by extension.
	if isFile || filepath.Ext(base) != "" {
		switch strings.ToLower(filepath.Ext(base)) {
		case ".mp4", ".mkv", ".avi", ".mov", ".webm", ".mp3", ".flac", ".wav", ".ogg", ".m4a", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".raw", ".cr2", ".nef":
			return CatMedia
		}
	}
	// Apps.
	for _, marker := range []string{"/.local/share/", "/.var/app/", "/snap/", "/opt/", "/usr/share/", "/applications/"} {
		if strings.Contains(k, marker) {
			return CatApps
		}
	}
	// The user's own projects.
	for _, marker := range []string{"/projects/", "/dev/", "/src/", "/code/", "/workspace/", "/repos/"} {
		if strings.Contains(k, marker) {
			return CatProjects
		}
	}
	return CatOther
}
