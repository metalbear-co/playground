#!/bin/sh
# Keep-alive hot reload for the manual path: run the backend, watch the source file, and on change
# restart ONLY the app — the mirrord session and its steal persist (no session-lock conflict).
# Usage:  sh reload.sh <watchFile> <appCmd...>
#   e.g.  mirrord exec -f mirrord.json -- sh reload.sh server.py python3 server.py
set -m
watch="$1"; shift
mtime() { stat -f %m "$watch" 2>/dev/null || stat -c %Y "$watch" 2>/dev/null; }
start() { "$@" & app=$!; }
stop()  { kill -- -"$app" 2>/dev/null; wait "$app" 2>/dev/null; }
trap 'stop; exit 0' TERM INT
start "$@"
prev=$(mtime)
while true; do
  sleep 1
  cur=$(mtime)
  [ "$cur" = "$prev" ] && continue
  prev=$cur
  echo "↻ reloading backend…"
  stop
  start "$@"
done
