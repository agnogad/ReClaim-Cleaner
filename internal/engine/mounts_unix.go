//go:build linux || darwin

package engine

import "syscall"

// StatFSOf reads the space of the file system a path is on.
func StatFSOf(path string) (StatFS, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return StatFS{}, err
	}
	bs := int64(st.Bsize)
	return StatFS{
		Total: int64(st.Blocks) * bs,
		Free:  int64(st.Bavail) * bs,
	}, nil
}

// DeviceOf returns the device ID of a path, for hard link detection.
func DeviceOf(path string) (uint64, uint64, error) {
	var st syscall.Stat_t
	if err := syscall.Stat(path, &st); err != nil {
		return 0, 0, err
	}
	return uint64(st.Dev), st.Ino, nil
}
