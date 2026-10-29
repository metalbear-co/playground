#!/usr/bin/env bash
# Prints mirrord internal-proxy JSON logs as one line per event:
#
#   HH:MM:SS.mmm LEVEL module: message field=value ...
#
# The LayerConfig dump is dropped and long values are cut, so the events that
# matter in a CI log stay readable: the operator session, the layer connecting,
# the steal subscription with its header filter, every stolen HTTP request with
# its headers, and the log messages the agent sends back.
#
# Usage: render-intproxy-log.sh <intproxy log file>...
set -euo pipefail

for f in "$@"; do
  if [ ! -s "$f" ]; then
    echo "(no internal proxy log at $f)"
    continue
  fi
  jq -R -r '
    fromjson? | select(.fields != null)
    | (.fields | del(.config)) as $f
    | [ ((.timestamp // "")[11:23]),
        ((.level // "") | .[0:4]),
        ((.target // "") | sub("^mirrord_"; "") | sub("::proxies"; "")) + ":",
        ($f.message // empty),
        ($f | del(.message) | to_entries[] | "\(.key)=\(.value | tostring | .[0:600])")
      ] | join(" ")
  ' "$f"
done
