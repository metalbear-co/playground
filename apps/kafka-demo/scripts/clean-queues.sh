#!/usr/bin/env bash
#
# Kill & clean mirrord queue-split leftovers for the kafka-demo preview.
#
# Ctrl-C'ing `mirrord preview start` leaves the queue-split session behind
# (a cluster-scoped MirrordClusterSplitSession CRD). They pile up, and the
# operator routes tagged messages to a dead session's topic -> the chain looks
# "stuck" (trace reaches service-b and never c). Run this to wipe the leftovers.
#
# Usage:
#   ./clean-queues.sh          # clean service-c split sessions + kafka-demo previews/branches
#   ./clean-queues.sh --list   # just show what's there, delete nothing
#   ./clean-queues.sh --all    # clean ALL split sessions (every target), not just service-c
set -euo pipefail

NS=kafka-demo
FILTER='\.service-c\.deployment'
[ "${1:-}" = "--all" ] && FILTER='.'

echo "== mirrord queue-split sessions =="
sessions="$(kubectl get mirrordclustersplitsessions -o name 2>/dev/null | grep -E "${FILTER}" || true)"
if [ -z "${sessions}" ]; then
  echo "  (none)"
else
  echo "${sessions}" | sed 's/^/  /'
fi

echo "== preview sessions in ${NS} =="
previews="$(kubectl -n "${NS}" get previewsessions -o name 2>/dev/null || true)"
echo "${previews:-  (none)}" | sed 's/^/  /'

echo "== pg branch databases =="
branches="$(kubectl get branchdatabases -A -o name 2>/dev/null || true)"
echo "${branches:-  (none)}" | sed 's/^/  /'

if [ "${1:-}" = "--list" ]; then
  echo "(--list: nothing deleted)"
  exit 0
fi

echo
echo "== deleting =="
if [ -n "${sessions}" ]; then
  echo "${sessions}" | xargs -r kubectl delete >/dev/null 2>&1 || true
  echo "  split sessions cleared"
fi
if [ -n "${previews}" ]; then
  echo "${previews}" | xargs -r -I{} kubectl -n "${NS}" delete {} >/dev/null 2>&1 || true
  echo "  preview sessions cleared"
fi
if [ -n "${branches}" ]; then
  # branchdatabases are namespaced; delete each (this also removes its pod)
  echo "${branches}" | sed 's#^branchdatabase[^/]*/##' \
    | xargs -r -I{} kubectl -n "${NS}" delete branchdatabase {} >/dev/null 2>&1 || true
  echo "  branch databases cleared"
fi
# stray Failed/terminating branch-db pods
kubectl -n "${NS}" get pods 2>/dev/null | awk '/postgresql-branch-db-pod/ {print $1}' \
  | xargs -r -I{} kubectl -n "${NS}" delete pod {} >/dev/null 2>&1 || true

echo "done."
