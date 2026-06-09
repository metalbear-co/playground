# Pre-work email (send 2–3 days before)

> Goal: everyone arrives able to run `workshop doctor` with all green, so the room starts warm and
> we spend the hour on mirrord, not installs. ~10 minutes.

---

**Subject: Before our mirrord workshop — 10 min of setup 🐻**

Hi! We'll be running a hands-on mirrord workshop. To make the most of our time, please do this
quick setup **before** you arrive and bring your laptop + charger.

You do **not** need Docker, a Kubernetes cluster, or any cloud account — we provide all of that.

### 1. A language runtime (you almost certainly already have one)

You'll run a tiny service locally in **whatever language you already have** — any one of:
**Node, Python 3, Go, Java (JDK 11+), Ruby, .NET 8, or PHP**. No need to install a new one.

### 2. The workshop companion

One command installs it (works on macOS + WSL2 Linux). Installing via `curl` — not a browser —
means macOS Gatekeeper won't block it:

```sh
curl -fsSL https://storage.googleapis.com/mirrord-workshop-dist/install.sh | bash
```

### 3. Install mirrord + check your setup

```sh
workshop doctor          # shows your OS, runtimes, and whether mirrord is installed
```

If mirrord is missing:

```sh
workshop start --install   # installs the pinned mirrord version for you
```

…or install it directly: `curl -fsSL https://raw.githubusercontent.com/metalbear-co/mirrord/main/scripts/install.sh | bash`

Re-run `workshop doctor` — you want **mirrord installed** and **at least one runtime** listed.

### Windows users — please use WSL2

mirrord runs in Linux. Install WSL2 with Ubuntu, then do **all** of the above **inside the WSL2
terminal** (install mirrord, a runtime, and the `workshop-linux-amd64` binary there). Your browser
stays on Windows — you'll just open a URL we give you. If you've never set up WSL2:
`wsl --install` in an admin PowerShell, reboot, open "Ubuntu", then follow steps 1–3.

### On the day

Your first command will be:

```sh
WORKSHOP_BROKER=https://mirrord-workshop.com/api workshop start --install
```

That's it — see you there! Reply if `workshop doctor` shows anything red.
