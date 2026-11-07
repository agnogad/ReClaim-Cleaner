package engine

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// JunkScanner measures the cleanup targets.
type JunkScanner struct {
	Catalog *Catalog
	Guard   *Guard
	Xdg     Xdg
	Mounts  *MountTable
	// Running lists the executables that are open right now.
	Running  map[string]bool
	Progress *Progress
	Cancel   *Canceller
}

// Scan measures every rule, in parallel.
func (s *JunkScanner) Scan() []TargetResult {
	rules := s.Catalog.Targets
	results := make([]TargetResult, len(rules))
	var wg sync.WaitGroup

	sem := make(chan struct{}, 8)
	for i, r := range rules {
		wg.Add(1)
		go func(i int, r TargetRule) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if s.Cancel != nil && s.Cancel.Cancelled() {
				return
			}
			results[i] = s.scanRule(r)
			if s.Progress != nil {
				s.Progress.Done(1)
			}
		}(i, r)
	}
	wg.Wait()

	if s.Progress != nil {
		s.Progress.SetTotal(int64(len(rules)))
	}
	return results
}

// scanRule measures one rule's paths.
func (s *JunkScanner) scanRule(r TargetRule) TargetResult {
	res := TargetResult{
		ID:               r.ID,
		Found:            []FoundPath{},
		Running:          []string{},
		CommandAvailable: r.Command != nil,
	}

	// An app that is running blocks its cache: deleting it under the app
	// would corrupt it.
	for _, app := range r.CloseApps {
		if s.Running[app] {
			res.Running = append(res.Running, app)
		}
	}
	if len(res.Running) > 0 {
		res.Partial = true
		return res
	}

	for _, pattern := range r.Paths {
		paths, err := ExpandPattern(pattern, s.Xdg)
		if err != nil {
			continue
		}
		for _, p := range paths {
			if s.Cancel != nil && s.Cancel.Cancelled() {
				res.Partial = true
				return res
			}
			bytes, files, ok := s.measurePath(r, p)
			if !ok {
				continue
			}
			if bytes == 0 && files == 0 {
				continue
			}
			res.Found = append(res.Found, FoundPath{Path: p, Bytes: bytes, Files: files})
			res.Bytes += bytes
			res.Files += files
		}
	}
	return res
}

// measurePath measures what a rule would remove at one path.
func (s *JunkScanner) measurePath(r TargetRule, p string) (int64, int64, bool) {
	info, err := os.Lstat(p)
	if err != nil {
		return 0, 0, false
	}
	// A link is never followed: it is removed as a link or skipped.
	if info.Mode()&os.ModeSymlink != 0 {
		return 0, 0, false
	}

	switch r.Mode {
	case ModeFolder:
		if !info.IsDir() {
			return 0, 0, false
		}
		// A folder rule removes the folder itself, so the guard checks it
		// as a whole.
		if err := s.Guard.Check(p, OriginRule); err != nil {
			return 0, 0, false
		}
		walk := Walk(p, WalkOptions{
			StayOnMount: true,
			Mounts:      s.Mounts,
			Cancel:      s.Cancel,
		})
		return walk.Bytes, walk.Files, true

	case ModeContents:
		if !info.IsDir() {
			return 0, 0, false
		}
		// The folder stays; its contents go.
		if err := s.Guard.CheckWipe(p); err != nil {
			return 0, 0, false
		}
		return s.measureContents(r, p)

	case ModeFiles:
		if !info.IsDir() {
			return 0, 0, false
		}
		return s.measureFiles(r, p)

	case ModeReport:
		walk := Walk(p, WalkOptions{StayOnMount: true, Mounts: s.Mounts, Cancel: s.Cancel})
		return walk.Bytes, walk.Files, true
	}
	return 0, 0, false
}

// measureContents sums the entries directly inside a folder, skipping the
// ones a rule excludes and the ones younger than its minimum age.
func (s *JunkScanner) measureContents(r TargetRule, dir string) (int64, int64, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0, false
	}
	var bytes, files int64
	for _, e := range entries {
		full := filepath.Join(dir, e.Name())
		if excludedName(r.Exclude, e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if r.MinAgeHours != nil && tooYoung(info.ModTime().UnixMilli(), *r.MinAgeHours) {
			continue
		}
		if info.IsDir() {
			walk := Walk(full, WalkOptions{StayOnMount: true, Mounts: s.Mounts, Cancel: s.Cancel})
			bytes += walk.Bytes
			files += walk.Files
			continue
		}
		bytes += allocatedSize(info)
		files++
	}
	return bytes, files, true
}

// measureFiles sums the files directly inside a folder that match a rule's
// include globs.
func (s *JunkScanner) measureFiles(r TargetRule, dir string) (int64, int64, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0, false
	}
	var bytes, files int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !matchesAny(r.Include, e.Name()) {
			continue
		}
		if excludedName(r.Exclude, e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if r.MinAgeHours != nil && tooYoung(info.ModTime().UnixMilli(), *r.MinAgeHours) {
			continue
		}
		bytes += allocatedSize(info)
		files++
	}
	return bytes, files, true
}

// excludedName reports whether a name matches one of a rule's exclude globs.
func excludedName(globs []string, name string) bool {
	return matchesAny(globs, name)
}

func matchesAny(globs []string, name string) bool {
	for _, g := range globs {
		if wildcardMatch(g, name) {
			return true
		}
	}
	return false
}

// tooYoung reports whether a file is newer than a rule's minimum age.
func tooYoung(mtime int64, minAgeHours int) bool {
	if minAgeHours <= 0 {
		return false
	}
	now := nowMillis()
	return now-mtime < int64(minAgeHours)*3600*1000
}

// CleanTargets removes the reviewed paths of the given rules.
func (s *JunkScanner) CleanTargets(ids []string, method DeleteMethod) CleanReport {
	report := CleanReport{Failures: []Failure{}, Items: []string{}}
	cleaner := &Cleaner{Guard: s.Guard, Mounts: s.Mounts, Progress: s.Progress, Cancel: s.Cancel}

	for _, id := range ids {
		r, ok := s.Catalog.RuleByID(id)
		if !ok {
			continue
		}
		// An app that is running blocks its cache.
		blocked := false
		for _, app := range r.CloseApps {
			if s.Running[app] {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}
		report.Items = append(report.Items, r.Name)

		for _, pattern := range r.Paths {
			paths, err := ExpandPattern(pattern, s.Xdg)
			if err != nil {
				continue
			}
			for _, p := range paths {
				if s.Cancel != nil && s.Cancel.Cancelled() {
					report.Cancelled = true
					return report
				}
				cleaner.RemoveRulePath(r, p, method, &report)
			}
		}
	}
	return report
}

// CleanPaths removes explicit paths, as the Large files, Duplicates and Space
// map pages ask.
func (s *JunkScanner) CleanPaths(kind string, paths []string, method DeleteMethod) CleanReport {
	report := CleanReport{Failures: []Failure{}, Items: []string{}}
	cleaner := &Cleaner{Guard: s.Guard, Mounts: s.Mounts, Progress: s.Progress, Cancel: s.Cancel}
	for _, p := range paths {
		if s.Cancel != nil && s.Cancel.Cancelled() {
			report.Cancelled = true
			return report
		}
		cleaner.RemovePath(p, method, &report)
	}
	report.Items = append(report.Items, kind)
	return report
}

// nowMillis is the current time in milliseconds, injectable for tests.
var nowMillis = func() int64 {
	return timeNow().UnixMilli()
}

// ruleGroupOrder is the order the Cleaner page lists groups in.
var ruleGroupOrder = []Group{
	GroupSystem, GroupBrowser, GroupApps, GroupDev, GroupGames, GroupAI, GroupMedia,
}

// GroupLabel is the human name of a group.
func GroupLabel(g Group) string {
	switch g {
	case GroupSystem:
		return "System"
	case GroupBrowser:
		return "Browsers"
	case GroupApps:
		return "Apps"
	case GroupDev:
		return "Developer"
	case GroupGames:
		return "Games"
	case GroupAI:
		return "AI"
	case GroupMedia:
		return "Media"
	}
	return strings.Title(string(g))
}
