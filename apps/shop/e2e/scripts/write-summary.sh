#!/usr/bin/env bash
# Renders results.json as the GitHub job summary: the browser steps, then one
# row per service on the order path saying where it ran and what proved it.
#
# Usage: write-summary.sh <results.json> <outcome: success|failure> [chaos-rule]
set -euo pipefail

RESULTS="${1:?results.json path}"
OUTCOME="${2:?outcome}"
CHAOS="${3:-none}"
OUT="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ ! -f "$RESULTS" ]; then
  { echo "## E2E-01 guest checkout: ${OUTCOME}"; echo; echo "No results file was produced. See the job log."; } >> "$OUT"
  exit 0
fi

ORDER_ID="$(jq -r '.orderId // "—"' "$RESULTS")"
BADGE="✅ passed"; [ "$OUTCOME" = "success" ] || BADGE="❌ failed"

hop_row() {
  # $1 hop, $2 where, $3 mirrord feature
  local hop="$1" where="$2" feat="$3" ok ev
  ok="$(jq -r --arg h "$hop" '[.hops[]? | select(.hop == $h)] | .[0].ok // "n/a"' "$RESULTS")"
  ev="$(jq -r --arg h "$hop" '[.hops[]? | select(.hop == $h)] | .[0].evidence // ""' "$RESULTS" | cut -c1-120)"
  case "$ok" in
    true)  ok="✅" ;;
    false) ok="❌" ;;
    *)     ok="—"; ev="served by the cluster"; [ "$where" = cluster ] || ev="not reached" ;;
  esac
  printf '| %s | %s | %s | %s | %s |\n' "$hop" "$where" "$feat" "$ok" "${ev//|/\\|}"
}

{
  echo "## E2E-01 guest checkout: ${BADGE}"
  echo
  if [ "$ORDER_ID" = "—" ]; then
    echo "No order was placed. The browser flow ran against the live storefront with this run's session key in the \`baggage\` header and failed before checkout completed."
  else
    echo "Order **${ORDER_ID}** placed on the live storefront with this run's session key in the \`baggage\` header."
  fi
  echo "No cluster was created. The changed services ran on this runner under \`mirrord up\`; everything else stayed in the playground cluster."
  if [ "$CHAOS" != "none" ]; then
    echo
    echo "Chaos rule **${CHAOS}** was applied to the order-service session before the test."
  fi
  echo
  echo "### Browser flow"
  echo
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  jq -r '.steps[] | "| \(.name) | \(if .ok then "✅" else "❌" end) | \(.detail // "") |"' "$RESULTS"
  echo
  echo "### Where each hop ran"
  echo
  echo "| Hop | Ran | mirrord feature | Verified | Evidence |"
  echo "| --- | --- | --- | --- | --- |"
  hop_row "metal-mart-frontend" "cluster" "none"
  hop_row "order-service" "runner" "steal + baggage header filter"
  hop_row "inventory-service" "cluster" "none"
  hop_row "payment-service" "runner" "SQS queue split (JWT filter)"
  hop_row "receipt-service" "cluster" "none"
  hop_row "delivery-service" "runner" "Kafka queue split on baggage"
  echo
  echo "Local service logs and the Playwright report are attached as artifacts."
} >> "$OUT"
