#!/usr/bin/env bash
# Build the companion. Copies the polyglot backends + mirrord configs into assets/ so they get
# embedded into the binary (go:embed can't reach outside the module dir), then builds.
#
#   ./build.sh            # build ./workshop for the host
#   ./build.sh release    # cross-compile static binaries for mac/linux/wsl into dist/
set -euo pipefail
cd "$(dirname "$0")"

rm -rf assets/backends
mkdir -p assets
cp -R ../backends assets/backends
rm -rf assets/backends/node/node_modules   # don't ship deps; companion runs npm install on the attendee's machine
# go:embed skips a directory that contains a go.mod (it's a nested module), which would drop the
# whole go/ backend. Rename it so it embeds; the companion restores it to go.mod on extraction.
mv assets/backends/go/go.mod assets/backends/go/go.mod.embed

if [[ "${1:-}" == "release" ]]; then
  mkdir -p dist
  for t in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64; do
    os=${t%/*}; arch=${t#*/}
    echo "building dist/workshop-$os-$arch"
    CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags="-s -w" -o "dist/workshop-$os-$arch" .
  done
else
  go build -o workshop .
  echo "built ./workshop"
fi
