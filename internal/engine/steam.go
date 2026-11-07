package engine

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// SteamReportOf finds Steam's libraries and every game's shader cache.
func SteamReportOf(x Xdg, mounts *MountTable, guard *Guard) SteamReport {
	report := SteamReport{Libraries: []SteamLibrary{}, Caches: []ShaderCache{}}
	home := x.Home
	if home == "" {
		return report
	}

	// Steam's own folder, native or Flatpak.
	var roots []string
	for _, rel := range []string{
		".local/share/Steam", ".steam/steam", ".steam/root",
		".var/app/com.valvesoftware.Steam/.local/share/Steam",
	} {
		full := filepath.Join(home, rel)
		if st, err := os.Stat(full); err == nil && st.IsDir() {
			roots = append(roots, full)
		}
	}
	if len(roots) == 0 {
		return report
	}
	root := roots[0]
	report.Root = &root
	report.Running = IsRunning("steam")

	// Every library: the root, plus each path in libraryfolders.vdf.
	libPaths := []string{root}
	vdf := filepath.Join(root, "steamapps", "libraryfolders.vdf")
	if data, err := os.ReadFile(vdf); err == nil {
		libPaths = append(libPaths, parseLibraryFolders(string(data))...)
	}

	seen := map[string]bool{}
	installed := map[string]string{} // appId -> game name

	for _, lib := range libPaths {
		k := key(lib)
		if seen[k] {
			continue
		}
		seen[k] = true
		if st, err := os.Stat(lib); err != nil || !st.IsDir() {
			continue
		}
		library := SteamLibrary{Path: lib, Games: []SteamGame{}}
		if stat, err := StatFSOf(lib); err == nil {
			free := stat.Free
			library.Free = &free
		}

		// Each installed game is a manifest in steamapps.
		appsDir := filepath.Join(lib, "steamapps")
		entries, err := os.ReadDir(appsDir)
		if err == nil {
			for _, e := range entries {
				if !strings.HasPrefix(e.Name(), "appmanifest_") || !strings.HasSuffix(e.Name(), ".acf") {
					continue
				}
				data, err := os.ReadFile(filepath.Join(appsDir, e.Name()))
				if err != nil {
					continue
				}
				appID, name := parseAppManifest(string(data))
				if appID == "" {
					continue
				}
				installed[appID] = name
				gameDir := filepath.Join(appsDir, "common", name)
				var bytes int64
				if st, err := os.Stat(gameDir); err == nil && st.IsDir() {
					w := Walk(gameDir, WalkOptions{StayOnMount: true, Mounts: mounts})
					bytes = w.Bytes
				}
				library.Games = append(library.Games, SteamGame{AppID: appID, Name: name, Bytes: bytes})
				library.Bytes += bytes
			}
		}
		sort.Slice(library.Games, func(i, j int) bool {
			return library.Games[i].Bytes > library.Games[j].Bytes
		})
		report.Libraries = append(report.Libraries, library)

		// Shader caches live in steamapps/shadercache/<appid>.
		cacheDir := filepath.Join(appsDir, "shadercache")
		if cacheEntries, err := os.ReadDir(cacheDir); err == nil {
			for _, c := range cacheEntries {
				if !c.IsDir() {
					continue
				}
				appID := c.Name()
				if _, err := strconv.Atoi(appID); err != nil {
					continue
				}
				full := filepath.Join(cacheDir, appID)
				if guard != nil && guard.IsExcluded(full) {
					continue
				}
				w := Walk(full, WalkOptions{StayOnMount: true, Mounts: mounts})
				if w.Bytes == 0 {
					continue
				}
				name, ok := installed[appID]
				var namePtr *string
				if ok {
					namePtr = &name
				}
				// A cache whose game is gone is safe to remove; one whose
				// game is installed is rebuilt, so it needs review.
				risk := RiskReview
				if !ok {
					risk = RiskSafe
				}
				report.Caches = append(report.Caches, ShaderCache{
					AppID:     appID,
					Name:      namePtr,
					Installed: ok,
					Risk:      risk,
					Library:   lib,
					Path:      full,
					Bytes:     w.Bytes,
					Files:     w.Files,
				})
			}
		}
	}

	sort.Slice(report.Caches, func(i, j int) bool {
		return report.Caches[i].Bytes > report.Caches[j].Bytes
	})
	return report
}

// parseLibraryFolders reads the paths out of libraryfolders.vdf.
var vdfPath = regexp.MustCompile(`"path"\s+"([^"]+)"`)

func parseLibraryFolders(data string) []string {
	var out []string
	for _, m := range vdfPath.FindAllStringSubmatch(data, -1) {
		out = append(out, m[1])
	}
	return out
}

// parseAppManifest reads the app id and the install folder name out of an
// appmanifest .acf file.
var (
	acfAppID   = regexp.MustCompile(`"appid"\s+"(\d+)"`)
	acfName    = regexp.MustCompile(`"name"\s+"([^"]+)"`)
	acfInstall = regexp.MustCompile(`"installdir"\s+"([^"]+)"`)
)

func parseAppManifest(data string) (string, string) {
	appID := ""
	if m := acfAppID.FindStringSubmatch(data); m != nil {
		appID = m[1]
	}
	name := ""
	if m := acfInstall.FindStringSubmatch(data); m != nil {
		name = m[1]
	} else if m := acfName.FindStringSubmatch(data); m != nil {
		name = m[1]
	}
	return appID, name
}

// CleanSteamCaches removes the shader caches of the given app ids.
func CleanSteamCaches(report SteamReport, appIDs []string, method DeleteMethod, guard *Guard, mounts *MountTable) CleanReport {
	out := CleanReport{Failures: []Failure{}, Items: []string{}}
	wanted := map[string]bool{}
	for _, id := range appIDs {
		wanted[id] = true
	}
	cleaner := &Cleaner{Guard: guard, Mounts: mounts}
	for _, c := range report.Caches {
		if !wanted[c.AppID] {
			continue
		}
		out.Items = append(out.Items, "Shader cache "+c.AppID)
		cleaner.removeTree(c.Path, method, &out, true)
	}
	return out
}
