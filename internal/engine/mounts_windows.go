//go:build windows

package engine

import "errors"

// errNotOnWindows is what every call that has no Windows counterpart returns.
//
// Windows support of the engine is not finished: the mount table, the free
// space query and the hard link identity all come from Unix calls. The port
// keeps Windows compiling and the rest of the app working, and these refuse
// instead of guessing.
var errNotOnWindows = errors.New("not available on Windows yet: " + "this build reads the Unix mount table")

// StatFSOf has no Windows implementation.
func StatFSOf(path string) (StatFS, error) {
	return StatFS{}, errNotOnWindows
}

// DeviceOf has no Windows implementation.
func DeviceOf(path string) (uint64, uint64, error) {
	return 0, 0, errNotOnWindows
}
