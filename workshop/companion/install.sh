#!/usr/bin/env bash
# One-line installer for the mirrord workshop companion.
#
#   curl -fsSL https://storage.googleapis.com/mirrord-workshop-dist/install.sh | bash
#
# Installing via curl (not a browser) means the binary has no macOS quarantine flag, so Gatekeeper
# won't block it — no Apple notarization required. (The xattr line below is belt-and-suspenders.)
set -euo pipefail

BASE="${COMPANION_BASE:-https://storage.googleapis.com/mirrord-workshop-dist}"
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; esac
bin="workshop-${os}-${arch}"

echo "Downloading ${bin}…"
tmp=$(mktemp)
curl -fsSL "${BASE}/${bin}" -o "$tmp"
chmod +x "$tmp"
[ "$os" = "darwin" ] && xattr -d com.apple.quarantine "$tmp" 2>/dev/null || true

dest=/usr/local/bin/workshop
if mv "$tmp" "$dest" 2>/dev/null; then :; else sudo mv "$tmp" "$dest"; fi
echo "Installed: $(command -v workshop)"
echo "Next:  WORKSHOP_BROKER=https://mirrord-workshop.com/api workshop start"
