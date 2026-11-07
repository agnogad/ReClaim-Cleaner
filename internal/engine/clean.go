package engine

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// timeNow is the clock, injectable for tests.
var timeNow = time.Now

// Cleaner removes files, checking every path against the guard first.
type Cleaner struct {
	Guard    *Guard
	Mounts   *MountTable
	Progress *Progress
	Cancel   *Canceller
	// OpenFiles is the set of paths some process holds open, read once per
	// cleanup. A file in it stays and is reported as in use.
	OpenFiles map[string]bool
}

// RemoveRulePath removes what one rule names at one path.
func (c *Cleaner) RemoveRulePath(r TargetRule, p string, method DeleteMethod, report *CleanReport) {
	info, err := os.Lstat(p)
	if err != nil {
		return
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return
	}

	switch r.Mode {
	case ModeFolder:
		if !info.IsDir() {
			return
		}
		c.removeTree(p, method, report, true)
	case ModeContents:
		if !info.IsDir() {
			return
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: "unreadable"})
			report.Failed++
			return
		}
		for _, e := range entries {
			if c.Cancel != nil && c.Cancel.Cancelled() {
				report.Cancelled = true
				return
			}
			if excludedName(r.Exclude, e.Name()) {
				continue
			}
			full := filepath.Join(p, e.Name())
			if r.MinAgeHours != nil {
				if st, err := e.Info(); err == nil && tooYoung(st.ModTime().UnixMilli(), *r.MinAgeHours) {
					continue
				}
			}
			c.removeTree(full, method, report, false)
		}
	case ModeFiles:
		if !info.IsDir() {
			return
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() || !matchesAny(r.Include, e.Name()) || excludedName(r.Exclude, e.Name()) {
				continue
			}
			if c.Cancel != nil && c.Cancel.Cancelled() {
				report.Cancelled = true
				return
			}
			full := filepath.Join(p, e.Name())
			if r.MinAgeHours != nil {
				if st, err := e.Info(); err == nil && tooYoung(st.ModTime().UnixMilli(), *r.MinAgeHours) {
					continue
				}
			}
			c.removeTree(full, method, report, false)
		}
	case ModeReport:
		// Measuring only; nothing is removed.
	}
}

// RemovePath removes one path the user picked.
func (c *Cleaner) RemovePath(p string, method DeleteMethod, report *CleanReport) {
	info, err := os.Lstat(p)
	if err != nil {
		report.Failures = append(report.Failures, Failure{Path: p, Reason: "not found"})
		report.Failed++
		return
	}
	if info.Mode()&os.ModeSymlink != 0 {
		// A link is removed as a link, never followed.
		if err := c.Guard.Check(p, OriginUser); err != nil {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
			report.Failed++
			return
		}
		c.unlinkOne(p, report)
		return
	}
	c.removeTree(p, method, report, info.IsDir())
}

// removeTree removes a path and everything below it, checking each entry
// against the guard.
func (c *Cleaner) removeTree(p string, method DeleteMethod, report *CleanReport, whole bool) {
	if c.Cancel != nil && c.Cancel.Cancelled() {
		report.Cancelled = true
		return
	}

	info, err := os.Lstat(p)
	if err != nil {
		return
	}
	// A link is removed as a link. It is never followed, so a link inside a
	// cache cannot redirect a delete.
	if info.Mode()&os.ModeSymlink != 0 {
		if err := c.Guard.Check(p, OriginUser); err != nil {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
			report.Failed++
			return
		}
		c.unlinkOne(p, report)
		return
	}

	if !info.IsDir() {
		if err := c.Guard.Check(p, OriginUser); err != nil {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
			report.Failed++
			return
		}
		c.unlinkOne(p, report)
		return
	}

	// A folder: check it as a whole when the rule removes it, and as a wipe
	// when its contents go.
	if whole {
		if err := c.Guard.Check(p, OriginUser); err != nil {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
			report.Failed++
			return
		}
	} else {
		if err := c.Guard.CheckWipe(p); err != nil {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
			report.Failed++
			return
		}
	}

	// A mount boundary is never crossed: the delete stays on one device.
	if c.Mounts != nil && !whole {
		if c.Mounts.IsMountRoot(p) {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: "mount point"})
			report.Failed++
			return
		}
	}

	entries, err := os.ReadDir(p)
	if err != nil {
		report.Failures = append(report.Failures, Failure{Path: p, Reason: "unreadable"})
		report.Failed++
		return
	}

	var kept int64
	for _, e := range entries {
		if c.Cancel != nil && c.Cancel.Cancelled() {
			report.Cancelled = true
			return
		}
		name := e.Name()
		// .git, lost+found and trash folders are never removed, at any
		// depth.
		if isProtectedName(name) {
			kept++
			continue
		}
		full := filepath.Join(p, name)
		if c.Guard.IsExcluded(full) {
			kept++
			continue
		}
		if c.Mounts != nil {
			if m, ok := c.Mounts.MountOf(full); ok && c.Mounts.IsMountRoot(full) {
				_ = m
				kept++
				continue
			}
		}
		c.removeTree(full, method, report, false)
	}

	// The folder itself goes only when nothing was kept: removing it would
	// take the kept entries with it.
	if kept > 0 {
		return
	}
	if whole {
		c.rmdirOne(p, report)
	}
}

// unlinkOne removes one file or link.
func (c *Cleaner) unlinkOne(p string, report *CleanReport) {
	info, err := os.Lstat(p)
	if err != nil {
		return
	}
	size := int64(0)
	if info.Mode().IsRegular() {
		size = allocatedSize(info)
	}

	// A file some process holds open stays, and is reported as in use.
	if c.OpenFiles != nil && c.OpenFiles[key(p)] {
		report.Failures = append(report.Failures, Failure{Path: p, Reason: "in use"})
		report.Failed++
		return
	}

	if err := os.Remove(p); err != nil {
		if errors.Is(err, syscall.EBUSY) || errors.Is(err, syscall.ETXTBSY) {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: "in use"})
		} else {
			report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
		}
		report.Failed++
		return
	}
	report.Freed += size
	report.Files++
	if c.Progress != nil {
		c.Progress.Add(1, 0, size, 0)
	}
}

// rmdirOne removes one empty folder.
func (c *Cleaner) rmdirOne(p string, report *CleanReport) {
	if err := os.Remove(p); err != nil {
		report.Failures = append(report.Failures, Failure{Path: p, Reason: reasonOf(err)})
		report.Failed++
		return
	}
	report.Dirs++
}

// reasonOf turns an error into the short reason the UI shows.
func reasonOf(err error) string {
	e := AsError(err)
	switch e.Code {
	case CodeProtected:
		return "protected"
	case CodeExcluded:
		return "excluded"
	case CodeOutsideHome:
		return "outside home"
	case CodeNotFound:
		return "not found"
	case CodePermission:
		return "permission"
	case CodeInUse:
		return "in use"
	}
	msg := e.Msg
	if len(msg) > 120 {
		msg = msg[:120]
	}
	return msg
}

// OpenFileSet reads which paths some process holds open, from /proc/*/fd. A
// file in it is not deleted. When this cannot be read, nothing is deleted.
func OpenFileSet() (map[string]bool, error) {
	procs, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, p := range procs {
		if !p.IsDir() {
			continue
		}
		name := p.Name()
		if name[0] < '0' || name[0] > '9' {
			continue
		}
		fdDir := filepath.Join("/proc", name, "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, fd := range fds {
			target, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			if strings.HasPrefix(target, "/") {
				out[key(target)] = true
			}
		}
	}
	return out, nil
}

// IsRunning reports whether an executable with this name is running.
func IsRunning(name string) bool {
	procs, err := os.ReadDir("/proc")
	if err != nil {
		return false
	}
	for _, p := range procs {
		if !p.IsDir() || p.Name()[0] < '0' || p.Name()[0] > '9' {
			continue
		}
		comm, err := os.ReadFile(filepath.Join("/proc", p.Name(), "comm"))
		if err != nil {
			continue
		}
		if strings.TrimSpace(string(comm)) == name {
			return true
		}
	}
	return false
}

// RunningSet lists the executables a rule cares about that are running now.
func RunningSet(names []string) map[string]bool {
	out := map[string]bool{}
	for _, n := range names {
		if IsRunning(n) {
			out[n] = true
		}
	}
	return out
}
