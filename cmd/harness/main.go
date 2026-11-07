package main

// A manual harness: it calls the bridge the way the page does, so the engine
// can be exercised without a window.

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"gocleaner/internal/bridge"
)

func main() {
	dir, err := os.MkdirTemp("", "reclaim-test")
	if err != nil {
		panic(err)
	}
	b := bridge.New(bridge.Options{DataDir: dir})

	call := func(cmd string, args map[string]any) any {
		start := time.Now()
		out, err := b.Call(cmd, args)
		ms := time.Since(start).Milliseconds()
		if err != nil {
			fmt.Printf("%-22s ERROR %v (%dms)\n", cmd, err, ms)
			return nil
		}
		data, _ := json.Marshal(out)
		s := string(data)
		if len(s) > 320 {
			s = s[:320] + "..."
		}
		fmt.Printf("%-22s OK %s (%dms)\n", cmd, s, ms)
		return out
	}

	fmt.Println("=== app_info ===")
	call("app_info", nil)
	fmt.Println("\n=== drives ===")
	call("drives", nil)
	fmt.Println("\n=== rules_list ===")
	rules := call("rules_list", nil)
	if payload, ok := rules.(interface{}); ok {
		_ = payload
	}
	fmt.Println("\n=== settings_get ===")
	call("settings_get", nil)
	fmt.Println("\n=== junk_scan ===")
	junk := call("junk_scan", nil)
	if results, ok := junk.([]interface{}); ok {
		_ = results
	}
	fmt.Println("\n=== explorer_scan (home) ===")
	home := os.Getenv("HOME")
	call("explorer_scan", map[string]any{"root": home, "selection": nil})
	fmt.Println("\n=== explorer_summary ===")
	call("explorer_summary", nil)
	fmt.Println("\n=== explorer_node (root) ===")
	call("explorer_node", map[string]any{"id": 1, "depth": 1, "limit": 5})
	fmt.Println("\n=== explorer_large ===")
	call("explorer_large", map[string]any{"minBytes": 50 * 1024 * 1024, "limit": 5})
	fmt.Println("\n=== explorer_extensions ===")
	call("explorer_extensions", map[string]any{"limit": 5})
	fmt.Println("\n=== duplicates_scan ===")
	call("duplicates_scan", map[string]any{"roots": []string{home}, "minBytes": 5 * 1024 * 1024})
	fmt.Println("\n=== empty_scan ===")
	call("empty_scan", map[string]any{"roots": []string{home}})
	fmt.Println("\n=== installers_scan ===")
	call("installers_scan", nil)
	fmt.Println("\n=== downloads_report ===")
	call("downloads_report", nil)
	fmt.Println("\n=== ai_models ===")
	call("ai_models", nil)
	fmt.Println("\n=== assistant_data ===")
	call("assistant_data", nil)
	fmt.Println("\n=== steam_report ===")
	call("steam_report", nil)
	fmt.Println("\n=== hidden_space ===")
	call("hidden_space", map[string]any{"root": home})
	fmt.Println("\n=== recycle_bin_info ===")
	call("recycle_bin_info", nil)
	fmt.Println("\n=== history_list ===")
	call("history_list", map[string]any{"limit": 10})
	fmt.Println("\n=== unsupported (expected) ===")
	call("apps_list", nil)
	call("startup_list", nil)
	call("tool_run", map[string]any{"id": "dism-cleanup"})
	fmt.Println("\n=== projects_scan ===")
	call("projects_scan", map[string]any{"roots": []string{"/home/cachy/projects"}})
}
