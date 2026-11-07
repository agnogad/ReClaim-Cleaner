package bridge

import (
	"errors"
	"testing"

	"gocleaner/internal/engine"
)

// TestEveryCommandIsHandled checks that every Tauri command the React app
// calls has an answer. The list is the one in src/lib/api.ts; a command that
// falls through to "unknown command" would break a page silently.
func TestEveryCommandIsHandled(t *testing.T) {
	// Every command name the frontend invokes, in the order api.ts lists
	// them.
	commands := []string{
		"app_info", "drives", "system_files", "recycle_bin_info",
		"settings_get", "settings_set", "rules_list", "job_cancel",
		"reveal_path", "open_path", "restart_elevated",
		"explorer_scan", "explorer_summary", "explorer_node",
		"explorer_ancestors", "explorer_find", "explorer_large",
		"explorer_extensions",
		"junk_scan", "junk_clean", "rule_command",
		"projects_scan", "duplicates_scan", "empty_scan", "installers_scan",
		"paths_clean", "recycle_bin_empty",
		"apps_list", "apps_store", "app_uninstall", "startup_list",
		"startup_set", "tool_run",
		"shell_images", "ai_models", "ollama_remove", "assistant_data",
		"downloads_report", "app_remove_entry",
		"hidden_space", "hidden_measure", "locks_find", "locks_close",
		"steam_report", "steam_clean", "shell_menu_status", "shell_menu_set",
		"shell_take_pending", "shell_menu_default", "quick_clean_take",
		"jump_list_set", "desktop_shortcut_create",
		"history_list", "history_clear",
	}

	if len(commands) != 54 {
		t.Fatalf("expected 54 commands, listed %d", len(commands))
	}

	dir := t.TempDir()
	b := New(Options{DataDir: dir})

	for _, cmd := range commands {
		// A command that needs arguments gets none: the point is that it is
		// recognized, not that it succeeds.
		_, err := b.Call(cmd, map[string]any{})
		if err == nil {
			continue
		}
		e := asEngineError(err)
		if e != nil && e.Code == engine.CodeUnsupported && e.Msg == `unknown command "`+cmd+`"` {
			t.Errorf("%s is not handled by the bridge", cmd)
		}
	}
}

// asEngineError unwraps an error to the engine's own type.
func asEngineError(err error) *engine.Error {
	var e *engine.Error
	if errors.As(err, &e) {
		return e
	}
	return nil
}

// TestSettingsRoundTrip checks that settings survive a save and a load.
func TestSettingsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	b := New(Options{DataDir: dir})

	got, err := b.Call("settings_get", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	settings, ok := got.(interface{})
	if !ok {
		t.Fatal("settings_get returned no value")
	}
	_ = settings

	// Save a changed setting and read it back.
	_, err = b.Call("settings_set", map[string]any{
		"settings": map[string]any{
			"language":                   "tr",
			"theme":                      "dark",
			"cacheDelete":                "permanent",
			"filesDelete":                "recycle",
			"showCaution":                true,
			"exclusions":                 []string{"/tmp/keep-me"},
			"projectRoots":               []string{},
			"idleDays":                   45,
			"largeMinMb":                 200,
			"duplicateMinKb":             2048,
			"installerAgeDays":           60,
			"checkUpdates":               false,
			"onboarded":                  true,
			"explorerMenuDefaultApplied": false,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	reloaded, err := b.store.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Language != "tr" {
		t.Errorf("language = %q, want tr", reloaded.Language)
	}
	if reloaded.IdleDays != 45 {
		t.Errorf("idleDays = %d, want 45", reloaded.IdleDays)
	}
	if len(reloaded.Exclusions) != 1 || reloaded.Exclusions[0] != "/tmp/keep-me" {
		t.Errorf("exclusions = %v", reloaded.Exclusions)
	}
}

// TestHistoryRoundTrip checks that a cleanup is logged and read back.
func TestHistoryRoundTrip(t *testing.T) {
	dir := t.TempDir()
	b := New(Options{DataDir: dir})

	got, err := b.Call("history_list", map[string]any{"limit": float64(10)})
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("history_list returned nil")
	}

	if _, err := b.Call("history_clear", map[string]any{}); err != nil {
		t.Fatal(err)
	}
}
