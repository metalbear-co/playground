#!/usr/bin/env bash
# Proves which hops of the order ran on this runner rather than in the cluster.
#
# `mirrord up` prints every child session's output on its own stdout, each line
# prefixed with the service name ("order-service: ..."). The workflow captures
# that stream in $MIRRORD_UP_LOG, so each hop is checked only against the lines
# of its own service; all three services log the order id.
#
# Usage: assert-local-logs.sh <results.json>
# Appends a "hops" array to the results file and exits non-zero if any hop is missing.
set -euo pipefail

RESULTS="${1:?results.json path}"
LOG="${MIRRORD_UP_LOG:-/tmp/mirrord/up.log}"
ORDER_ID="$(jq -r '.orderId // empty' "$RESULTS")"

if [ -z "$ORDER_ID" ]; then
  echo "No order id in $RESULTS; the browser flow did not place an order."
  jq '.hops = []' "$RESULTS" > "$RESULTS.tmp" && mv "$RESULTS.tmp" "$RESULTS"
  exit 1
fi

# $1 hop (also the line prefix), $2 fixed string to find in that hop's lines,
# $3 optional label used as evidence instead of the matched line (for
# multi-line JSON logs).
check() {
  local hop="$1" pattern="$2" label="${3:-}" evidence
  evidence="$(grep -F -- "$pattern" "$LOG" 2>/dev/null | grep -F -- "${hop}: " | head -n1 | sed "s/^${hop}: //" || true)"
  if [ -n "$evidence" ]; then
    [ -z "$label" ] || evidence="$label"
    echo "✓ $hop ran on the runner: $evidence"
    jq --arg h "$hop" --arg e "$evidence" '.hops += [{hop:$h, ok:true, evidence:$e}]' "$RESULTS" > "$RESULTS.tmp"
  else
    echo "✗ $hop: no local log line matching '$pattern'"
    jq --arg h "$hop" --arg p "$pattern" '.hops += [{hop:$h, ok:false, evidence:("no log line matching " + $p)}]' "$RESULTS" > "$RESULTS.tmp"
  fi
  mv "$RESULTS.tmp" "$RESULTS"
}

jq '.hops = []' "$RESULTS" > "$RESULTS.tmp" && mv "$RESULTS.tmp" "$RESULTS"

check "order-service"    "JWT created for order ${ORDER_ID} " "order ${ORDER_ID} created by the local order-service, payment JWT signed with the session baggage"
# payment-service logs the SQS body as pretty JSON, one field per line.
check "payment-service"  "\"orderId\": ${ORDER_ID}," "SQS payment message for order ${ORDER_ID} consumed by the local payment-service"
check "delivery-service" "Created delivery for order ${ORDER_ID}"

# A receipt proves payment-service reached receipt-service in the cluster.
if grep -F -- "[Payment] Receipt generated" "$LOG" 2>/dev/null | grep -qF -- "payment-service: "; then
  echo "✓ receipt-service (cluster) returned a receipt to the local payment-service"
  jq '.hops += [{hop:"receipt-service", ok:true, evidence:"receipt returned to local payment-service"}]' "$RESULTS" > "$RESULTS.tmp" && mv "$RESULTS.tmp" "$RESULTS"
fi

if jq -e '[.hops[] | select(.ok == false)] | length == 0' "$RESULTS" >/dev/null; then
  echo "All hops ran where expected."
else
  echo "Some hops did not run on the runner. Last lines of the mirrord up log:"
  tail -n 120 "$LOG" || true
  exit 1
fi
