#!/usr/bin/env bash
# Start shop-agents UI + agents locally (no minikube required).
# Optional: shop order/delivery on :3001/:3004 for real order lookups.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AGENTS="${ROOT}/apps/shop-agents"
LOG_DIR="${AGENTS}/.local-logs"
mkdir -p "${LOG_DIR}"

ORDER_AGENT_PORT="${ORDER_AGENT_PORT:-3011}"
ROUTER_PORT="${ROUTER_PORT:-3012}"
UI_PORT="${UI_PORT:-3010}"
ORDER_SERVICE_URL="${ORDER_SERVICE_URL:-http://localhost:3001}"
DELIVERY_SERVICE_URL="${DELIVERY_SERVICE_URL:-http://localhost:3004}"

for dir in router-agent order-agent support-frontend; do
  if [ ! -d "${AGENTS}/${dir}/node_modules" ]; then
    echo "Installing ${dir}..."
    npm --prefix "${AGENTS}/${dir}" install
  fi
done

stop_pid() {
  local f="$1"
  if [ -f "$f" ]; then
    kill "$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  fi
}

stop_pid "${LOG_DIR}/order-agent.pid"
stop_pid "${LOG_DIR}/router-agent.pid"
stop_pid "${LOG_DIR}/support-frontend.pid"

echo "Starting order-agent on :${ORDER_AGENT_PORT}..."
nohup env ORDER_SERVICE_URL="${ORDER_SERVICE_URL}" \
  DELIVERY_SERVICE_URL="${DELIVERY_SERVICE_URL}" \
  PORT="${ORDER_AGENT_PORT}" \
  npm --prefix "${AGENTS}/order-agent" run dev >"${LOG_DIR}/order-agent.log" 2>&1 &
echo $! >"${LOG_DIR}/order-agent.pid"
disown

echo "Starting router-agent on :${ROUTER_PORT}..."
nohup env ORDER_AGENT_URL="http://localhost:${ORDER_AGENT_PORT}" \
  PORT="${ROUTER_PORT}" \
  npm --prefix "${AGENTS}/router-agent" run dev >"${LOG_DIR}/router-agent.log" 2>&1 &
echo $! >"${LOG_DIR}/router-agent.pid"
disown

echo "Starting support UI on :${UI_PORT}..."
nohup env ROUTER_AGENT_URL="http://localhost:${ROUTER_PORT}" \
  PORT="${UI_PORT}" \
  npm --prefix "${AGENTS}/support-frontend" run dev >"${LOG_DIR}/support-frontend.log" 2>&1 &
echo $! >"${LOG_DIR}/support-frontend.pid"
disown

sleep 3

if curl -sf "${ORDER_SERVICE_URL}/health" >/dev/null 2>&1; then
  echo "Shop order-service detected at ${ORDER_SERVICE_URL}"
else
  echo "Note: order-service not on ${ORDER_SERVICE_URL} — UI works, order queries need shop stack."
  echo "  Run: ${ROOT}/apps/shop/scripts/start-all.sh"
fi

echo ""
echo "Support UI:  http://127.0.0.1:${UI_PORT}/support"
echo "             (local dev — NOT /shop-agents/support; that path is GKE only)"
echo "Logs:        ${LOG_DIR}/"
echo "Stop:        ${AGENTS}/scripts/stop-local.sh"
