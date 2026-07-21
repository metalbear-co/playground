# Shop Agents — MetalMart support

Internal support workspace with a router and specialist agents over live shop services.
Does **not** modify `apps/shop/`.

## Agents

| Agent | Role |
|-------|------|
| `router-agent` | Classifies the question and delegates |
| `order-agent` | Order + delivery lookup, then drafts a customer reply (LLM) |
| `catalog-agent` | Product / stock lookup via `inventory-service` |
| `support-frontend` | Support UI at `/shop-agents/support` |

## How to test locally

Needs kube access to the shop namespace (or a local shop stack).

```bash
# Live shop backends
kubectl -n shop port-forward svc/order-service 3001:80
kubectl -n shop port-forward svc/delivery-service 3004:80
kubectl -n shop port-forward svc/inventory-service 3002:80

# order-agent — buggy LLM by default (claims "shipped" while delivery is still processing)
ORDER_SERVICE_URL=http://localhost:3001 \
DELIVERY_SERVICE_URL=http://localhost:3004 \
LLM_MODE=buggy \
PORT=3005 npm --prefix apps/shop-agents/order-agent run dev

# catalog-agent
INVENTORY_SERVICE_URL=http://localhost:3002 \
PORT=3007 npm --prefix apps/shop-agents/catalog-agent run dev

# router
ORDER_AGENT_URL=http://localhost:3005 \
CATALOG_AGENT_URL=http://localhost:3007 \
PORT=3006 npm --prefix apps/shop-agents/router-agent run dev

# UI
ROUTER_AGENT_URL=http://localhost:3006 \
NEXT_BASE_PATH= PORT=3010 \
  npm --prefix apps/shop-agents/support-frontend run dev -- -p 3010
```

Open **http://localhost:3010/support**

### Try these questions

1. `What is the status of order 7?` → router → **Orders** → tools + LLM  
   - Shop data: delivery `processing`  
   - Buggy reply: says the package already shipped → UI shows “Reply doesn’t match shop data”
2. `Is product 2 in stock?` → router → **Catalog** → inventory-service  
3. `What products do you sell?` → catalog list

### “Fixed with mirrord” beat

Restart only order-agent with a corrected prompt mode (stand-in for editing under mirrord):

```bash
LLM_MODE=fixed PORT=3005 \
ORDER_SERVICE_URL=http://localhost:3001 \
DELIVERY_SERVICE_URL=http://localhost:3004 \
  npm --prefix apps/shop-agents/order-agent run dev
```

Ask about order 7 again → reply matches delivery status.

With cluster deploy + mirrord, set the **Session key** in the UI to your mirrord key so only your traffic hits the local `order-agent`.

## mirrord (order-agent)

```bash
export MIRRORD_SESSION="${MIRRORD_SESSION:-${USER:-demo}}"
USER="$MIRRORD_SESSION" LLM_MODE=fixed \
  mirrord exec -f apps/shop-agents/order-agent/mirrord.json -- \
  npm --prefix apps/shop-agents/order-agent run dev
```

## Layout

| Path | Service |
|------|---------|
| `apps/shop-agents/router-agent` | Intent + delegate |
| `apps/shop-agents/order-agent` | Orders + LLM (mirrord target) |
| `apps/shop-agents/catalog-agent` | Catalog / stock |
| `apps/shop-agents/support-frontend` | Support UI |
| `manifests/shop-agents` | K8s (`shop-agents` namespace) |
