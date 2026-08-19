#!/usr/bin/env bash
#
# Reliable start/stop for the kafka-demo service-c preview environment.
#
# Why this exists: mirrord queue-split sessions are represented by cluster-scoped
# MirrordClusterSplitSession CRDs. Each `mirrord preview start` registers one for
# service-c. If a preview is ended with a bare Ctrl-C (instead of a clean stop),
# the CRD is left behind. The operator then has several split sessions with the
# same key, and routes tagged messages to a now-dead session's topic that has no
# consumer — so the chain looks "stuck" (trace reaches service-b and never c).
#
# This wrapper deletes any leftover service-c split sessions BEFORE starting, so
# exactly one live session ever exists. Stop/start becomes reliable.
#
# Usage:
#   ./preview.sh start    # clear orphans, then start the preview (foreground)
#   ./preview.sh stop     # stop the preview and clear any leftover sessions
#   ./preview.sh clean     # just clear leftover service-c split sessions
set -euo pipefail

NS=kafka-demo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="${SCRIPT_DIR}/../service-c/mirrord-preview.json"
IMG="ghcr.io/metalbear-co/playground-kafka-demo-service-c:preview"

# Delete every leftover service-c split session (cluster-scoped CRD). Safe to run
# before a start: the fresh session doesn't exist yet, so this only removes orphans.
clean_sessions() {
  local left
  left="$(kubectl get mirrordclustersplitsessions -o name 2>/dev/null | grep '\.service-c\.deployment' || true)"
  if [ -n "${left}" ]; then
    echo "==> clearing leftover service-c split sessions:"
    echo "${left}" | sed 's/^/    /'
    echo "${left}" | xargs -r kubectl delete >/dev/null 2>&1 || true
  else
    echo "==> no leftover split sessions"
  fi
}

case "${1:-start}" in
  start)
    clean_sessions
    echo "==> starting preview (Ctrl-C is fine — next 'start' auto-cleans)"
    exec mirrord preview start -f "${CFG}" -i "${IMG}"
    ;;
  stop)
    mirrord preview stop 2>/dev/null || true
    clean_sessions
    echo "==> preview stopped, sessions cleared"
    ;;
  clean)
    clean_sessions
    ;;
  *)
    echo "usage: $0 {start|stop|clean}" >&2
    exit 1
    ;;
esac
