//go:build linux || darwin

package engine

import (
	"os"
	"syscall"
)

// allocatedSize is the space a file takes, in bytes. st_blocks * 512 counts
// what the file system actually reserved, so a sparse file does not inflate
// the total.
func allocatedSize(info os.FileInfo) int64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return st.Blocks * 512
	}
	return info.Size()
}
