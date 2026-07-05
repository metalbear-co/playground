#!/usr/bin/env bash
set -euo pipefail
LOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.local-logs"
for f in order-agent router-agent support-frontend; do
  pidfile="${LOG_DIR}/${f}.pid"
  if [ -f "$pidfile" ]; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
    echo "Stopped ${f}"
  fi
done
