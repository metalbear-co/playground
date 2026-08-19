#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${CODEX_HOME:-$HOME/.codex}/skills"

if [ "$#" -eq 0 ]; then
  set -- commit-push-pr minikube-deploy mirrord-agent-shop pm-feature-workflow preview-shop
fi

mkdir -p "$DEST_DIR"

for skill in "$@"; do
  SRC_DIR="$ROOT_DIR/$skill"
  TARGET_DIR="$DEST_DIR/$skill"

  if [ ! -f "$SRC_DIR/SKILL.md" ]; then
    echo "missing SKILL.md for $skill at $SRC_DIR" >&2
    exit 1
  fi

  if [ -e "$TARGET_DIR" ]; then
    echo "destination already exists: $TARGET_DIR" >&2
    exit 1
  fi

  mkdir -p "$TARGET_DIR"
  cp "$SRC_DIR/SKILL.md" "$TARGET_DIR/SKILL.md"

  for extra_dir in agents scripts references assets; do
    if [ -d "$SRC_DIR/$extra_dir" ]; then
      cp -R "$SRC_DIR/$extra_dir" "$TARGET_DIR/$extra_dir"
    fi
  done

  echo "installed $skill -> $TARGET_DIR"
done

echo "Restart Codex to pick up new skills."
