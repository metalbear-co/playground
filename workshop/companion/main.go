// workshop — the mirrord workshop companion.
//
// Does the boring setup (preflight, install mirrord, claim a seat, write your backend + mirrord.json
// + kubeconfig into ~/mirrord-workshop) and then GETS OUT OF THE WAY: it prints the kubectl and
// `mirrord exec` commands for you to run yourself, so you actually see how mirrord works.
// Stdlib only → single static binary per OS.
//
//	workshop start  --broker https://broker.example  [--name dan] [--lang python] [--install]
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
	case "doctor":
		cmdDoctor()
	case "reset":
		cmdReset()
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`workshop — mirrord workshop companion

  start    set up ~/mirrord-workshop and print the commands to run yourself
  doctor   show environment + seat status
  reset    clear local workshop state

Env: WORKSHOP_BROKER, WORKSHOP_NAME`)
}

func cmdStart(args []string) {
	fs := flag.NewFlagSet("start", flag.ExitOnError)
	broker := fs.String("broker", os.Getenv("WORKSHOP_BROKER"), "broker URL")
	name := fs.String("name", defaultName(), "your name (idempotent claim key)")
	langName := fs.String("lang", "", "backend language (default: first one you have installed)")
	install := fs.Bool("install", false, "install mirrord if missing")
	fs.Parse(args)

	banner()
	langs := preflight(*install)

	if *broker == "" {
		die("No broker URL. Pass --broker or set WORKSHOP_BROKER (the facilitator will give you this).")
	}

	// Pick the language: explicit --lang, else the first one they have installed.
	var lang Lang
	if *langName != "" {
		l, found := langByName(*langName)
		if !found {
			die("unknown --lang " + *langName)
		}
		lang = l
	} else if len(langs) > 0 {
		lang = langs[0]
	} else {
		die("no supported runtime found — install node/python3/go/java/ruby/dotnet/php")
	}

	step("Claiming your seat")
	seat, err := claimSeat(*broker, *name)
	if err != nil {
		die(err.Error())
	}
	saveSeat(seat)
	ok(fmt.Sprintf("Seat %s  (namespace %s)", seat.ID, seat.Namespace))

	step("Setting up ~/mirrord-workshop")
	if err := os.WriteFile(kubeconfigPath(), []byte(seat.Kubeconfig), 0o600); err != nil {
		die("writing kubeconfig: " + err.Error())
	}
	backends, err := cacheBackends()
	if err != nil {
		die(err.Error())
	}
	if err := setupLang(backends, lang); err != nil {
		die("setting up backend: " + err.Error())
	}
	ok(fmt.Sprintf("%s, mirrord.json, reload.sh, kubeconfig", lang.Watch))
	openEditor(filepath.Join(workDir(), lang.Watch))

	printGuide(seat, lang)
}

// printGuide explains the architecture and prints the exact commands the attendee runs themselves.
func printGuide(seat *Seat, lang Lang) {
	pre := ""
	if lang.Pre != "" {
		pre = fmt.Sprintf("\n  (first, one-off)          %s", bold(lang.Pre))
	}
	fmt.Printf(`
%s

  In the cluster, a %s pod calls a %s pod (the backend) to get products. You'll run
  that backend on YOUR laptop — mirrord steals the backend's traffic, so the cluster's frontend
  ends up talking to your machine. Nothing is deployed; your local process just takes over.

%s

  cd %s
  export KUBECONFIG=%s%s

  1. see the two pods          %s
  2. read the steal config     %s
  3. take over the backend     %s
  4. open your store           %s
  5. edit %s (the PREFIX line) and save — it hot-reloads; refresh the store.

  (Ctrl-C in step 3 to stop; your products come from your laptop while it runs.)
`,
		bold("How it works"),
		green("frontend"), green("inventory-service"),
		bold("Now open a terminal and run these yourself"),
		workDir(), kubeconfigPath(), pre,
		bold("kubectl get pods"),
		bold("cat mirrord.json"),
		bold(lang.mirrordCmd()),
		seat.URL,
		lang.Watch,
	)
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
	for _, dir := range []string{configDir(), workDir()} {
		_ = os.RemoveAll(dir)
	}
	ok("cleared local workshop state (~/mirrord-workshop + cache)")
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

func kubeconfigPath() string { return filepath.Join(workDir(), "kubeconfig") } // visible folder
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
