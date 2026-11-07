package engine

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

// FindLocks reports which processes hold a file or folder open, read from
// /proc/*/fd. The only action offered is a graceful close, never a forced one.
func FindLocks(path string, mounts *MountTable) LockReport {
	report := LockReport{Path: path, Lockers: []Locker{}}
	st, err := os.Stat(path)
	if err != nil {
		return report
	}
	report.IsDir = st.IsDir()

	// The paths to look for: the file itself, or every file inside a folder.
	targets := map[string]bool{}
	if report.IsDir {
		w := Walk(path, WalkOptions{StayOnMount: true, Mounts: mounts})
		if w.Root != nil {
			var rec func(d *DirStat)
			rec = func(d *DirStat) {
				for _, f := range d.Entries {
					targets[key(f.Path)] = true
				}
				for _, c := range d.Children {
					rec(c)
				}
			}
			rec(w.Root)
		}
		report.Folders = 1
	} else {
		targets[key(path)] = true
	}

	const maxTargets = 20000
	if len(targets) > maxTargets {
		report.Truncated = true
	}

	procs, err := os.ReadDir("/proc")
	if err != nil {
		return report
	}

	type found struct {
		pid     int
		name    string
		exe     string
		started int64
	}
	byPID := map[int]*found{}

	for _, p := range procs {
		if !p.IsDir() {
			continue
		}
		pidStr := p.Name()
		if pidStr[0] < '0' || pidStr[0] > '9' {
			continue
		}
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}
		fdDir := filepath.Join("/proc", pidStr, "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			report.Unchecked++
			continue
		}
		report.Checked++
		for _, fd := range fds {
			target, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			if !targets[key(target)] {
				continue
			}
			if _, ok := byPID[pid]; !ok {
				name := ""
				if data, err := os.ReadFile(filepath.Join("/proc", pidStr, "comm")); err == nil {
					name = strings.TrimSpace(string(data))
				}
				exe := ""
				if link, err := os.Readlink(filepath.Join("/proc", pidStr, "exe")); err == nil {
					exe = link
				}
				byPID[pid] = &found{pid: pid, name: name, exe: exe, started: procStart(pidStr)}
			}
			break
		}
	}

	for _, f := range byPID {
		kind := classifyLocker(f.name, f.exe)
		exe := f.exe
		report.Lockers = append(report.Lockers, Locker{
			PID:       f.pid,
			Started:   f.started,
			Name:      f.name,
			Exe:       &exe,
			Kind:      kind,
			UsesFiles: true,
			RunsFrom:  false,
			// A graceful close is offered for a user's own app, never for a
			// system process.
			CanClose: kind == LockerApp || kind == LockerBackground,
		})
	}
	sort.Slice(report.Lockers, func(i, j int) bool {
		return report.Lockers[i].Name < report.Lockers[j].Name
	})
	return report
}

// procStart reads a process's start time, in milliseconds since the epoch.
func procStart(pid string) int64 {
	data, err := os.ReadFile(filepath.Join("/proc", pid, "stat"))
	if err != nil {
		return 0
	}
	// The start time is field 22, after the process name in parentheses.
	s := string(data)
	close := strings.LastIndex(s, ")")
	if close < 0 {
		return 0
	}
	fields := strings.Fields(s[close+1:])
	if len(fields) < 20 {
		return 0
	}
	ticks, err := strconv.ParseInt(fields[19], 10, 64)
	if err != nil {
		return 0
	}
	// The clock tick is 100 Hz on Linux, and the boot time comes from
	// /proc/stat.
	boot := bootTimeMillis()
	return boot + ticks*10
}

// bootTimeMillis reads the boot time from /proc/stat.
func bootTimeMillis() int64 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "btime ") {
			secs, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "btime ")), 10, 64)
			if err == nil {
				return secs * 1000
			}
		}
	}
	return 0
}

// classifyLocker sorts a process into the kinds the UI shows.
func classifyLocker(name, exe string) LockerKind {
	switch {
	case name == "systemd" || name == "init" || strings.HasPrefix(name, "kworker"):
		return LockerSystem
	case name == "bash" || name == "zsh" || name == "fish" || name == "sh" || name == "konsole" || name == "alacritty" || name == "kitty":
		return LockerConsole
	case strings.Contains(exe, "/usr/lib/") || strings.Contains(exe, "/usr/sbin/"):
		return LockerService
	case strings.Contains(exe, "nautilus") || strings.Contains(exe, "dolphin") || strings.Contains(exe, "thunar") || strings.Contains(exe, "nemo"):
		return LockerExplorer
	}
	return LockerApp
}

// CloseLocker asks a process to close, gracefully: SIGTERM, never SIGKILL.
func CloseLocker(path string, pid int, started int64, mounts *MountTable) CloseResult {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return CloseResult{Outcome: CloseGone, Report: FindLocks(path, mounts)}
	}
	// A process that is already gone is not an error.
	if err := proc.Signal(syscall.Signal(0)); err != nil {
		return CloseResult{Outcome: CloseGone, Report: FindLocks(path, mounts)}
	}
	// The start time guards against a recycled pid: a different process now
	// holds the number, and it is not the one the user saw.
	if started != 0 {
		now := procStart(strconv.Itoa(pid))
		if now != 0 && now != started {
			return CloseResult{Outcome: CloseGone, Report: FindLocks(path, mounts)}
		}
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return CloseResult{Outcome: CloseDenied, Report: FindLocks(path, mounts)}
	}
	return CloseResult{Outcome: CloseClosed, Report: FindLocks(path, mounts)}
}
