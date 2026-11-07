package engine

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// Mount is one entry of /proc/self/mountinfo.
type Mount struct {
	Point      string
	FileSystem string
	// Device is the major:minor pair, which ties a mount to a device.
	Device string
}

// MountTable is the mount table read when a scan starts.
type MountTable struct {
	Mounts []Mount
	byPath map[string]Mount
}

// ReadMountTable reads /proc/self/mountinfo.
func ReadMountTable() (*MountTable, error) {
	f, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		return nil, err
	}
	defer f.Close()

	t := &MountTable{byPath: map[string]Mount{}}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		// Fields: id parent major:minor root mountpoint options...
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		device := fields[2]
		point := unescapeMount(fields[4])
		// The file system type follows the " - " separator.
		fsType := ""
		for i, f := range fields {
			if f == "-" && i+1 < len(fields) {
				fsType = fields[i+1]
				break
			}
		}
		m := Mount{Point: point, FileSystem: fsType, Device: device}
		t.Mounts = append(t.Mounts, m)
		t.byPath[point] = m
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return t, nil
}

// unescapeMount decodes the octal escapes mountinfo uses for spaces and tabs.
func unescapeMount(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) {
			if v, err := strconv.ParseUint(s[i+1:i+4], 8, 8); err == nil {
				b.WriteByte(byte(v))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// MountOf returns the mount a path is on.
func (t *MountTable) MountOf(path string) (Mount, bool) {
	if t == nil {
		return Mount{}, false
	}
	k := key(path)
	best := ""
	var found Mount
	for point, m := range t.byPath {
		pk := key(point)
		if isWithin(k, pk) && len(pk) >= len(best) {
			best = pk
			found = m
		}
	}
	return found, best != ""
}

// IsMountRoot reports whether a path is the root of a mount.
func (t *MountTable) IsMountRoot(path string) bool {
	if t == nil {
		return false
	}
	k := key(path)
	for point := range t.byPath {
		if key(point) == k {
			return true
		}
	}
	return false
}

// Points lists every mount point, for the guard.
func (t *MountTable) Points() []string {
	if t == nil {
		return nil
	}
	out := make([]string, 0, len(t.Mounts))
	for _, m := range t.Mounts {
		out = append(out, m.Point)
	}
	return out
}

// skippedFileSystems are never entered by a scan.
var skippedFileSystems = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true,
	"cgroup": true, "cgroup2": true, "securityfs": true, "debugfs": true,
	"tracefs": true, "configfs": true, "fusectl": true, "pstore": true,
	"bpf": true, "autofs": true, "mqueue": true, "hugetlbfs": true,
	"binfmt_misc": true, "rpc_pipefs": true, "nsfs": true, "squashfs": true,
	"overlay": true, "efivarfs": true,
}

// skippedPrefixes are mount points a scan stays out of whatever their type.
var skippedPrefixes = []string{"/proc", "/sys", "/dev", "/run"}

// ShouldSkipMount reports whether a scan must not enter a mount.
func ShouldSkipMount(m Mount) bool {
	if skippedFileSystems[m.FileSystem] {
		return true
	}
	k := key(m.Point)
	for _, p := range skippedPrefixes {
		if isWithin(k, p) {
			return true
		}
	}
	return false
}

// MountKindOf classifies a mount the scan does not enter but shows as a stub.
func MountKindOf(m Mount) MountKind {
	switch {
	case strings.HasPrefix(m.FileSystem, "fuse."), m.FileSystem == "nfs",
		m.FileSystem == "nfs4", m.FileSystem == "cifs", m.FileSystem == "smb3",
		m.FileSystem == "sshfs", m.FileSystem == "9p":
		return MountRemote
	case m.FileSystem == "tmpfs", m.FileSystem == "ramfs":
		return MountMemory
	default:
		return MountLocal
	}
}

// StatFS is the free and total space of a path.
type StatFS struct {
	Total int64
	Free  int64
}
