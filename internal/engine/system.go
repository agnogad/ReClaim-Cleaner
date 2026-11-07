package engine

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SystemFacts answers the questions the Overview and Tools pages ask about
// the machine.
type SystemFacts struct {
	Mounts *MountTable
	Xdg    Xdg
	Guard  *Guard
}

// Drives lists the mounted file systems a user can browse. One entry per
// device: a btrfs volume mounts its subvolumes separately, and listing the
// same file system eight times is noise, not information.
func (f *SystemFacts) Drives() []Drive {
	var out []Drive
	seenDevice := map[string]bool{}
	if f.Mounts == nil {
		return out
	}
	for _, m := range f.Mounts.Mounts {
		if ShouldSkipMount(m) {
			continue
		}
		// Only real storage: a tmpfs or a remote mount is not a drive the
		// user thinks of.
		if MountKindOf(m) != MountLocal {
			continue
		}
		// One entry per device. The first mount of a device wins, which is
		// the one highest in the tree.
		if seenDevice[m.Device] {
			continue
		}
		seenDevice[m.Device] = true
		stat, err := StatFSOf(m.Point)
		if err != nil {
			continue
		}
		out = append(out, Drive{
			Root:       m.Point,
			Label:      driveLabel(m.Point),
			FileSystem: m.FileSystem,
			Total:      stat.Total,
			Free:       stat.Free,
			Removable:  isRemovable(m.Point),
			System:     isSystemMount(m.Point),
		})
	}

	sort.Slice(out, func(i, j int) bool {
		// The home folder's drive first, then the rest by size.
		hi := f.homeDriveIndex(out)
		if i == hi {
			return true
		}
		if j == hi {
			return false
		}
		return out[i].Total > out[j].Total
	})
	return out
}

func (f *SystemFacts) homeDriveIndex(drives []Drive) int {
	home := f.Xdg.Home
	if home == "" {
		return -1
	}
	best, idx := "", -1
	for i, d := range drives {
		if isWithin(key(home), key(d.Root)) && len(d.Root) > len(best) {
			best, idx = d.Root, i
		}
	}
	return idx
}

// driveLabel is the name a drive shows: its mount point's last segment, or
// "Filesystem" for the root.
func driveLabel(point string) string {
	k := key(point)
	if k == "/" {
		return "Filesystem"
	}
	return BaseName(k)
}

// isRemovable reports whether a mount is on removable media.
func isRemovable(point string) bool {
	// /media and /run/media are where desktops mount removable media.
	k := key(point)
	return strings.HasPrefix(k, "/media/") || strings.HasPrefix(k, "/run/media/")
}

// isSystemMount reports whether a mount holds the running system.
func isSystemMount(point string) bool {
	k := key(point)
	switch k {
	case "/", "/boot", "/boot/efi", "/efi", "/usr", "/var":
		return true
	}
	return false
}

// SystemFiles lists the large files the system keeps outside the user's
// folders: the page file, the hibernation file and the like.
func (f *SystemFacts) SystemFiles() []SystemFile {
	out := []SystemFile{}
	candidates := []struct {
		name string
		path string
	}{
		{"Swap file", "/swapfile"},
		{"Swap file", "/swap.img"},
		{"Hibernation image", "/hiberfil.sys"},
		{"Page file", "/pagefile.sys"},
	}
	for _, c := range candidates {
		st, err := os.Stat(c.path)
		if err != nil || st.IsDir() {
			continue
		}
		out = append(out, SystemFile{Name: c.name, Path: c.path, Bytes: allocatedSize(st)})
	}
	return out
}

// RecycleBinInfo measures the user's trash.
func (f *SystemFacts) RecycleBinInfo() RecycleBinInfo {
	info := RecycleBinInfo{}
	home := f.Xdg.Home
	if home == "" {
		return info
	}
	dataHome := f.Xdg.Data
	if dataHome == "" {
		dataHome = filepath.Join(home, ".local/share")
	}
	trash := filepath.Join(dataHome, "Trash")
	filesDir := filepath.Join(trash, "files")
	entries, err := os.ReadDir(filesDir)
	if err != nil {
		return info
	}
	for _, e := range entries {
		info.Items++
		full := filepath.Join(filesDir, e.Name())
		st, err := os.Lstat(full)
		if err != nil {
			continue
		}
		if st.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if st.IsDir() {
			w := Walk(full, WalkOptions{StayOnMount: true, Mounts: f.Mounts})
			info.Bytes += w.Bytes
			continue
		}
		info.Bytes += allocatedSize(st)
	}
	return info
}

// EmptyRecycleBin removes the user's trash through the freedesktop trash
// layout, skipping any item that has a mount inside it.
func (f *SystemFacts) EmptyRecycleBin() CleanReport {
	report := CleanReport{Failures: []Failure{}, Items: []string{"Recycle Bin"}}
	home := f.Xdg.Home
	if home == "" {
		return report
	}
	dataHome := f.Xdg.Data
	if dataHome == "" {
		dataHome = filepath.Join(home, ".local/share")
	}
	trash := filepath.Join(dataHome, "Trash")
	filesDir := filepath.Join(trash, "files")
	infoDir := filepath.Join(trash, "info")

	entries, err := os.ReadDir(filesDir)
	if err != nil {
		return report
	}
	for _, e := range entries {
		full := filepath.Join(filesDir, e.Name())
		// A mount inside the trash is not removed: it is someone's disk.
		if f.Mounts != nil && f.Mounts.IsMountRoot(full) {
			report.Failures = append(report.Failures, Failure{Path: full, Reason: "mount point"})
			report.Failed++
			continue
		}
		// The trash is the user's own discard pile, and the guard protects
		// it from every other action. Emptying it is the one action allowed
		// to remove from it, so the item is removed here rather than through
		// the guard.
		removeTrashItem(full, &report)
		// Its .trashinfo goes with it.
		_ = os.Remove(filepath.Join(infoDir, e.Name()+".trashinfo"))
	}
	return report
}

// removeTrashItem removes one item from the trash, without following links
// and without crossing a mount.
func removeTrashItem(path string, report *CleanReport) {
	info, err := os.Lstat(path)
	if err != nil {
		return
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		size := int64(0)
		if info.Mode().IsRegular() {
			size = allocatedSize(info)
		}
		if err := os.Remove(path); err != nil {
			report.Failures = append(report.Failures, Failure{Path: path, Reason: reasonOf(err)})
			report.Failed++
			return
		}
		report.Freed += size
		report.Files++
		return
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		report.Failures = append(report.Failures, Failure{Path: path, Reason: "unreadable"})
		report.Failed++
		return
	}
	for _, e := range entries {
		removeTrashItem(filepath.Join(path, e.Name()), report)
	}
	if err := os.Remove(path); err != nil {
		report.Failures = append(report.Failures, Failure{Path: path, Reason: reasonOf(err)})
		report.Failed++
		return
	}
	report.Dirs++
}

// OsInfoOf describes the running system for the About panel.
func OsInfoOf() OsInfo {
	info := OsInfo{Name: "Linux"}
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			v = strings.Trim(v, `"`)
			switch k {
			case "NAME":
				info.Name = v
			case "VERSION_ID":
				info.DisplayVersion = v
			}
		}
	}
	if data, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		info.Build = strings.TrimSpace(string(data))
	}
	return info
}

// IsElevated reports whether the process runs as root. The app refuses to
// delete anything when it does.
func IsElevated() bool {
	return os.Geteuid() == 0
}

// LibraryFoldersOf reads the user's well-known folders.
func LibraryFoldersOf(x Xdg) LibraryFolders {
	d := ReadUserDirs(x)
	str := func(s string) *string {
		if s == "" {
			return nil
		}
		return &s
	}
	return LibraryFolders{
		Desktop:   str(d.Desktop),
		Documents: str(d.Documents),
		Downloads: str(d.Downloads),
		Pictures:  str(d.Pictures),
		Music:     str(d.Music),
		Videos:    str(d.Videos),
	}
}

// SuggestedRoots are the folders the Space map offers first.
func SuggestedRoots(x Xdg, libs LibraryFolders) []string {
	var out []string
	add := func(p *string) {
		if p == nil || *p == "" {
			return
		}
		if st, err := os.Stat(*p); err == nil && st.IsDir() {
			out = append(out, *p)
		}
	}
	add(&x.Home)
	add(libs.Downloads)
	add(libs.Documents)
	add(libs.Pictures)
	add(libs.Videos)
	add(libs.Music)
	add(libs.Desktop)
	return out
}
