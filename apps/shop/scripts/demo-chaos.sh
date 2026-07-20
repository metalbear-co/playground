#!/usr/bin/env bash
# Apply / list / clear mirrord chaos rules for a MetalMart order-service session.
#
# Prereqs: mirrord CLI >= 3.232.0, `mirrord ui` running, a live mirrord session.
# Docs: https://metalbear.com/mirrord/docs/use-cases/chaos-testing
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CHAOS_DIR="${CHAOS_DIR:-$ROOT/apps/shop/.mirrord/chaos}"
UI_ADDRESS="${UI_ADDRESS:-http://127.0.0.1:59281}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.mirrord/token}"
TARGET_FILTER="${TARGET_FILTER:-deployment/order-service}"

usage() {
  cat <<'EOF'
Usage: demo-chaos.sh <apply|list|clear|wait-session> [session_id]

  apply [session_id]   POST every *.json rule in apps/shop/.mirrord/chaos/
  list  [session_id]   GET active rules for the session
  clear [session_id]   DELETE all rules for the session
  wait-session         Poll GET /api/sessions until a matching session appears

Env:
  UI_ADDRESS      default http://127.0.0.1:59281
  CHAOS_TOKEN     optional; otherwise read from ~/.mirrord/token
  SESSION_ID      optional; otherwise passed as arg or auto-detected
  TARGET_FILTER   substring match on session target (default deployment/order-service)
  CHAOS_DIR       rule directory (default apps/shop/.mirrord/chaos)
EOF
}

require_token() {
  if [[ -n "${CHAOS_TOKEN:-}" ]]; then
    return
  fi
  if [[ ! -f "$TOKEN_FILE" ]]; then
    echo "error: no CHAOS_TOKEN and token file missing: $TOKEN_FILE" >&2
    echo "Start the UI server first: mirrord ui" >&2
    exit 1
  fi
  CHAOS_TOKEN="$(cat "$TOKEN_FILE")"
}

chaos_url() {
  local session_id="$1"
  echo "$UI_ADDRESS/api/chaos/rules/$session_id"
}

auth_header() {
  echo "x-auth-token: $CHAOS_TOKEN"
}

resolve_session_id() {
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return
  fi
  if [[ -n "${SESSION_ID:-}" ]]; then
    echo "$SESSION_ID"
    return
  fi
  require_token
  local sessions
  sessions="$(curl -fsS --header "$(auth_header)" "$UI_ADDRESS/api/sessions")"
  local id
  id="$(echo "$sessions" | jq -r --arg t "$TARGET_FILTER" '
    [.[] | select((.target // "") | contains($t)) | .session_id] | first // empty
  ')"
  if [[ -z "$id" || "$id" == "null" ]]; then
    echo "error: no session matching target '$TARGET_FILTER'" >&2
    echo "Start one first, e.g.:" >&2
    echo "  cd apps/shop/order-service && mirrord exec -f mirrord.json -- npm run dev" >&2
    echo "Or pass SESSION_ID / session id arg. Active sessions:" >&2
    echo "$sessions" | jq -r '.[] | "  \(.session_id)  target=\(.target // "?")"' >&2 || echo "$sessions" >&2
    exit 1
  fi
  echo "$id"
}

cmd_wait_session() {
  require_token
  echo "Waiting for a session matching '$TARGET_FILTER'..."
  local i id
  for i in $(seq 1 30); do
    id="$(curl -fsS --header "$(auth_header)" "$UI_ADDRESS/api/sessions" | jq -r --arg t "$TARGET_FILTER" '
      [.[] | select((.target // "") | contains($t)) | .session_id] | first // empty
    ')" || true
    if [[ -n "$id" && "$id" != "null" ]]; then
      echo "$id"
      return
    fi
    sleep 1
  done
  echo "error: timed out waiting for session" >&2
  exit 1
}

cmd_apply() {
  require_token
  local session_id
  session_id="$(resolve_session_id "${1:-}")"
  local url
  url="$(chaos_url "$session_id")"
  echo "Applying chaos rules to session $session_id"
  echo "  API: $url"
  shopt -s nullglob
  local rules=("$CHAOS_DIR"/*.json)
  if [[ ${#rules[@]} -eq 0 ]]; then
    echo "error: no rule files in $CHAOS_DIR" >&2
    exit 1
  fi
  local rule
  for rule in "${rules[@]}"; do
    echo "  POST $(basename "$rule")"
    curl -fsS --request POST \
      --header 'Content-Type: application/json' \
      --header "$(auth_header)" \
      --data @"$rule" \
      "$url" | jq .
  done
  echo "Done. Checkout with baggage: mirrord-session=<your key> to exercise rules."
  echo "Clear with: $0 clear $session_id"
}

cmd_list() {
  require_token
  local session_id
  session_id="$(resolve_session_id "${1:-}")"
  curl -fsS --header "$(auth_header)" "$(chaos_url "$session_id")" | jq .
}

cmd_clear() {
  require_token
  local session_id
  session_id="$(resolve_session_id "${1:-}")"
  echo "Clearing all chaos rules for session $session_id"
  curl -fsS --request DELETE \
    --header "$(auth_header)" \
    "$(chaos_url "$session_id")"
  echo "Cleared."
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    apply) cmd_apply "${1:-}" ;;
    list) cmd_list "${1:-}" ;;
    clear) cmd_clear "${1:-}" ;;
    wait-session) cmd_wait_session ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 1 ;;
    *) echo "error: unknown command: $cmd" >&2; usage; exit 1 ;;
  esac
}

main "$@"
