package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"

	"github.com/egoist/mygo"

	"gocleaner/internal/bridge"
)

// dist holds the built frontend. `mygo build` embeds it too, but embedding it
// here means a plain `go build` produces a working app as well.
//
//go:embed all:frontend/dist
var dist embed.FS

// jobProgress carries a running job's progress to the page. The shim turns it
// into the `job-progress` event Tauri's listeners expect.
var jobProgress = mygo.NewEvent[bridge.ProgressPayload]("reclaim:progress")

// Reclaim is the service the page calls. Every Tauri command name the React
// app uses arrives at Call.
type Reclaim struct {
	b *bridge.Bridge
}

// Call answers one Tauri command with its arguments.
func (r *Reclaim) Call(cmd string, args map[string]any) (any, error) {
	return r.b.Call(cmd, args)
}

// Listen subscribes a page callback to an event and returns its id.
func (r *Reclaim) Listen(event string, callbackID int) (int, error) {
	return r.b.Listen(event, callbackID), nil
}

// Unlisten removes a subscription.
func (r *Reclaim) Unlisten(event string, callbackID int) error {
	r.b.Unlisten(event, callbackID)
	return nil
}

// PickFolders asks the user for folders.
func (r *Reclaim) PickFolders(directory, multiple bool) ([]string, error) {
	return r.b.PickFolders(directory, multiple), nil
}

// OpenUrl opens a URL in the default browser.
func (r *Reclaim) OpenUrl(url string) error { return r.b.OpenURL(url) }

// OpenPath opens a path with the default application.
func (r *Reclaim) OpenPath(path string) error { return r.b.OpenPath(path) }

// RevealPath shows a path in the file manager.
func (r *Reclaim) RevealPath(path string) error { return r.b.RevealPath(path) }

func main() {
	dataDir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		log.Fatal(err)
	}

	// The frontend is served from the embedded build.
	web, err := fs.Sub(dist, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	mygo.SetFrontend(web)

	service := &Reclaim{}
	b := bridge.New(bridge.Options{
		DataDir: dataDir,
		Emit: func(name string, payload any) {
			// Progress is the only event the engine pushes; it goes out on
			// the runtime's own channel, which the shim listens to.
			if data, err := json.Marshal(payload); err == nil {
				var p bridge.ProgressPayload
				if json.Unmarshal(data, &p) == nil {
					jobProgress.Broadcast(p)
				}
			}
		},
	})
	service.b = b

	mygo.BindAs("Reclaim", service)

	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:     "ReClaim Cleaner",
			URL:       "/",
			Width:     1180,
			Height:    780,
			MinWidth:  900,
			MinHeight: 600,
		})
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
