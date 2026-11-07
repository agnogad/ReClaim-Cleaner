//go:build windows

package engine

import "os"

// allocatedSize is the space a file takes. Windows exposes no block count
// through os.FileInfo, so the logical size stands in; a compressed or sparse
// file is over-reported, never under.
func allocatedSize(info os.FileInfo) int64 {
	return info.Size()
}
