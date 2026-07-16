#!/usr/bin/env bash
# The mirrord POC choreography for the EVENT-DRIVEN kafka-demo mode.
#
# It demonstrates the two capabilities this POC sells:
#   * Idle Preview Environments — a preview of service-c-ev that runs ZERO pods
#     until a matching Kafka message arrives, then boots to handle it.
#   * CronJob DB-branching      — CronJob Z run under mirrord reads an ISOLATED
#     Postgres branch, so its reads/writes never touch shared staging.
#
# Flow: press the button in the /kafka-demo-ev UI with your session set ->
#   service-b-ev writes a session-tagged "pending" row -> the branched CronJob Z
#   reads only your rows and emits a session-tagged event -> that message wakes your
#   idle service-c-ev preview, which processes only your message while the cluster
#   copy keeps serving everyone else.
#
# Usage:
#   ./preview-event-driven.sh idle     # start the idle service-c-ev preview (foreground)
#   ./preview-event-driven.sh cron     # run CronJob Z under mirrord w/ DB branching (foreground)
#   ./preview-event-driven.sh trigger  # run the in-cluster CronJob Z NOW (skip the ~1m wait)
#   ./preview-event-driven.sh stop     # stop previews and clear leftover sessions
#   ./preview-event-driven.sh clean    # clear leftover split/preview/branch CRDs for *-ev
#   ./preview-event-driven.sh --help
#
# Requires the mirrord operator build that includes idle previews + cronjob branching
# (see the base demo's >= 3.170.0 note; confirm the operator supports idle previews
# and cronjob DB-branching).
set -euo pipefail

NS=kafka-demo-event
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDLE_CFG="${SCRIPT_DIR}/../service-c/mirrord-preview-ev.json"
CRON_CFG="${SCRIPT_DIR}/../cronjob/mirrord-preview.json"
IDLE_IMG="ghcr.io/metalbear-co/playground-kafka-demo-service-c:preview"

# Delete leftover cluster-scoped split sessions for the -ev services. Bare Ctrl-C of
# a preview leaves these behind; stale sessions route tagged messages to a dead
# consumer and the chain looks "stuck". Safe to run before a start.
clean_sessions() {
  local left
  left="$(kubectl get mirrordclustersplitsessions -o name 2>/dev/null | grep -E '\.service-[abc]-ev\.deployment' || true)"
  if [ -n "${left}" ]; then
    echo "==> clearing leftover *-ev split sessions:"
    echo "${left}" | sed 's/^/    /'
    echo "${left}" | xargs -r kubectl delete >/dev/null 2>&1 || true
  else
    echo "==> no leftover *-ev split sessions"
  fi
}

clean_previews_branches() {
  local previews branches
  previews="$(kubectl -n "${NS}" get previewsessions -o name 2>/dev/null || true)"
  if [ -n "${previews}" ]; then
    echo "==> clearing preview sessions in ${NS}:"
    echo "${previews}" | sed 's/^/    /'
    echo "${previews}" | xargs -r -I{} kubectl -n "${NS}" delete {} >/dev/null 2>&1 || true
  fi
  branches="$(kubectl -n "${NS}" get branchdatabases -o name 2>/dev/null || true)"
  if [ -n "${branches}" ]; then
    echo "==> clearing branch databases in ${NS}:"
    echo "${branches}" | sed 's/^/    /'
    echo "${branches}" | sed 's#^branchdatabase[^/]*/##' \
      | xargs -r -I{} kubectl -n "${NS}" delete branchdatabase {} >/dev/null 2>&1 || true
  fi
  # stray branch-db pods
  kubectl -n "${NS}" get pods 2>/dev/null | awk '/postgresql-branch-db-pod/ {print $1}' \
    | xargs -r -I{} kubectl -n "${NS}" delete pod {} >/dev/null 2>&1 || true
}

case "${1:-}" in
  idle)
    clean_sessions
    echo "==> starting IDLE preview of service-c-ev (0 pods until a matching event; Ctrl-C is fine)"
    exec mirrord preview start -f "${IDLE_CFG}" -i "${IDLE_IMG}"
    ;;
  cron)
    echo "==> running CronJob Z under mirrord with DB branching (reads an isolated branch)"
    echo "    config: ${CRON_CFG}"
    echo "    note: needs an operator build with cronjob DB-branching support."
    exec mirrord preview start -f "${CRON_CFG}"
    ;;
  trigger)
    RUN="cronjob-z-manual-$(date +%s)"
    echo "==> creating a one-off Job from cronjob/cronjob-z (${RUN}) so you don't wait for the schedule"
    kubectl -n "${NS}" create job --from=cronjob/cronjob-z "${RUN}"
    kubectl -n "${NS}" wait --for=condition=complete "job/${RUN}" --timeout=120s || true
    kubectl -n "${NS}" logs "job/${RUN}" || true
    ;;
  stop)
    mirrord preview stop 2>/dev/null || true
    clean_sessions
    clean_previews_branches
    echo "==> previews stopped, sessions/branches cleared"
    ;;
  clean)
    clean_sessions
    clean_previews_branches
    echo "done."
    ;;
  -h|--help|help|"")
    sed -n '2,30p' "$0"
    ;;
  *)
    echo "usage: $0 {idle|cron|trigger|stop|clean|--help}" >&2
    exit 1
    ;;
esac
