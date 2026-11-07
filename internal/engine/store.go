package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Store is the app's own data folder: settings and the cleanup history.
type Store struct {
	Dir string
}

// NewStore builds a store rooted at a data folder.
func NewStore(dir string) *Store {
	return &Store{Dir: dir}
}

func (s *Store) settingsPath() string { return filepath.Join(s.Dir, "settings.json") }
func (s *Store) historyPath() string  { return filepath.Join(s.Dir, "history.jsonl") }

// LoadSettings reads the settings, or the defaults when there is no file.
func (s *Store) LoadSettings() (Settings, error) {
	data, err := os.ReadFile(s.settingsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultSettings(), nil
		}
		return DefaultSettings(), err
	}
	// Start from the defaults so a settings file written by an older
	// version keeps working when new fields appear.
	settings := DefaultSettings()
	if err := json.Unmarshal(data, &settings); err != nil {
		return DefaultSettings(), err
	}
	if settings.Exclusions == nil {
		settings.Exclusions = []string{}
	}
	if settings.ProjectRoots == nil {
		settings.ProjectRoots = []string{}
	}
	return settings, nil
}

// SaveSettings writes the settings, creating the data folder if needed.
func (s *Store) SaveSettings(settings Settings) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	if settings.Exclusions == nil {
		settings.Exclusions = []string{}
	}
	if settings.ProjectRoots == nil {
		settings.ProjectRoots = []string{}
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	// Write to a temporary file and rename, so a crash cannot leave a
	// half-written settings file.
	tmp := s.settingsPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.settingsPath())
}

// AppendHistory adds one line to the cleanup log.
func (s *Store) AppendHistory(entry HistoryEntry) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	if entry.Time == "" {
		entry.Time = time.Now().UTC().Format(time.RFC3339)
	}
	if entry.Items == nil {
		entry.Items = []string{}
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(s.historyPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

// History reads the newest entries, newest first.
func (s *Store) History(limit int) ([]HistoryEntry, error) {
	data, err := os.ReadFile(s.historyPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []HistoryEntry{}, nil
		}
		return nil, err
	}
	var all []HistoryEntry
	for _, line := range splitLines(data) {
		if len(line) == 0 {
			continue
		}
		var e HistoryEntry
		if err := json.Unmarshal(line, &e); err != nil {
			continue
		}
		if e.Items == nil {
			e.Items = []string{}
		}
		all = append(all, e)
	}
	// Newest first.
	for i, j := 0, len(all)-1; i < j; i, j = i+1, j-1 {
		all[i], all[j] = all[j], all[i]
	}
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	if all == nil {
		all = []HistoryEntry{}
	}
	return all, nil
}

// ClearHistory empties the cleanup log.
func (s *Store) ClearHistory() error {
	err := os.Remove(s.historyPath())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// splitLines splits a byte slice on newlines.
func splitLines(data []byte) [][]byte {
	var out [][]byte
	start := 0
	for i, b := range data {
		if b == '\n' {
			out = append(out, data[start:i])
			start = i + 1
		}
	}
	if start < len(data) {
		out = append(out, data[start:])
	}
	return out
}
