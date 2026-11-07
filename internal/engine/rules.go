package engine

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
)

// rulesFS holds the shipped rule catalogs. The Linux build embeds the Linux
// targets; artifacts are shared by every platform.
//
//go:embed all:rules
var rulesFS embed.FS

// Catalog is the rule set the app runs with.
type Catalog struct {
	Targets   []TargetRule
	Artifacts []ArtifactRule
	// Problems are rules that failed to parse or that point at a protected
	// path. They are reported, never silently dropped.
	Problems []string
}

// LoadCatalog reads the embedded rules, then any user rules, and checks every
// path against the guard.
func LoadCatalog(guard *Guard, userRulesDir string) *Catalog {
	c := &Catalog{}

	var targets []TargetRule
	if err := readRulesFile(rulesFS, "rules/linux/targets.json", &targets); err != nil {
		c.Problems = append(c.Problems, fmt.Sprintf("linux targets: %v", err))
	}
	var artifacts []ArtifactRule
	if err := readRulesFile(rulesFS, "rules/artifacts.json", &artifacts); err != nil {
		c.Problems = append(c.Problems, fmt.Sprintf("artifacts: %v", err))
	}

	// User rules: a file dropped into the data folder's rules directory.
	if userRulesDir != "" {
		entries, err := os.ReadDir(userRulesDir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
					continue
				}
				var extra []TargetRule
				if err := readRulesFile(os.DirFS(userRulesDir), e.Name(), &extra); err != nil {
					c.Problems = append(c.Problems, fmt.Sprintf("%s: %v", e.Name(), err))
					continue
				}
				for i := range extra {
					// A user rule may not ask for admin rights or run a
					// command: it is data the app did not ship.
					extra[i].Admin = false
					extra[i].Command = nil
					extra[i].User = true
				}
				targets = append(targets, extra...)
			}
		}
	}

	// Check every rule path against the guard, and report the ones that
	// point somewhere protected.
	seen := map[string]bool{}
	for _, r := range targets {
		if seen[r.ID] {
			c.Problems = append(c.Problems, fmt.Sprintf("duplicate rule id %q", r.ID))
			continue
		}
		seen[r.ID] = true
		if problem := checkRulePaths(r, guard); problem != "" {
			c.Problems = append(c.Problems, fmt.Sprintf("%s: %s", r.ID, problem))
			continue
		}
		c.Targets = append(c.Targets, r)
	}
	c.Artifacts = artifacts
	sort.Slice(c.Targets, func(i, j int) bool {
		if c.Targets[i].Group != c.Targets[j].Group {
			return c.Targets[i].Group < c.Targets[j].Group
		}
		return c.Targets[i].ID < c.Targets[j].ID
	})
	return c
}

func readRulesFile(fsys fs.FS, name string, out any) error {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// checkRulePaths reports the first path of a rule that the guard refuses.
// A rule that names a protected folder is a bug in the rule, and CI catches
// it; at run time the rule is dropped rather than trusted.
func checkRulePaths(r TargetRule, guard *Guard) string {
	if guard == nil {
		return ""
	}
	x := ReadXdg()
	for _, p := range r.Paths {
		expanded, err := ExpandPattern(p, x)
		if err != nil {
			// Steam paths expand later, when Steam is known to be
			// installed; that is not a problem with the rule.
			if strings.Contains(err.Error(), "Steam scanner") {
				continue
			}
			return err.Error()
		}
		for _, e := range expanded {
			origin := OriginRule
			if err := guard.Check(e, origin); err != nil {
				// A location that does not exist yet is fine: it is
				// created by the app the rule describes.
				if _, statErr := os.Stat(e); statErr != nil {
					continue
				}
				return fmt.Sprintf("%s is protected", p)
			}
		}
	}
	return ""
}

// Payload is what the Cleaner page loads.
func (c *Catalog) Payload() RulesPayload {
	// The UI expects every array to be present, never null.
	targets := make([]TargetRule, len(c.Targets))
	for i, t := range c.Targets {
		if t.Include == nil {
			t.Include = []string{}
		}
		if t.Exclude == nil {
			t.Exclude = []string{}
		}
		if t.CloseApps == nil {
			t.CloseApps = []string{}
		}
		targets[i] = t
	}
	artifacts := make([]ArtifactRule, len(c.Artifacts))
	for i, a := range c.Artifacts {
		if a.Markers == nil {
			a.Markers = []string{}
		}
		if a.Contains == nil {
			a.Contains = []string{}
		}
		artifacts[i] = a
	}
	return RulesPayload{Targets: targets, Artifacts: artifacts}
}

// RuleByID finds a target rule.
func (c *Catalog) RuleByID(id string) (TargetRule, bool) {
	for _, r := range c.Targets {
		if r.ID == id {
			return r, true
		}
	}
	return TargetRule{}, false
}
