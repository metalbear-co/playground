# MetalMart – Shop Demo App

Ecommerce demo app showcasing mirrord features: **HTTP Filtering**, **Queue Splitting**, **DB Branching**, and **Chaos Testing**.

## Architecture

- **metal-mart-frontend** (Next.js 16) – Product catalogue, cart, checkout, order tracking
- **inventory-service** – Products, stock (PostgreSQL)
- **order-service** – Orders, orchestrates checkout (PostgreSQL, Kafka producer). Optionally publishes **GCP Pub/Sub** order events when `GOOGLE_CLOUD_PROJECT` and `GCP_ORDER_EVENTS_TOPIC` are set (see `order-service/src/pubsub.ts`).
- **payment-service** – Mock payment (no external API)
- **delivery-service** – Kafka consumer, creates deliveries
- **order-events-pubsub-consumer** – Optional Python subscriber for order events on GCP Pub/Sub (mirrord queue splitting); see `manifests/shop/base/app/order-events-pubsub-consumer/`

## Mirrord Demo Features
1. **HTTP Filtering** – Order service uses `baggage: mirrord-session=<key>` header to route traffic (see `order-service/mirrord.json`)
2. **Queue Splitting** – Delivery service filters Kafka messages by `baggage` header with `mirrord-session=<key>` (see `delivery-service/mirrord.json`)
3. **DB Branching** – Order and Inventory services use isolated PostgreSQL branches (requires `operator.pgBranching=true` in mirrord-operator Helm chart)
4. **Chaos Testing** – Inject latency or connection errors into `order-service` outgoing TCP (inventory, Postgres, Kafka) via the mirrord UI chaos API. Example rule files live in `.mirrord/chaos/`; see [Chaos Testing below](#chaos-testing-local). Requires mirrord CLI **≥ 3.232.0**. Docs: [Chaos Testing](https://metalbear.com/mirrord/docs/use-cases/chaos-testing).

## Local Development

### Start everything (Postgres + Kafka + RabbitMQ + shop app)

From repo root or `apps/shop`:

```bash
./apps/shop/scripts/start-all.sh
```

Starts: Shop Postgres (5432), Kafka (9092), RabbitMQ (5672), order-service (3001), inventory-service (3002), payment-service (3003), delivery-service (3004), notifications-service (3005), frontend (3000). Shop: http://localhost:3000

**Start using Dockerfiles (same pattern as inventory-service/Dockerfile):**

```bash
./apps/shop/scripts/start-all-docker.sh
```

Builds each service from its Dockerfile and runs all in Docker (no Node on host). Shop: http://localhost:3000

**Fresh start (clean old Docker resources first):**

```bash
./apps/shop/scripts/clean-all.sh
./apps/shop/scripts/start-all.sh
# or
./apps/shop/scripts/start-all-docker.sh
```

### Running services manually

```bash
# Start dependencies (Postgres, Kafka) – e.g. via Docker or kind
# Then run each service with mirrord
cd apps/shop/order-service && mirrord exec npm run dev
cd apps/shop/delivery-service && mirrord exec npm run dev
cd apps/shop/inventory-service && mirrord exec npm run dev
cd apps/shop/metal-mart-frontend && NEXT_BASE_PATH= npm run dev
```

### Chaos Testing (local)

Chaos rules are **per mirrord session** (they never affect other developers or cluster pods). They disrupt outgoing TCP from the process you run with mirrord — e.g. slow inventory calls, slow Postgres, or Kafka timeouts during checkout. Management is just HTTP against the local UI server (same as the [chaos docs](https://metalbear.com/mirrord/docs/use-cases/chaos-testing)).

**Prereqs:** shop deployed in cluster, kubeconfig pointed at it, mirrord CLI **≥ 3.232.0**.

```bash
# 1. Start the UI server (serves the chaos API; leave running)
mirrord ui
# Copy the API token from the output (or: cat ~/.mirrord/token)

# 2. In another terminal, run order-service under mirrord
cd apps/shop/order-service
mirrord exec -f mirrord.json -- npm run dev
# Copy the session ID from the output

# 3. Export once, then POST any rule file from apps/shop/.mirrord/chaos/
export UI_ADDRESS='http://127.0.0.1:59281'
export CHAOS_TOKEN="$(cat ~/.mirrord/token)"
export SESSION_ID='<session-id-from-mirrord-exec>'
export CHAOS_URL="$UI_ADDRESS/api/chaos/rules/$SESSION_ID"

curl --request POST \
  --header 'Content-Type: application/json' \
  --header "x-auth-token: $CHAOS_TOKEN" \
  --data @apps/shop/.mirrord/chaos/latency-inventory.json \
  "$CHAOS_URL"

# List / clear
curl --header "x-auth-token: $CHAOS_TOKEN" "$CHAOS_URL"
curl --request DELETE --header "x-auth-token: $CHAOS_TOKEN" "$CHAOS_URL"
```

Then checkout with `baggage: mirrord-session=<USER>` (same as `"key"` in `mirrord.json`) so HTTP steal routes to your local order-service.

Example rules in `.mirrord/chaos/`:

| File | Effect |
|------|--------|
| `latency-inventory.json` | ~750ms read latency on TCP to `inventory-service` |
| `latency-postgres.json` | latency on `postgres.infra.svc.cluster.local:5432` |
| `timeout-kafka.json` | 50% of connections to Kafka `timed_out` |

Edit those JSON files (or POST a new one) and re-run the `curl` above. Start with `latency-inventory.json` alone if you want the clearest demo signal.

## Kubernetes (GKE / Docker Desktop)

Shop services expect **Postgres** and **Kafka** in the `infra` namespace (`postgres.infra.svc.cluster.local`, `kafka.infra.svc.cluster.local`). Deploy infrastructure first:

```bash
kubectl apply -k manifests/infrastructure
```

Wait until Postgres and Kafka in `infra` are Ready, then (re)deploy shop. Restart failing shop deployments so they reconnect:

```bash
kubectl rollout restart deployment/order-service deployment/delivery-service deployment/inventory-service -n shop
```

**Frontend ImagePullBackOff on Apple Silicon (arm64):** The image `ghcr.io/metalbear-co/playground-metal-mart-frontend:latest` may only have an amd64 manifest. To run on arm64, build and use a local image:

```bash
docker build -t ghcr.io/metalbear-co/playground-metal-mart-frontend:latest apps/shop/metal-mart-frontend
# If using Docker Desktop, the cluster uses the same daemon. Set imagePullPolicy to IfNotPresent (e.g. kubectl edit deployment metal-mart-frontend -n shop) so the node uses your locally built image.
```

Or build and push a multi-arch image so both amd64 and arm64 clusters can pull it.

### Cloudinary (production deploy)

The `Release metal mart frontend` workflow bakes Cloudinary env vars at build time. Add these **repository secrets** in GitHub (Settings → Secrets and variables → Actions):

| Secret | Required | Description |
|--------|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloud name from [Cloudinary console](https://cloudinary.com/console) |

Without `CLOUDINARY_CLOUD_NAME`, the header logo, product images, and mascot will not load.

## URLs

- Shop: `https://playground.metalbear.dev/shop`
