#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="$ROOT/apps/trading-demo"

for svc in trade-feed fix-gateway fix-client; do
  if [[ ! -d "$DEMO/$svc/node_modules" ]]; then
    echo "Installing $svc..."
    npm --prefix "$DEMO/$svc" install
  fi
done

echo "Starting trade-feed (UDP :9999) and fix-gateway (FIX TCP :9876)..."
TRADE_FEED_HOST=localhost TRADE_FEED_PORT=9999 \
  npm --prefix "$DEMO/trade-feed" run dev &
PID_FEED=$!

sleep 1
TRADE_FEED_HOST=localhost TRADE_FEED_PORT=9999 \
  npm --prefix "$DEMO/fix-gateway" run dev &
PID_GW=$!

cleanup() {
  kill "$PID_FEED" "$PID_GW" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2
echo ""
echo "Send a FIX order:"
echo "  npm --prefix apps/trading-demo/fix-client run send"
echo ""
echo "Press Ctrl+C to stop."
wait
