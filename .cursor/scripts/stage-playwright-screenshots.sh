#!/usr/bin/env bash
# Copy Playwright screenshots from /tmp into /opt/cursor/artifacts/screenshots
# so ManagePullRequest can upload them when creating or updating a PR.
#
# Usage:
#   .cursor/scripts/stage-playwright-screenshots.sh [glob...]
#
# Examples:
#   .cursor/scripts/stage-playwright-screenshots.sh
#   .cursor/scripts/stage-playwright-screenshots.sh /tmp/screenshots/mirrord-run-*.png
#   .cursor/scripts/stage-playwright-screenshots.sh /tmp/screenshots/iter1-*.png
#
# With no arguments, stages common mirrord Playwright outputs:
#   /tmp/screenshots/mirrord-run-*.png
#   /tmp/screenshots/iter*-*.png

set -euo pipefail

DEST="/opt/cursor/artifacts/screenshots"
mkdir -p "$DEST"

shopt -s nullglob

if [ "$#" -gt 0 ]; then
  patterns=("$@")
else
  patterns=(
    /tmp/screenshots/mirrord-run-*.png
    /tmp/screenshots/iter*-*.png
  )
fi

staged=()
for pattern in "${patterns[@]}"; do
  for src in $pattern; do
    [ -f "$src" ] || continue
    base="$(basename "$src")"
    dest="$DEST/$base"
    cp -f "$src" "$dest"
    staged+=("$dest")
    echo "staged: $dest"
  done
done

if [ "${#staged[@]}" -eq 0 ]; then
  echo "No screenshots found to stage." >&2
  exit 1
fi

# Print HTML img tags for PR bodies (ManagePullRequest uploads these paths).
echo ""
echo "PR body snippets:"
for path in "${staged[@]}"; do
  alt="$(basename "$path" .png | tr '_-' ' ')"
  echo "<img alt=\"${alt}\" src=\"${path}\" />"
done
