package engine

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
)

// Progress is a job's progress, reported to the UI as it runs.
type Progress struct {
	mu   sync.Mutex
	snap ProgressSnapshot
	kind string
	emit func(ProgressEvent)
}

// NewProgress builds a progress reporter. emit may be nil.
func NewProgress(kind string, emit func(ProgressEvent)) *Progress {
	return &Progress{kind: kind, emit: emit}
}

// Add records work done.
func (p *Progress) Add(files, dirs, bytes, errors int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.snap.Files += files
	p.snap.Dirs += dirs
	p.snap.Bytes += bytes
	p.snap.Errors += errors
	p.mu.Unlock()
}

// Stage sets the stage label and the path being worked on.
func (p *Progress) Stage(stage, current string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.snap.Stage = stage
	p.snap.Current = current
	p.mu.Unlock()
}

// SetTotal sets how many items the job has to do.
func (p *Progress) SetTotal(total int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.snap.Total = total
	p.mu.Unlock()
}

// Done marks one item of the total finished.
func (p *Progress) Done(n int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.snap.Done += n
	p.mu.Unlock()
}

// Snapshot returns the current progress.
func (p *Progress) Snapshot() ProgressSnapshot {
	if p == nil {
		return ProgressSnapshot{}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.snap
}

// Flush sends the current snapshot to the UI.
func (p *Progress) Flush() {
	if p == nil || p.emit == nil {
		return
	}
	p.mu.Lock()
	ev := ProgressEvent{ProgressSnapshot: p.snap, Kind: p.kind}
	p.mu.Unlock()
	p.emit(ev)
}

// Canceller is a job that can be stopped.
type Canceller struct {
	flag atomic.Bool
}

// Cancel stops the job.
func (c *Canceller) Cancel() {
	if c != nil {
		c.flag.Store(true)
	}
}

// Cancelled reports whether the job was stopped.
func (c *Canceller) Cancelled() bool {
	return c != nil && c.flag.Load()
}

// DirStat is what a walk found in one folder.
type DirStat struct {
	Path     string
	Bytes    int64
	Files    int64
	Dirs     int64
	Mtime    int64
	Denied   bool
	Cloud    int64
	CloudCnt int64
	Children []*DirStat
	// Entries are the files directly inside, for the large-file and
	// extension lists.
	Entries []FileEntry
	// Mount marks a mount the walk did not enter.
	Mount *MountKind
}

// FileEntry is one file a walk saw.
type FileEntry struct {
	Path  string
	Name  string
	Bytes int64
	Mtime int64
}

// WalkOptions steer a size walk.
type WalkOptions struct {
	// StayOnMount stops at every mount boundary below the root.
	StayOnMount bool
	// SkipPrivate leaves out private user data.
	SkipPrivate bool
	// Guard is used for SkipPrivate.
	Guard *Guard
	// Mounts is the table read when the walk starts.
	Mounts *MountTable
	// Progress reports as the walk runs.
	Progress *Progress
	// Cancel stops the walk.
	Cancel *Canceller
	// MaxDepth bounds the recursion; 0 is unlimited.
	MaxDepth int
}

// WalkResult is a finished walk.
type WalkResult struct {
	Root      *DirStat
	Bytes     int64
	Files     int64
	Dirs      int64
	Denied    int64
	Cloud     int64
	CloudCnt  int64
	Cancelled bool
}

// walker holds the shared state of one walk.
type walker struct {
	opts      WalkOptions
	rootMount Mount
	hasRoot   bool
	// sem bounds how many folders are walked at once.
	sem chan struct{}
	wg  sync.WaitGroup
	mu  sync.Mutex
}

// Walk measures a folder tree in parallel. The root's own mount is the only
// one entered when StayOnMount is set; a mount below it becomes a stub.
func Walk(root string, opts WalkOptions) *WalkResult {
	res := &WalkResult{}
	rootStat := &DirStat{Path: root}
	res.Root = rootStat

	w := &walker{opts: opts}
	if opts.Mounts != nil {
		w.rootMount, w.hasRoot = opts.Mounts.MountOf(root)
	}
	n := runtime.NumCPU() * 2
	if n < 4 {
		n = 4
	}
	w.sem = make(chan struct{}, n)

	w.wg.Add(1)
	w.visit(root, rootStat, 0)
	w.wg.Wait()

	// Each folder summed only its own files while it walked; the totals have
	// to be folded up the tree before the root's numbers mean anything.
	FoldTotals(rootStat)

	res.Bytes = rootStat.Bytes
	res.Files = rootStat.Files
	res.Dirs = rootStat.Dirs
	res.Cloud = rootStat.Cloud
	res.CloudCnt = rootStat.CloudCnt
	res.Denied = countDenied(rootStat)
	if opts.Cancel != nil {
		res.Cancelled = opts.Cancel.Cancelled()
	}
	return res
}

func countDenied(d *DirStat) int64 {
	var n int64
	if d.Denied {
		n++
	}
	for _, c := range d.Children {
		n += countDenied(c)
	}
	return n
}

// visit walks one folder. It runs on its own goroutine when the semaphore has
// room, and inline otherwise, so a wide tree cannot spawn unbounded work.
func (w *walker) visit(path string, stat *DirStat, depth int) {
	defer w.wg.Done()

	if w.opts.Cancel != nil && w.opts.Cancel.Cancelled() {
		return
	}
	if w.opts.MaxDepth > 0 && depth > w.opts.MaxDepth {
		return
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		w.mu.Lock()
		stat.Denied = true
		w.mu.Unlock()
		if w.opts.Progress != nil {
			w.opts.Progress.Add(0, 0, 0, 1)
		}
		return
	}
	if w.opts.Progress != nil {
		w.opts.Progress.Stage("scan", path)
	}

	var (
		localBytes int64
		localFiles int64
		children   []*DirStat
		files      []FileEntry
	)

	for _, e := range entries {
		if w.opts.Cancel != nil && w.opts.Cancel.Cancelled() {
			break
		}
		full := filepath.Join(path, e.Name())
		info, err := e.Info()
		if err != nil {
			w.mu.Lock()
			stat.Denied = true
			w.mu.Unlock()
			continue
		}
		// A link is never followed: it is counted as a link, not as what it
		// points at.
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if info.IsDir() {
			if w.opts.Mounts != nil {
				if m, ok := w.opts.Mounts.MountOf(full); ok {
					if w.opts.StayOnMount && w.hasRoot && m.Device != w.rootMount.Device {
						kind := MountKindOf(m)
						children = append(children, &DirStat{
							Path:  full,
							Mount: &kind,
							Mtime: info.ModTime().UnixMilli(),
						})
						continue
					}
					if ShouldSkipMount(m) {
						continue
					}
				}
			}
			if w.opts.SkipPrivate && w.opts.Guard != nil && w.opts.Guard.IsPrivate(full) {
				continue
			}
			child := &DirStat{Path: full, Mtime: info.ModTime().UnixMilli()}
			children = append(children, child)
			w.spawn(full, child, depth+1)
			continue
		}
		size := allocatedSize(info)
		localBytes += size
		localFiles++
		files = append(files, FileEntry{
			Path:  full,
			Name:  e.Name(),
			Bytes: size,
			Mtime: info.ModTime().UnixMilli(),
		})
		if info.ModTime().UnixMilli() > stat.Mtime {
			stat.Mtime = info.ModTime().UnixMilli()
		}
	}

	w.mu.Lock()
	stat.Bytes += localBytes
	stat.Files += localFiles
	stat.Children = children
	stat.Entries = files
	w.mu.Unlock()

	if w.opts.Progress != nil {
		w.opts.Progress.Add(localFiles, int64(len(children)), localBytes, 0)
	}
}

// spawn walks a child folder on a new goroutine when there is room, and waits
// for a slot otherwise.
func (w *walker) spawn(path string, stat *DirStat, depth int) {
	select {
	case w.sem <- struct{}{}:
		w.wg.Add(1)
		go func() {
			defer func() { <-w.sem }()
			w.visit(path, stat, depth)
		}()
	default:
		// No room: walk it here. The recursion stays bounded by the
		// semaphore, so this cannot grow without limit.
		w.wg.Add(1)
		w.visit(path, stat, depth)
	}
}

// FoldTotals sums a walked tree bottom-up, so every folder has its totals.
// Walk does this as it goes; call it after mutating a tree.
func FoldTotals(d *DirStat) {
	d.Bytes = 0
	d.Files = 0
	d.Dirs = 0
	for _, e := range d.Entries {
		d.Bytes += e.Bytes
		d.Files++
	}
	for _, c := range d.Children {
		FoldTotals(c)
		d.Bytes += c.Bytes
		d.Files += c.Files
		d.Dirs += c.Dirs + 1
		if c.Denied {
			d.Denied = true
		}
		if c.Mtime > d.Mtime {
			d.Mtime = c.Mtime
		}
	}
}

// SortChildren orders a folder's children by size, largest first, which is
// the order a treemap draws them in.
func SortChildren(d *DirStat) {
	sort.Slice(d.Children, func(i, j int) bool {
		if d.Children[i].Bytes != d.Children[j].Bytes {
			return d.Children[i].Bytes > d.Children[j].Bytes
		}
		return d.Children[i].Path < d.Children[j].Path
	})
	for _, c := range d.Children {
		SortChildren(c)
	}
}

// BaseName is the display name of a path.
func BaseName(p string) string {
	b := filepath.Base(p)
	if b == "." || b == "/" {
		return p
	}
	return b
}

// CleanPath normalizes a user-supplied path.
func CleanPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", NewError(CodeInvalid, "empty path")
	}
	if strings.HasPrefix(p, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			p = filepath.Join(home, strings.TrimPrefix(p, "~"))
		}
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", AsError(err)
	}
	return abs, nil
}
