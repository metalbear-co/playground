# MetalMart – Shop Demo App

Ecommerce demo app showcasing mirrord features: **HTTP Filtering**, **Queue Splitting**, and **DB Branching**.

## Architecture

- **metal-mart-frontend** (Next.js 16) – Product catalogue, cart, checkout, order tracking
- **inventory-service** – Products, stock (PostgreSQL)
- **order-service** – Orders, orchestrates checkout (PostgreSQL, Kafka producer). Whether to use Temporal is controlled only by `USE_TEMPORAL` in `order-service/src/config.ts` (read from env); default is direct checkout. When using Temporal, run `npm run build` before `npm start` so the workflow bundle is pre-built (no webpack at runtime).
- **payment-service** – Mock payment (no external API)
- **delivery-service** – Kafka consumer, creates deliveries

## Mirrord Demo Features

1. **HTTP Filtering** – Order service uses `X-PG-Tenant` header to route traffic (see `order-service/mirrord.json`)
2. **Queue Splitting** – Delivery service filters Kafka messages by `x-pg-tenant` header (see `delivery-service/mirrord.json`)
3. **DB Branching** – Order and Inventory services use isolated PostgreSQL branches (requires `operator.pgBranching=true` in mirrord-operator Helm chart)

## Local Development

### Temporal on Docker Desktop (no compose)

Run these in order. Use namespace `temporal` (default in order-service). Web UI: http://localhost:8080

1. Create network and start Postgres:

```bash
docker network create temporal-network
docker run -d --name temporal-postgresql --network temporal-network \
  -e POSTGRES_PASSWORD=temporal -e POSTGRES_USER=temporal postgres:15
```

2. Wait ~10s, then start Temporal server (port 7233):

```bash
docker run -d --name temporal --network temporal-network -p 7233:7233 \
  -e DB=postgres12 -e DB_PORT=5432 -e POSTGRES_USER=temporal -e POSTGRES_PWD=temporal \
  -e POSTGRES_SEEDS=temporal-postgresql temporalio/auto-setup:1.24.2
```

3. Wait ~15s, then register namespace `temporal`:

```bash
docker run --rm --network temporal-network \
  -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_CLI_ADDRESS=temporal:7233 \
  temporalio/admin-tools:1.24.2 \
  tctl --namespace default namespace register temporal --description "Shop testing"
```

4. (Optional) Start Temporal Web UI on http://localhost:8080:

```bash
docker run -d --name temporal-ui --network temporal-network -p 8080:8080 \
  -e TEMPORAL_ADDRESS=temporal:7233 temporalio/ui:2.22.2
```

5. Run order-service with Temporal (set `USE_TEMPORAL` in env; config is read in `src/config.ts`):

```bash
cd apps/shop/order-service
USE_TEMPORAL=true TEMPORAL_ADDRESS=localhost:7233 npm run dev
```

Stop containers: `docker stop temporal-ui temporal temporal-postgresql`

### Start everything (Temporal + Postgres + Kafka + shop app)

From repo root or `apps/shop`:

```bash
./apps/shop/scripts/start-all.sh
```

Starts: Temporal (7233), Temporal UI (8080), Shop Postgres (5432), Kafka (9092), order-service (3001), inventory-service (3002), payment-service (3003), delivery-service (3004), frontend (3000). Shop: http://localhost:3000

**Start using Dockerfiles (same pattern as inventory-service/Dockerfile):**

```bash
./apps/shop/scripts/start-all-docker.sh
```

Builds each service from its Dockerfile and runs all in Docker (no Node on host). Shop: http://localhost:3000

**Test without Temporal (direct checkout path):** Whether to use Temporal is read only from `USE_TEMPORAL` in `order-service/src/config.ts`. Use either:

- **Scripts:** `SKIP_TEMPORAL=1 ./apps/shop/scripts/start-all.sh` or `start-all-docker.sh` skips starting Temporal infra; scripts do not set `USE_TEMPORAL`, so order-service defaults to direct.
- **Manual:** Run order-service without setting `USE_TEMPORAL`; no Temporal server or worker is needed.

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

## Kubernetes (GKE / Docker Desktop)

Shop services expect **Postgres** and **Kafka** in the `infra` namespace (`postgres.infra.svc.cluster.local`, `kafka.infra.svc.cluster.local`). Deploy infrastructure first:

```bash
kubectl apply -k manifests/infrastructure
```

**Using Temporal in Kubernetes:** Base manifests do not enable Temporal (so GKE and others’ deployments are unchanged). To use Temporal in your cluster you must: (1) add the `temporal` namespace and `temporal` / `temporal_visibility` DBs to Postgres init (e.g. in `manifests/infrastructure/namespaces.yaml` and `postgres/configmap.yaml`), (2) deploy Temporal (see below), and (3) set order-service env: `USE_TEMPORAL=true`, `TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233`, `TEMPORAL_NAMESPACE=temporal` (e.g. via a Kustomize overlay or `kubectl set env`). In the Temporal Web UI use the **temporal** namespace (not default).

**Deploy Temporal in the cluster (step-by-step):**

1. **Add `temporal` namespace and Postgres DBs** (only if not already in your infra). Then apply infrastructure:
   ```bash
   # If you added temporal namespace and postgres DBs to manifests:
   kubectl apply -k manifests/infrastructure
   ```

2. **Create the DB secret in the `temporal` namespace** (same password as your infra Postgres):
   ```bash
   kubectl create secret generic temporal-db-secret -n temporal --from-literal=password=postgres
   ```

3. **Add the Temporal Helm repo and install** into namespace `temporal` using the shop values (uses existing Postgres in `infra`):
   ```bash
   helm repo add temporal https://go.temporal.io/helm-charts
   helm repo update
   helm install temporal temporal/temporal -n temporal \
     -f apps/shop/helm/temporal-values.yaml \
     --version '>=1.0.0-0' \
     --timeout 900s
   ```
   Run from the repo root. See [Temporal Helm charts](https://github.com/temporalio/helm-charts) if you need a different chart version.

4. **Wait until Temporal is ready:**
   ```bash
   kubectl get pods -n temporal -w
   ```
   When `temporal-frontend-*`, `temporal-history-*`, `temporal-matching-*`, and `temporal-worker-*` are Running, the frontend is reachable at `temporal-frontend.temporal.svc.cluster.local:7233`.

5. **Optional — Temporal Web UI:** Port-forward to access the UI (e.g. http://localhost:8080):
   ```bash
   kubectl port-forward svc/temporal-web -n temporal 8080:8080
   ```
   In the UI, switch the namespace dropdown from **default** to **temporal** to see workflows started by order-service.

If Temporal is not deployed, the order-service worker and client will fail to connect (connection refused/timeout) and no workflows will be started. Check order-service logs for connection errors.

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
