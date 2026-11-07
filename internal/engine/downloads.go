package engine

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// DownloadsReportOf lists the Downloads folder by type and age.
func DownloadsReportOf(libs LibraryFolders, mounts *MountTable, guard *Guard, cancel *Canceller) DownloadsReport {
	report := DownloadsReport{Files: []DownloadFile{}}
	if libs.Downloads == nil || *libs.Downloads == "" {
		return report
	}
	root := *libs.Downloads
	report.Root = root

	// A browser's re-download of the same file: "file (1).pdf".
	copyPattern := regexp.MustCompile(`\s\(\d+\)$`)

	const maxFiles = 2000
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if depth > 4 || (cancel != nil && cancel.Cancelled()) {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			full := filepath.Join(dir, e.Name())
			if e.IsDir() {
				if mounts != nil && mounts.IsMountRoot(full) {
					continue
				}
				if guard != nil && (guard.IsPrivate(full) || guard.IsExcluded(full)) {
					continue
				}
				walk(full, depth+1)
				continue
			}
			if len(report.Files) >= maxFiles {
				report.Truncated = true
				return
			}
			info, err := e.Info()
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			rel, _ := filepath.Rel(root, dir)
			folder := ""
			if rel != "." {
				folder = rel
			}
			name := e.Name()
			stem := strings.TrimSuffix(name, filepath.Ext(name))
			report.Files = append(report.Files, DownloadFile{
				Path:   full,
				Name:   name,
				Folder: folder,
				Ext:    strings.ToLower(filepath.Ext(name)),
				Bytes:  allocatedSize(info),
				Mtime:  info.ModTime().UnixMilli(),
				Copy:   copyPattern.MatchString(stem),
			})
			report.Bytes += allocatedSize(info)
		}
	}
	walk(root, 0)

	sort.Slice(report.Files, func(i, j int) bool {
		return report.Files[i].Bytes > report.Files[j].Bytes
	})
	return report
}

// FindInstallers finds old installers and archives in Downloads and on the
// Desktop.
func FindInstallers(libs LibraryFolders, minAgeDays int, mounts *MountTable, guard *Guard) []InstallerFile {
	installerExts := map[string]bool{
		".exe": true, ".msi": true, ".msix": true, ".appx": true, ".dmg": true,
		".pkg": true, ".deb": true, ".rpm": true, ".appimage": true, ".snap": true,
		".flatpak": true, ".iso": true, ".img": true, ".zip": true, ".7z": true,
		".rar": true, ".tar": true, ".gz": true, ".xz": true, ".bz2": true,
	}

	roots := []string{}
	if libs.Downloads != nil && *libs.Downloads != "" {
		roots = append(roots, *libs.Downloads)
	}
	if libs.Desktop != nil && *libs.Desktop != "" {
		roots = append(roots, *libs.Desktop)
	}

	var out []InstallerFile
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			ext := strings.ToLower(filepath.Ext(name))
			if !installerExts[ext] {
				continue
			}
			full := filepath.Join(root, name)
			info, err := e.Info()
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			if minAgeDays > 0 {
				age := (nowMillis() - info.ModTime().UnixMilli()) / (24 * 3600 * 1000)
				if age < int64(minAgeDays) {
					continue
				}
			}
			out = append(out, InstallerFile{
				Path:  full,
				Name:  name,
				Bytes: allocatedSize(info),
				Mtime: info.ModTime().UnixMilli(),
				Ext:   ext,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Bytes > out[j].Bytes })
	return out
}

// HiddenSpaceOf explains the space a drive uses beyond what its folders add
// up to. On Linux the parts are the swap file, the trash, virtual disks and
// the folders a scan could not read.
func HiddenSpaceOf(root string, mounts *MountTable, x Xdg, guard *Guard) HiddenSpace {
	space := HiddenSpace{Root: root, Parts: []HiddenPart{}, DeniedPaths: []string{}}
	stat, err := StatFSOf(root)
	if err != nil {
		return space
	}
	space.Total = stat.Total
	space.Free = stat.Free
	space.Used = stat.Total - stat.Free

	// The swap file, when it is a file.
	for _, p := range []string{"/swapfile", "/swap.img"} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			size := allocatedSize(st)
			path := p
			label := "Swap file"
			space.Parts = append(space.Parts, HiddenPart{
				Kind: HiddenSwapFile, Bytes: &size, InScan: false,
				Path: &path, Label: &label, NeedsAdmin: true,
			})
		}
	}

	// The trash.
	trash := RecycleBinInfo{}
	if x.Home != "" {
		dataHome := x.Data
		if dataHome == "" {
			dataHome = filepath.Join(x.Home, ".local/share")
		}
		filesDir := filepath.Join(dataHome, "Trash", "files")
		if entries, err := os.ReadDir(filesDir); err == nil {
			var bytes int64
			for _, e := range entries {
				full := filepath.Join(filesDir, e.Name())
				if st, err := os.Lstat(full); err == nil {
					if st.IsDir() {
						w := Walk(full, WalkOptions{StayOnMount: true, Mounts: mounts})
						bytes += w.Bytes
					} else {
						bytes += allocatedSize(st)
					}
				}
			}
			trash.Bytes = bytes
			trash.Items = int64(len(entries))
		}
	}
	if trash.Items > 0 {
		items := trash.Items
		bytes := trash.Bytes
		label := "Recycle Bin"
		space.Parts = append(space.Parts, HiddenPart{
			Kind: HiddenRecycleBin, Bytes: &bytes, InScan: true,
			Label: &label, Count: &items,
		})
	}

	// Virtual disks: WSL, Docker and VM images below the home folder.
	if x.Home != "" {
		for _, rel := range []string{
			".local/share/docker", ".docker/desktop", ".wsl",
			"VirtualBox VMs", ".local/share/libvirt/images",
		} {
			full := filepath.Join(x.Home, rel)
			if st, err := os.Stat(full); err == nil && st.IsDir() {
				w := Walk(full, WalkOptions{StayOnMount: true, Mounts: mounts})
				if w.Bytes > 0 {
					bytes := w.Bytes
					path := full
					label := BaseName(full)
					space.Parts = append(space.Parts, HiddenPart{
						Kind: HiddenVirtualDisk, Bytes: &bytes, InScan: true,
						Path: &path, Label: &label,
					})
				}
			}
		}
	}

	return space
}

// AiModels lists the models local AI tools keep.
func AiModels(x Xdg, mounts *MountTable, guard *Guard) []AiModel {
	type source struct {
		id   string
		name string
		path string
		kind string
	}
	var sources []source
	home := x.Home
	if home == "" {
		return []AiModel{}
	}
	sources = append(sources,
		source{"huggingface", "Hugging Face", filepath.Join(home, ".cache/huggingface/hub"), "model"},
		source{"lmstudio", "LM Studio", filepath.Join(home, ".cache/lm-studio/models"), "model"},
		source{"lmstudio", "LM Studio", filepath.Join(home, ".lmstudio/models"), "model"},
		source{"ollama", "Ollama", filepath.Join(home, ".ollama/models"), "model"},
		source{"comfyui", "ComfyUI", filepath.Join(home, "ComfyUI/models"), "model"},
	)

	var out []AiModel
	for _, s := range sources {
		entries, err := os.ReadDir(s.path)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			full := filepath.Join(s.path, e.Name())
			if guard != nil && guard.IsExcluded(full) {
				continue
			}
			w := Walk(full, WalkOptions{StayOnMount: true, Mounts: mounts})
			if w.Bytes == 0 {
				continue
			}
			formats := modelFormats(w.Root)
			out = append(out, AiModel{
				ID:      s.id + ":" + e.Name(),
				Name:    e.Name(),
				Source:  s.id,
				Kind:    s.kind,
				Formats: formats,
				Bytes:   w.Bytes,
				Files:   w.Files,
				Mtime:   w.Root.Mtime,
				Path:    full,
				Remove:  []string{full},
				SameAs:  []string{},
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Bytes > out[j].Bytes })
	return out
}

// modelFormats lists the distinct model file extensions inside a folder.
func modelFormats(d *DirStat) []string {
	if d == nil {
		return []string{}
	}
	seen := map[string]bool{}
	var rec func(d *DirStat)
	rec = func(d *DirStat) {
		for _, f := range d.Entries {
			ext := strings.ToLower(filepath.Ext(f.Name))
			switch ext {
			case ".gguf", ".safetensors", ".bin", ".pt", ".pth", ".onnx", ".ckpt", ".h5", ".msgpack":
				seen[ext] = true
			}
		}
		for _, c := range d.Children {
			rec(c)
		}
	}
	rec(d)
	out := make([]string, 0, len(seen))
	for e := range seen {
		out = append(out, strings.TrimPrefix(e, "."))
	}
	sort.Strings(out)
	return out
}

// AssistantData lists what AI coding assistants keep on disk.
func AssistantDataOf(x Xdg, mounts *MountTable, guard *Guard) []AssistantData {
	home := x.Home
	if home == "" {
		return []AssistantData{}
	}
	type tool struct {
		id   string
		name string
		path string
		risk Risk
	}
	tools := []tool{
		{"claude-code", "Claude Code", filepath.Join(home, ".claude"), RiskReview},
		{"codex", "Codex", filepath.Join(home, ".codex"), RiskReview},
		{"gemini-cli", "Gemini CLI", filepath.Join(home, ".gemini"), RiskReview},
		{"cursor", "Cursor", filepath.Join(home, ".cursor"), RiskReview},
		{"aider", "Aider", filepath.Join(home, ".aider"), RiskReview},
	}

	var out []AssistantData
	for _, t := range tools {
		entries, err := os.ReadDir(t.path)
		if err != nil {
			continue
		}
		d := AssistantData{
			ID: t.id, Tool: t.name, Path: t.path, Risk: t.risk, Items: []DataItem{},
		}
		for _, e := range entries {
			full := filepath.Join(t.path, e.Name())
			if guard != nil && guard.IsExcluded(full) {
				continue
			}
			info, err := e.Info()
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			var bytes, files int64
			if info.IsDir() {
				w := Walk(full, WalkOptions{StayOnMount: true, Mounts: mounts})
				bytes, files = w.Bytes, w.Files
			} else {
				bytes, files = allocatedSize(info), 1
			}
			if bytes == 0 {
				continue
			}
			d.Items = append(d.Items, DataItem{
				Name: e.Name(), Path: full, Bytes: bytes, Files: files,
				Mtime: info.ModTime().UnixMilli(),
			})
			d.Bytes += bytes
			d.Files += files
			if m := info.ModTime().UnixMilli(); m > d.Mtime {
				d.Mtime = m
			}
		}
		if d.Bytes > 0 {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Bytes > out[j].Bytes })
	return out
}
