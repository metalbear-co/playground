# Two-namespace mirror demo (Michal flow)

**Prospect story:** duplicate FIX ingress into **other namespaces in the cluster** — not to a developer laptop.

| ❌ Don't show | ✅ Show |
|-------------|--------|
| `mirrord exec` on laptop → local gateway | Ephemeral **in gateway B's pod** → **namespace B** processes the copy |
| "Traffic comes to your Mac" | "Same FIX stream hits gateway A **and** gateway B's stack" |

## Architecture

```
Laptop test client
       │
       ▼
Gateway A (trading-a)  ── real FIX, real response
       │
       │  TCP mirror (mirrord agent on A, ephemeral)
       ▼
Ephemeral on gateway B pod (trading-b)
  mirrord port-forward -R 9876:19876
  socat 19876 → 127.0.0.1:9876
       │
       ▼
Gateway B main container (same pod network)
       │
       ▼
trade-feed (trading-b)
```

Scale pattern: gateway C, D, … each get an ephemeral mirror listener on the **same ingress target** (gateway A).

## Prereqs

- Images on cluster: `playground-fix-gateway`, `playground-trade-feed`
- `mirrord` CLI locally (for `kubectl debug` only — not `mirrord exec` on laptop)
- Ephemeral containers enabled on the cluster

## 1. Deploy gateway + backend in two namespaces

```bash
kubectl apply -k manifests/trading-demo/overlays/trading-a
kubectl apply -k manifests/trading-demo/overlays/trading-b
kubectl wait -n trading-a --for=condition=available deployment/fix-gateway --timeout=120s
kubectl wait -n trading-b --for=condition=available deployment/fix-gateway --timeout=120s
```

## 2. Stream logs (whole demo)

```bash
kubectl logs -f -n trading-a -l app=fix-gateway --prefix=true &
kubectl logs -f -n trading-a -l app=trade-feed --prefix=true &
kubectl logs -f -n trading-b -l app=fix-gateway --prefix=true &
kubectl logs -f -n trading-b -l app=trade-feed --prefix=true &
```

## 3. Port-forward gateway A (laptop test client only)

`kubectl port-forward` is just so your laptop can reach the cluster — **not** mirrord.

```bash
kubectl port-forward -n trading-a svc/fix-gateway 9876:9876
```

## 4. Baseline — test client → gateway A

```bash
FIX_GATEWAY_HOST=localhost FIX_GATEWAY_PORT=9876 \
  npm --prefix apps/trading-demo/fix-client run send
```

**Expect:** only `trading-a` logs (`ns=trading-a`). `trading-b` quiet.

## 5. Ephemeral on gateway B — mirror from A, feed B's gateway

```bash
POD_B=$(kubectl get pod -n trading-b -l app=fix-gateway -o jsonpath='{.items[0].metadata.name}')

kubectl debug -n trading-b "$POD_B" \
  -it \
  --image=ghcr.io/metalbear-co/mirrord-cli:latest \
  --target=main \
  --container=mirrord-mirror \
  -- bash -lc '
    cat >/tmp/mirror.json <<EOF
{
  "target": {
    "namespace": "trading-a",
    "path": { "deployment": "fix-gateway" }
  },
  "agent": { "ephemeral": true },
  "feature": {
    "network": {
      "incoming": { "mode": "mirror", "ports": [9876] }
    }
  }
}
EOF
    mirrord port-forward \
      -n trading-a \
      -t deployment/fix-gateway \
      -f /tmp/mirror.json \
      -e \
      -R 9876:19876 &
  sleep 3
  # Relay mirrored FIX into gateway B main (same pod network → 127.0.0.1:9876)
  socat TCP-LISTEN:19876,fork,reuseaddr TCP:127.0.0.1:9876
  '
```

> If `socat` is missing from the image, ask Michal for the image tag that includes it, or use a debug image with `socat` + `mirrord` binary copied in.

## 6. Test client again

Michal wrote **"against gateway B"** — clarify with him which of these he means:

### A) Send to **A** again, watch **B** light up (likely intent)

Same port-forward to A as step 4:

```bash
FIX_GATEWAY_HOST=localhost FIX_GATEWAY_PORT=9876 \
  npm --prefix apps/trading-demo/fix-client run send
```

**Expect:**

| Component | Logs |
|-----------|------|
| Gateway A | `ns=trading-a` — primary path |
| Gateway B | `ns=trading-b` — **mirrored copy** processed |
| trade-feed A + B | both receive UDP |

### B) Send directly to **B** service (literal wording)

```bash
kubectl port-forward -n trading-b svc/fix-gateway 9877:9876
```

```bash
FIX_GATEWAY_HOST=localhost FIX_GATEWAY_PORT=9877 \
  npm --prefix apps/trading-demo/fix-client run send
```

**Expect:** only `trading-b` logs. This proves B's stack works; it does **not** prove mirror-from-A unless combined with step 6A.

**For the prospect:** lead with **6A** — one test send to ingress A, two namespaces exercise their full stacks.

## Talk track

> "Your test harness still sends to one FIX gateway. mirrord mirrors TCP in the cluster — an ephemeral sidecar on namespace B receives the duplicate and feeds B's gateway. A and B both process the same order; B's sequencer path gets UDP without a second test run. Six namespaces = six sidecars on the same mirror target."

## Ask Michal before Thursday

1. Step 6 — **send to A and watch B**, or **client hostname = B**?
2. `mirrord-cli` image — does it include `socat`? Preferred ephemeral attach (`kubectl debug` vs operator)?
3. Six namespaces — six ephemeral sidecars, all targeting gateway A?
