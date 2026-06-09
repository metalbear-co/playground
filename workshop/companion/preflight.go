package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Pin the CLI to the version validated against the deployed operator (install.sh honors VERSION).
const pinnedMirrordVersion = "3.210.0"
const mirrordInstall = "curl -fsSL https://raw.githubusercontent.com/metalbear-co/mirrord/main/scripts/install.sh | VERSION=" + pinnedMirrordVersion + " bash"

// detectLangs returns the supported backends whose runtime is on PATH.
func detectLangs() []Lang {
	var found []Lang
	for _, l := range Langs {
		if _, err := exec.LookPath(l.Bin); err == nil {
			found = append(found, l)
		}
	}
	return found
}

func mirrordPath() (string, bool) {
	p, err := exec.LookPath("mirrord")
	return p, err == nil
}

func mirrordVersion() string {
	out, err := exec.Command("mirrord", "--version").CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// installMirrord runs the official install script via the shell.
func installMirrord() error {
	step("Installing mirrord")
	cmd := exec.Command("sh", "-c", mirrordInstall)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}

// preflight prints environment status and returns the detected runtimes.
// If mirrord is missing it installs (when autoInstall) or prints instructions.
func preflight(autoInstall bool) []Lang {
	step("Preflight")
	info(fmt.Sprintf("OS/arch: %s/%s", runtime.GOOS, runtime.GOARCH))
	if runtime.GOOS == "windows" {
		warn("Native Windows isn't supported by this workshop — run everything inside WSL2.")
	}

	langs := detectLangs()
	if len(langs) == 0 {
		warn("No supported runtime found (node/python3/go/java/ruby/dotnet/php). Install one.")
	} else {
		names := make([]string, len(langs))
		for i, l := range langs {
			names[i] = l.Name
		}
		ok(fmt.Sprintf("Runtimes available: %s", strings.Join(names, ", ")))
	}

	if _, has := mirrordPath(); has {
		ok("mirrord installed: " + mirrordVersion())
	} else if autoInstall {
		if err := installMirrord(); err != nil {
			warn("mirrord install failed: " + err.Error())
		} else if _, has := mirrordPath(); has {
			ok("mirrord installed: " + mirrordVersion())
		}
	} else {
		warn("mirrord not found. Install it with:\n    " + mirrordInstall + "\n  (or re-run `workshop start --install`)")
	}
	return langs
}
