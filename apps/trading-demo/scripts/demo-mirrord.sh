#!/usr/bin/env bash
# Demo: mirrord mirror on fix-gateway (requires cluster deploy + mirrord operator)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="$ROOT/apps/trading-demo"

if [[ ! -d "$DEMO/fix-gateway/node_modules" ]]; then
  npm --prefix "$DEMO/fix-gateway" install
fi
if [[ ! -d "$DEMO/fix-client/node_modules" ]]; then
  npm --prefix "$DEMO/fix-client" install
fi

HOST="${FIX_GATEWAY_HOST:-fix-gateway.trading-demo.svc.cluster.local}"
echo "Local fix-gateway under mirrord (mirror TCP :9876, outgoing UDP)..."
echo "In another terminal send FIX to cluster:"
echo "  FIX_GATEWAY_HOST=$HOST npm --prefix apps/trading-demo/fix-client run send"
echo ""

TRADE_FEED_HOST="${TRADE_FEED_HOST:-trade-feed.trading-demo.svc.cluster.local}" \
TRADE_FEED_PORT="${TRADE_FEED_PORT:-9999}" \
  mirrord exec -f "$DEMO/fix-gateway/mirrord.json" -- \
  npm --prefix "$DEMO/fix-gateway" run dev
