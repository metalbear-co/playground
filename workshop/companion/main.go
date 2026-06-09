// workshop — the mirrord workshop companion.
//
// Gets an attendee from zero to a working steal: preflight + install mirrord, claim a seat from
// the broker, write a namespace-scoped kubeconfig, then run a local backend under mirrord with
// hot-reload. Stdlib only → single static binary per OS.
//
//	workshop start  --broker https://broker.example  [--name dan] [--install]
//	workshop run    [--lang python] [--finale] [--dry-run]
//	workshop doctor
//	workshop reset
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "start":
		cmdStart(os.Args[2:])
	case "run":
		cmdRun(os.Args[2:])
	case "doctor":
		cmdDoctor()
	case "reset":
		cmdReset()
	case "claim":
		cmdClaim(os.Args[2:])
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`workshop — mirrord workshop companion

  start    preflight, claim a seat, write kubeconfig
  run      run a local backend under mirrord (--lang, --finale, --dry-run)
  doctor   show environment + seat status
  reset    clear local workshop state

Env: WORKSHOP_BROKER, WORKSHOP_NAME`)
}

func cmdStart(args []string) {
	fs := flag.NewFlagSet("start", flag.ExitOnError)
	broker := fs.String("broker", os.Getenv("WORKSHOP_BROKER"), "broker URL")
	name := fs.String("name", defaultName(), "your name (idempotent claim key)")
	install := fs.Bool("install", false, "install mirrord if missing")
	fs.Parse(args)

	banner()
	preflight(*install)

	if *broker == "" {
		die("No broker URL. Pass --broker or set WORKSHOP_BROKER (the facilitator will give you this).")
	}

	step("Claiming your seat")
	seat, err := claimSeat(*broker, *name)
	if err != nil {
		die(err.Error())
	}
	saveSeat(seat)
	ok(fmt.Sprintf("Seat %s  (namespace %s)", seat.ID, seat.Namespace))

	step("Writing kubeconfig")
	if err := os.WriteFile(kubeconfigPath(), []byte(seat.Kubeconfig), 0o600); err != nil {
		die("writing kubeconfig: " + err.Error())
	}
	ok(kubeconfigPath())

	fmt.Printf(`
%s You're provisioned.

  Storefront:  %s
  Next:        workshop run          (steal your inventory-service)
               workshop run --finale (the shared-target finale)

  For kubectl in this shell:  export KUBECONFIG=%s
`, green("✓"), seat.URL, kubeconfigPath())
}

func cmdClaim(args []string) {
	fs := flag.NewFlagSet("claim", flag.ExitOnError)
	broker := fs.String("broker", os.Getenv("WORKSHOP_BROKER"), "broker URL")
	name := fs.String("name", defaultName(), "your name")
	fs.Parse(args)
	if *broker == "" {
		die("set --broker or WORKSHOP_BROKER")
	}
	seat, err := claimSeat(*broker, *name)
	if err != nil {
		die(err.Error())
	}
	saveSeat(seat)
	_ = os.WriteFile(kubeconfigPath(), []byte(seat.Kubeconfig), 0o600)
	ok(fmt.Sprintf("Seat %s — %s", seat.ID, seat.URL))
}

func cmdDoctor() {
	banner()
	preflight(false)
	step("Workshop state")
	if seat := loadSeat(); seat != nil {
		ok(fmt.Sprintf("Seat %s (%s) — %s", seat.ID, seat.Namespace, seat.URL))
		if _, err := os.Stat(kubeconfigPath()); err == nil {
			ok("kubeconfig: " + kubeconfigPath())
		} else {
			warn("kubeconfig missing — re-run `workshop start`")
		}
	} else {
		warn("No seat claimed yet — run `workshop start`")
	}
}

func cmdReset() {
	dir := configDir()
	if err := os.RemoveAll(dir); err != nil {
		die(err.Error())
	}
	ok("cleared " + dir)
}

// ── state ───────────────────────────────────────────────────────────────────

func configDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base, _ = os.UserHomeDir()
	}
	d := filepath.Join(base, "metalbear-workshop")
	_ = os.MkdirAll(d, 0o755)
	return d
}

func kubeconfigPath() string { return filepath.Join(configDir(), "kubeconfig") }
func seatPath() string       { return filepath.Join(configDir(), "seat.json") }

// workDir is a VISIBLE folder (not ~/Library/...) where attendees edit their backend.
func workDir() string {
	home, _ := os.UserHomeDir()
	d := filepath.Join(home, "mirrord-workshop")
	_ = os.MkdirAll(d, 0o755)
	return d
}

func saveSeat(s *Seat) {
	b, _ := json.MarshalIndent(s, "", "  ")
	_ = os.WriteFile(seatPath(), b, 0o600)
}

func loadSeat() *Seat {
	b, err := os.ReadFile(seatPath())
	if err != nil {
		return nil
	}
	var s Seat
	if json.Unmarshal(b, &s) != nil {
		return nil
	}
	return &s
}

func defaultName() string {
	if n := os.Getenv("WORKSHOP_NAME"); n != "" {
		return n
	}
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	h, _ := os.Hostname()
	return h
}

// ── output helpers ────────────────────────────────────────────────────────────

func banner() { fmt.Println("\n  Metal" + orange("Mart") + " 🐻  mirrord workshop\n") }

func step(s string) { fmt.Println("\n" + purple("▸ ") + bold(s)) }
func ok(s string)   { fmt.Println("  " + green("✓") + " " + s) }
func info(s string) { fmt.Println("  · " + s) }
func warn(s string) { fmt.Println("  " + orange("!") + " " + s) }
func die(s string)  { fmt.Println("  " + red("✗") + " " + s); os.Exit(1) }

func join(args []string) string { return strings.Join(args, " ") }

// ANSI (no-op if NO_COLOR set or not a TTY-ish env).
func color(code, s string) string {
	if os.Getenv("NO_COLOR") != "" {
		return s
	}
	return "\033[" + code + "m" + s + "\033[0m"
}
func green(s string) string  { return color("32", s) }
func red(s string) string    { return color("31", s) }
func orange(s string) string { return color("33", s) }
func purple(s string) string { return color("35", s) }
func bold(s string) string   { return color("1", s) }
