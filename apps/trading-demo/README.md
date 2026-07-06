# Trading demo — FIX (TCP) + UDP backend

Standalone demo for the trading prospect. **Does not modify MetalMart shop** — optional link via `ORDER_SERVICE_URL`.

## Services

| Service | Ports | Role |
|---------|-------|------|
| `fix-gateway` | 9876 TCP (FIX), 8080 HTTP | Order entry; publishes UDP to trade-feed |
| `trade-feed` | 9999 UDP | Backend listener (stands in for Aeron path) |
| `fix-client` | — | Sends sample FIX NewOrderSingle |

## Local demo (no Kubernetes)

```bash
chmod +x apps/trading-demo/scripts/start-local.sh
./apps/trading-demo/scripts/start-local.sh
# other terminal:
npm --prefix apps/trading-demo/fix-client run send
```

You should see FIX on fix-gateway and UDP JSON on trade-feed.

## mirrord demo (TCP mirror + outgoing UDP)

**Prereq:** `kubectl apply -k manifests/trading-demo` and images built/pushed (or run trade-feed in cluster, gateway local).

```bash
./apps/trading-demo/scripts/demo-mirrord.sh
# other terminal:
FIX_GATEWAY_HOST=fix-gateway.trading-demo.svc.cluster.local \
  npm --prefix apps/trading-demo/fix-client run send
```

Local gateway logs mirrored FIX; UDP goes to cluster trade-feed via `outgoing.udp` + `dns`.

## Optional shop link (zero shop code changes)

```bash
export ORDER_SERVICE_URL=http://order-service.shop.svc.cluster.local/orders
```

FIX symbol `METAL-1` maps to productId `1` and POSTs to existing order API.

## Kubernetes

```bash
kubectl apply -k manifests/trading-demo
```

Namespace: `trading-demo` only — shop manifests unchanged.

## Thursday talk track

1. **FIX/TCP:** client → cluster gateway; local gateway under mirrord **mirror** sees copy.
2. **UDP:** gateway → trade-feed; proves backend path (Aeron = POC follow-up).
3. **POC next:** same on their FIX gateway in one namespace.
