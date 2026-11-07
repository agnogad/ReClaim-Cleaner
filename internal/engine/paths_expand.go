package engine

import (
	"os"
	"path/filepath"
	"strings"
)

// Xdg holds the XDG base directories, with the spec's defaults filled in.
// Relative values are ignored, as the spec says.
type Xdg struct {
	Home   string
	Cache  string
	Config string
	Data   string
	State  string
}

// ReadXdg reads the XDG directories from the environment.
func ReadXdg() Xdg {
	home := os.Getenv("HOME")
	x := Xdg{Home: home}
	x.Cache = xdgDir(os.Getenv("XDG_CACHE_HOME"), home, ".cache")
	x.Config = xdgDir(os.Getenv("XDG_CONFIG_HOME"), home, ".config")
	x.Data = xdgDir(os.Getenv("XDG_DATA_HOME"), home, ".local/share")
	x.State = xdgDir(os.Getenv("XDG_STATE_HOME"), home, ".local/state")
	return x
}

func xdgDir(value, home, fallback string) string {
	if value != "" && filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, fallback)
}

// UserDirs are the folders user-dirs.dirs names.
type UserDirs struct {
	Desktop   string
	Documents string
	Downloads string
	Pictures  string
	Music     string
	Videos    string
}

// ReadUserDirs reads ~/.config/user-dirs.dirs, falling back to the usual
// names when it is missing.
func ReadUserDirs(x Xdg) UserDirs {
	d := UserDirs{}
	home := x.Home
	if home == "" {
		return d
	}
	fallback := func(name string) string {
		p := filepath.Join(home, name)
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
		return ""
	}
	d.Desktop = fallback("Desktop")
	d.Documents = fallback("Documents")
	d.Downloads = fallback("Downloads")
	d.Pictures = fallback("Pictures")
	d.Music = fallback("Music")
	d.Videos = fallback("Videos")

	path := filepath.Join(x.Config, "user-dirs.dirs")
	data, err := os.ReadFile(path)
	if err != nil {
		return d
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "XDG_") {
			continue
		}
		name, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.Trim(value, `"`)
		value = strings.ReplaceAll(value, "$HOME", home)
		if !filepath.IsAbs(value) {
			continue
		}
		switch name {
		case "XDG_DESKTOP_DIR":
			d.Desktop = value
		case "XDG_DOCUMENTS_DIR":
			d.Documents = value
		case "XDG_DOWNLOAD_DIR":
			d.Downloads = value
		case "XDG_PICTURES_DIR":
			d.Pictures = value
		case "XDG_MUSIC_DIR":
			d.Music = value
		case "XDG_VIDEOS_DIR":
			d.Videos = value
		}
	}
	return d
}

// allowedVars are the variables a rule path may start with.
var allowedVars = map[string]bool{
	"HOME": true, "XDG_CACHE": true, "XDG_CONFIG": true, "XDG_DATA": true,
	"XDG_STATE": true, "STEAM": true, "STEAMLIBRARY": true,
}

// ExpandVars replaces %VAR% with its value. A path must start with an allowed
// variable.
func ExpandVars(pattern string, x Xdg) (string, error) {
	if !strings.HasPrefix(pattern, "%") {
		return "", NewError(CodeInvalid, "path must start with a variable: %s", pattern)
	}
	end := strings.Index(pattern[1:], "%")
	if end < 0 {
		return "", NewError(CodeInvalid, "unterminated variable: %s", pattern)
	}
	name := pattern[1 : end+1]
	if !allowedVars[name] {
		return "", NewError(CodeInvalid, "unknown variable %%%s%% in %s", name, pattern)
	}
	var value string
	switch name {
	case "HOME":
		value = x.Home
	case "XDG_CACHE":
		value = x.Cache
	case "XDG_CONFIG":
		value = x.Config
	case "XDG_DATA":
		value = x.Data
	case "XDG_STATE":
		value = x.State
	default:
		// Steam paths are resolved by the Steam scanner, which knows where
		// the libraries are. A rule that needs them expands to nothing when
		// Steam is not installed.
		return "", NewError(CodeInvalid, "%%%s%% is resolved by the Steam scanner", name)
	}
	if value == "" {
		return "", NewError(CodeInvalid, "%%%s%% is not set", name)
	}
	rest := pattern[end+2:]
	return filepath.Join(value, filepath.FromSlash(strings.TrimPrefix(rest, "/"))), nil
}

// HasWildcard reports whether a path has a * or ? segment.
func HasWildcard(s string) bool {
	return strings.ContainsAny(s, "*?")
}

// WildcardMatch matches a name against a pattern where * and ? match inside
// one segment. Case matters on Linux.
func WildcardMatch(pattern, name string) bool {
	return wildcardMatch(pattern, name)
}

func wildcardMatch(pattern, name string) bool {
	// Iterative glob with backtracking, so a pathological pattern cannot
	// recurse deeply.
	var (
		p, n         int
		starP, starN = -1, 0
	)
	for n < len(name) {
		if p < len(pattern) {
			switch pattern[p] {
			case '*':
				starP, starN = p, n
				p++
				continue
			case '?':
				p++
				n++
				continue
			default:
				if pattern[p] == name[n] {
					p++
					n++
					continue
				}
			}
		}
		if starP >= 0 {
			p = starP + 1
			starN++
			n = starN
			continue
		}
		return false
	}
	for p < len(pattern) && pattern[p] == '*' {
		p++
	}
	return p == len(pattern)
}

// ExpandPattern expands a rule path into the paths that exist. A segment with
// a wildcard is matched against the folder's entries; the first segment after
// the variable must be a fixed name.
func ExpandPattern(pattern string, x Xdg) ([]string, error) {
	expanded, err := ExpandVars(pattern, x)
	if err != nil {
		return nil, err
	}
	if !HasWildcard(expanded) {
		return []string{expanded}, nil
	}
	// Split into the fixed prefix and the wildcard tail.
	segs := strings.Split(filepath.ToSlash(expanded), "/")
	firstWild := -1
	for i, s := range segs {
		if HasWildcard(s) {
			firstWild = i
			break
		}
	}
	if firstWild < 0 {
		return []string{expanded}, nil
	}
	base := strings.Join(segs[:firstWild], "/")
	if base == "" {
		base = "/"
	}
	// The first segment after the variable must be a fixed name: refuse a
	// pattern that starts with a wildcard right below a root.
	if firstWild <= 1 && base == "" {
		return nil, NewError(CodeInvalid, "wildcard too early in %s", pattern)
	}
	matches := []string{base}
	for _, seg := range segs[firstWild:] {
		var next []string
		for _, dir := range matches {
			if !HasWildcard(seg) {
				next = append(next, filepath.Join(dir, seg))
				continue
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			for _, e := range entries {
				if wildcardMatch(seg, e.Name()) {
					next = append(next, filepath.Join(dir, e.Name()))
				}
			}
		}
		matches = next
	}
	return matches, nil
}
