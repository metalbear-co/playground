package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Populated by build.sh, which copies ../backends into assets/backends before `go build`.
//
//go:embed all:assets
var assetsFS embed.FS

// cacheBackends extracts the embedded backends into a hidden cache and returns that dir.
func cacheBackends() (string, error) {
	base := filepath.Join(configDir(), "assets")
	err := fs.WalkDir(assetsFS, "assets/backends", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(configDir(), p) // -> <cfg>/assets/backends/...
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		b, e := assetsFS.ReadFile(p)
		if e != nil {
			return e
		}
		return os.WriteFile(target, b, 0o644)
	})
	backends := filepath.Join(base, "backends")
	if _, statErr := os.Stat(filepath.Join(backends, "mirrord.json")); statErr != nil {
		return "", fmt.Errorf("backends not bundled — run companion/build.sh to populate assets/")
	}
	// go:embed can't carry go/go.mod (nested module); build.sh renamed it to go.mod.embed. Restore it.
	if emb := filepath.Join(backends, "go", "go.mod.embed"); fileExists(emb) {
		if b, e := os.ReadFile(emb); e == nil {
			_ = os.WriteFile(filepath.Join(backends, "go", "go.mod"), b, 0o644)
		}
	}
	return backends, err
}

// setupLang copies the chosen backend's files + mirrord.json + reload.sh into the attendee's flat
// working folder (~/mirrord-workshop). Existing files are kept so re-running doesn't clobber edits.
func setupLang(backends string, lang Lang) error {
	dst := workDir()
	srcDir := filepath.Join(backends, lang.Dir)
	for _, f := range lang.Files {
		if err := copyFileKeep(filepath.Join(srcDir, f), filepath.Join(dst, f)); err != nil {
			return err
		}
	}
	for _, f := range []string{"mirrord.json", "reload.sh"} {
		if err := copyFileKeep(filepath.Join(backends, f), filepath.Join(dst, f)); err != nil {
			return err
		}
	}
	return nil
}

func copyFileKeep(src, dst string) error {
	if fileExists(dst) {
		return nil // preserve the attendee's edits
	}
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, b, 0o644)
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

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
