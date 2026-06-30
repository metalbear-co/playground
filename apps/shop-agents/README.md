# Shop Agents — MetalMart support demo

Internal support console with A2A agent delegation over existing shop services.
Does **not** modify `apps/shop/` — agents read `order-service` and `delivery-service` in the `shop` namespace.

## Demo flow

1. Place an order at https://playground.metalbear.dev/shop
2. Open https://playground.metalbear.dev/shop-agents/support
3. Ask: `What is the status of order 7?`
4. Trace shows: `router-agent → order-agent → order-service + delivery-service`

## mirrord (order-agent)

```bash
export MIRRORD_SESSION="${MIRRORD_SESSION:-${USER:-demo}}"
USER="$MIRRORD_SESSION" \
  mirrord exec -f apps/shop-agents/order-agent/mirrord.json -- \
  npm --prefix apps/shop-agents/order-agent run dev
```

Re-run the same query with **mirrord session** set in the UI. Traffic with `baggage: mirrord-session=<session>` hits your local order-agent.

## Local dev

Requires shop order + delivery services reachable (cluster DNS or local shop stack).

```bash
# Terminal 1 — order agent (port 3005)
ORDER_SERVICE_URL=http://localhost:3001 \
DELIVERY_SERVICE_URL=http://localhost:3004 \
PORT=3005 npm --prefix apps/shop-agents/order-agent run dev

# Terminal 2 — router (port 3006)
ORDER_AGENT_URL=http://localhost:3005 \
PORT=3006 npm --prefix apps/shop-agents/router-agent run dev

# Terminal 3 — support UI (port 3010)
ROUTER_AGENT_URL=http://localhost:3006 \
NEXT_BASE_PATH= npm --prefix apps/shop-agents/support-frontend run dev
```

Open http://localhost:3010/support

## Layout

| Path | Service |
|------|---------|
| `apps/shop-agents/router-agent` | Routes to specialists (A2A delegate) |
| `apps/shop-agents/order-agent` | Order + delivery lookup (mirrord target) |
| `apps/shop-agents/support-frontend` | `/shop-agents/support` UI |
| `manifests/shop-agents` | K8s manifests (`shop-agents` namespace) |

## A2A endpoints

Each agent exposes:

- `GET /.well-known/agent.json` — agent card
- `POST /v1/message:send` — handle message (forwards `baggage` for mirrord sessions)
