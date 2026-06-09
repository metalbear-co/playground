package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// openEditor best-effort opens the backend file so attendees don't hunt for it. Prefers VS Code;
// otherwise reveals it in Finder (never `open <file.py>` — macOS might RUN it via Python Launcher).
func openEditor(path string) {
	if p, err := exec.LookPath("code"); err == nil {
		_ = exec.Command(p, path).Start()
		return
	}
	switch runtime.GOOS {
	case "darwin":
		_ = exec.Command("open", "-R", path).Start()
	default:
		_ = exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

// Populated by build.sh, which copies ../backends into assets/backends before `go build`.
//
//go:embed all:assets
var assetsFS embed.FS

// extractAssets writes embedded files under <config>/assets, SKIPPING files that already exist
// so an attendee's edits survive re-runs. Returns the backends dir.
func extractAssets() (string, error) {
	base := workDir()
	err := fs.WalkDir(assetsFS, "assets/backends", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(p, "assets/") // "backends/..."
		target := filepath.Join(base, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if _, err := os.Stat(target); err == nil {
			return nil // keep existing (possibly edited) file
		}
		b, err := assetsFS.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0o644)
	})
	backends := filepath.Join(base, "backends")
	if _, statErr := os.Stat(filepath.Join(backends, "mirrord-core.json")); statErr != nil {
		return "", fmt.Errorf("backends not bundled — run companion/build.sh to populate assets/")
	}
	// go:embed couldn't carry go/go.mod (nested module); build.sh renamed it to go.mod.embed.
	// Restore it so `go run` works.
	goEmbed, goMod := filepath.Join(backends, "go", "go.mod.embed"), filepath.Join(backends, "go", "go.mod")
	if _, e := os.Stat(goEmbed); e == nil {
		if _, e2 := os.Stat(goMod); e2 != nil {
			if b, e3 := os.ReadFile(goEmbed); e3 == nil {
				_ = os.WriteFile(goMod, b, 0o644)
			}
		}
	}
	return backends, err
}

func cmdRun(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	langName := fs.String("lang", "", "backend language (default: first detected)")
	finale := fs.Bool("finale", false, "use the finale config (shared target + baggage filter)")
	dryRun := fs.Bool("dry-run", false, "print the mirrord command instead of running it")
	broker := fs.String("broker", os.Getenv("WORKSHOP_BROKER"), "broker URL (for progress board)")
	fs.Parse(args)

	seat := loadSeat()
	if seat == nil {
		die("No seat yet — run `workshop start` first.")
	}

	backends, err := extractAssets()
	if err != nil {
		die(err.Error())
	}

	// Choose the language.
	var lang Lang
	if *langName != "" {
		l, ok := langByName(*langName)
		if !ok {
			die("unknown --lang " + *langName)
		}
		if _, err := exec.LookPath(l.Bin); err != nil {
			die(fmt.Sprintf("%s isn't installed (need %q on PATH)", l.Name, l.Bin))
		}
		lang = l
	} else {
		detected := detectLangs()
		if len(detected) == 0 {
			die("no supported runtime installed")
		}
		lang = detected[0]
		info("Auto-selected " + lang.Name + " (override with --lang)")
	}

	cmdDir := filepath.Join(backends, lang.Dir)
	config := filepath.Join(backends, "mirrord-core.json")
	if *finale {
		config = filepath.Join(backends, "mirrord-finale.json")
	}
	watchFile := filepath.Join(cmdDir, lang.Watch)

	// Node needs its deps before first run.
	if lang.Name == "node" {
		if _, err := os.Stat(filepath.Join(cmdDir, "node_modules")); os.IsNotExist(err) {
			step("Installing Node deps (npm install)")
			c := exec.Command("npm", "install")
			c.Dir, c.Stdout, c.Stderr = cmdDir, os.Stdout, os.Stderr
			if err := c.Run(); err != nil {
				die("npm install failed: " + err.Error())
			}
		}
	}

	env := append(os.Environ(), "KUBECONFIG="+kubeconfigPath())
	env = append(env, "PYTHONUNBUFFERED=1") // so the Python backend's logs aren't block-buffered when piped
	if *finale {
		env = append(env, "WORKSHOP_KEY="+seat.ID) // baggage filter key
	}

	// Run the backend under a keep-alive wrapper INSIDE the mirrord session, so edits restart only
	// the local app — the steal/agent (and its port-80 lock) persists, avoiding the cross-session
	// lock conflict a full `mirrord exec` restart causes.
	reloadScript := filepath.Join(workDir(), "reload.sh")
	if err := os.WriteFile(reloadScript, []byte(reloadSh), 0o755); err != nil {
		die("writing reload script: " + err.Error())
	}
	mirrordArgs := append([]string{"exec", "-f", config, "--", "sh", reloadScript, watchFile, lang.Bin}, lang.Args...)

	if *dryRun {
		fmt.Printf("cd %s\nKUBECONFIG=%s ", cmdDir, kubeconfigPath())
		if *finale {
			fmt.Printf("WORKSHOP_KEY=%s ", seat.ID)
		}
		fmt.Printf("mirrord %s\n", join(mirrordArgs))
		return
	}

	if _, has := mirrordPath(); !has {
		die("mirrord not installed — run `workshop start --install`")
	}

	mode, openURL := "CORE", seat.URL
	if *finale {
		// Finale lives at <host>/finale/<key>/, not the attendee's /aNN/ path. The page reads the
		// key from the URL and stamps it into the baggage header that the operator filter matches.
		mode = "FINALE"
		openURL = strings.TrimSuffix(seat.URL, seat.ID+"/") + "finale/" + seat.ID + "/"
	}
	step(fmt.Sprintf("Stealing as %s [%s] — %s", lang.Name, mode, seat.ID))
	info("Open:  " + openURL)
	info("Edit:  " + watchFile + "   (save to hot-reload)")
	openEditor(watchFile) // best-effort: pop it open so they don't have to hunt for it
	reportProgress(*broker, seat.ID, "steal:"+lang.Name)

	supervise(cmdDir, env, mirrordArgs)
}

// supervise runs the mirrord session (which runs the keep-alive wrapper) and exits cleanly on
// Ctrl-C. Hot-reload happens inside the session via reloadSh, so there's nothing to restart here.
func supervise(dir string, env, mirrordArgs []string) {
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)

	cmd := exec.Command("mirrord", mirrordArgs...)
	cmd.Dir, cmd.Env = dir, env
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	if err := cmd.Start(); err != nil {
		die("failed to start mirrord: " + err.Error())
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-done: // session/app exited on its own — let any error above be seen
	case <-sigs:
		info("stopping…")
		stop(cmd)
		<-done
	}
}

func stop(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// Give mirrord time to tear down the operator session cleanly — a hard kill leaves a zombie
	// session holding the steal lock, which blocks the next `workshop run` until it times out.
	_ = cmd.Process.Signal(syscall.SIGTERM)
	go func() {
		time.Sleep(10 * time.Second)
		_ = cmd.Process.Kill()
	}()
}

// reloadSh is the in-session keep-alive wrapper. It runs the backend, watches the source file
// locally (mirrord fs:local), and on change restarts ONLY the app (its whole process group, so
// `go run`'s child dies too) — the mirrord session and its steal persist across reloads.
// Usage: sh reload.sh <watchFile> <appCmd...>
const reloadSh = `#!/bin/sh
set -m
watch="$1"; shift
mtime() { stat -f %m "$watch" 2>/dev/null || stat -c %Y "$watch" 2>/dev/null; }
start() { "$@" & app=$!; }
stop()  { kill -- -"$app" 2>/dev/null; wait "$app" 2>/dev/null; }
trap 'stop; exit 0' TERM INT
start "$@"
prev=$(mtime)
while true; do
  sleep 1
  cur=$(mtime)
  [ "$cur" = "$prev" ] && continue
  prev=$cur
  echo "↻ reloading backend…"
  stop
  start "$@"
done
`
