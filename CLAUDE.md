# CLAUDE.md

Context for Claude Code when working with the mirrord playground repository.

## Overview

The playground is a monorepo of microservices demo apps deployed on GKE at `https://playground.metalbear.dev/`. It showcases mirrord features (HTTP filtering, queue splitting, database branching) with real services.

**Deployment:** ArgoCD (GitOps) on GKE. Images pushed to `ghcr.io/metalbear-co/playground-<service>`.

## Directory Structure

```
playground/
├── apps/                        # Microservices source code
│   ├── ip-visit/               # IP tracking demo (Go services)
│   ├── shop/                   # E-commerce demo (Node.js/Next.js)
│   ├── visualization/          # Cluster state visualization
│   └── visualization-shop/     # Shop services visualization
├── manifests/                  # Kustomize bases for all apps
│   ├── infrastructure/         # Shared infra (Postgres, Kafka, Redis)
│   ├── ip-visit/
│   ├── shop/
│   ├── temporal/
│   └── visualization*/
├── overlays/                   # Environment-specific overlays
│   ├── gke/                   # Production GKE (ArgoCD apps, Gateway)
│   ├── local/                 # Local dev (NodePort patches)
│   ├── kind/                  # kind cluster
│   └── localstack/            # LocalStack for SQS testing
├── proto/                     # Protobuf definitions (gRPC)
└── protogen/                  # Generated protobuf code
```

## Tech Stack

**Go services** (ip-visit apps):
- Go 1.23/1.24, Gin framework
- Kafka (kafka-go), Redis, gRPC
- AWS SQS (aws-sdk-go-v2) for queue splitting demo

**Node.js services** (shop apps):
- Node.js 20, Express, TypeScript
- Next.js 16 (metal-mart-frontend)
- Kafka (kafkajs), PostgreSQL
- Temporal (optional workflow orchestration for order-service)

**Infrastructure:**
- PostgreSQL 15, Kafka 3.x, Redis
- Kustomize for manifest management
- ArgoCD for GitOps deployment
- GKE Gateway API for routing

## Apps

### IP Visit (`apps/ip-visit/`)
Demo for queue splitting and database branching.
- **ip-visit-counter** (Go): HTTP service counting unique IP visits, stores in Redis
- **ip-info** (Go): gRPC server for IP geolocation
- **ip-visit-consumer** (Go): Kafka consumer
- **ip-visit-sqs-consumer** (Go): AWS SQS consumer
- **ip-visit-frontend** (React): UI for visit counter

### Shop (`apps/shop/`)
Full e-commerce demo for HTTP filtering and queue splitting.
- **metal-mart-frontend** (Next.js): Product catalog, cart, checkout. Route: `/shop`
- **order-service** (Express + Temporal): Checkout orchestration, Kafka producer
- **inventory-service** (Express): Products and stock management
- **payment-service** (Express): Mock payment processor
- **delivery-service** (Express): Kafka consumer for order events

### Visualization (`apps/visualization/`, `apps/visualization-shop/`)
React Flow visualization of cluster state. Backend polls K8s API for deployment status.

## Key Conventions

- **Multi-tenant:** All services support `X-PG-Tenant` header for traffic isolation
- **mirrord configs:** Per-service `.mirrord/mirrord.json` files with HTTP filtering on `X-PG-Tenant`
- **Docker images:** Multi-stage builds, multi-arch (amd64 + arm64), pushed to GHCR
- **Image pull policy:** `Always` in manifests (switch to `IfNotPresent` for local dev)
- **Base paths:** Frontend services use env vars for URL prefix (`NEXT_BASE_PATH=/shop`)

## Local Development

```bash
# Shop services (requires Docker for infra)
cd apps/shop
./scripts/start-all.sh          # Start Temporal, Postgres, Kafka, all services

# Individual service with mirrord
cd apps/shop/order-service
mirrord exec npm run dev

# Deploy to local cluster
kubectl apply -k overlays/local
```

## GKE Deployment

- **Gateway:** Kubernetes Gateway API at `playground.metalbear.dev` (HTTPS, GCP-managed cert)
- **Routes:** HTTPRoute per app (`/ip-visit`, `/shop`, `/visualization`, `/visualization-shop`)
- **ArgoCD:** Auto-sync with prune and self-heal from this repo's `manifests/` directory
- **CI:** GitHub Actions builds and pushes images on merge to main. metal-mart-frontend also auto-updates its deployment.yaml.

## CI/CD

- **Per-service build workflows** (15 total): Build and push multi-arch Docker images on push to main
- **metal-mart-frontend deploy:** Additional step that commits updated image tag to manifests
- **CI demo workflow:** Compares baseline (kind cluster from scratch) vs mirrord CI (GKE with mirrord session)

## Environment Variables

Common across shop services:
- `PORT`, `DATABASE_URL`, `KAFKA_ADDRESS`, `KAFKA_TOPIC`
- `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `USE_TEMPORAL` (order-service)
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_BASE_PATH` (metal-mart-frontend)
- `CLUSTER_NAME`, `WATCH_NAMESPACE`, `WATCH_INTERVAL_MS` (visualization-backend)
