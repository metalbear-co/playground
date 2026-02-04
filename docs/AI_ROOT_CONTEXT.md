# Playground – Full Project Explanation

**Reference this file** (`docs/AI_ROOT_CONTEXT.md`) in new chats or onboarding so the project context is clear without daisy-chaining old transcripts.

---

## What this repo is

**MetalBear Playground** – A monorepo of demo apps and microservices, with Kubernetes manifests and overlays to run them locally (minikube/kind) or on **GKE**. Used to showcase **mirrord** (HTTP filtering, queue splitting, DB branching) and related tooling.

- **Upstream:** `https://github.com/metalbear-co/playground` (remote: `mb`)
- **Live:** https://playground.metalbear.dev (GKE; gateway routes by path)

---

## Directory layout

| Path | Purpose |
|------|--------|
| **`apps/`** | Application source code. One subfolder per "product"; each may have multiple services. |
| **`manifests/`** | Kubernetes base resources and kustomizations. What gets deployed (per env) lives here. |
| **`overlays/`** | Environment-specific patches and wiring (GKE, kind, local, localstack). |
| **`proto/`** | Protobuf definitions (e.g. ipinfo). **`protogen/`** = generated Go. |
| **`.github/workflows/`** | CI: build and push container images on push to `main`. |

---

## Apps (source: `apps/`)

- **`apps/ip-visit/`** – IP visit counter demo: ip-info, ip-info-grpc, ip-visit-counter, ip-visit-frontend, ip-visit-consumer (Kafka), ip-visit-sqs-consumer. Uses Redis, optional SQS/Kafka.
- **`apps/shop/`** – **MetalMart** ecommerce demo: metal-mart-frontend (Next.js), inventory-service, order-service, payment-service, delivery-service. Uses Postgres + Kafka. See `apps/shop/README.md`.
- **`apps/visualization/`** – visualization-frontend + visualization-backend.

Manifests that deploy these live under **`manifests/`** (e.g. `manifests/shop`, `manifests/ip-visit`, `manifests/visualization`).

---

## Overlays (where we deploy *to*)

- **`overlays/gke`** – Production GKE: Argo CD, Gateway API, HTTPRoutes, HealthCheckPolicies, Argo Applications that sync from the repo. Apply with `kubectl apply -k overlays/gke`. See **`overlays/gke/DRY-RUN.md`** for dry-run steps.
- **`overlays/kind`**, **`overlays/local`**, **`overlays/localstack`** – Local/minikube and localstack variants (see root **`README.md`**).

---

## GKE deployment flow

1. **Bootstrap (one-time or when changing platform config):**  
   `kubectl apply -k overlays/gke`  
   This applies Argo CD, the Gateway, namespaces, **Argo Applications** (e.g. shop, ip-visit, visualization), and GKE-specific resources (HTTPRoutes, HealthCheckPolicies, etc.).

2. **App content:**  
   Argo CD syncs from **`metalbear-co/playground`** **`main`** (or configured branch). Each Application points at a path under **`manifests/`** (e.g. `manifests/shop`). So merging to `main` updates what Argo syncs; the overlay only defines *that* the app exists and how it's exposed (routes, health checks).

3. **Shop on GKE:**  
   - Namespace: **`shop`**.  
   - Frontend is exposed at **`https://playground.metalbear.dev/shop`** via the gateway HTTPRoute.  
   - **HealthCheckPolicy** for `metal-mart-frontend` is required so the GKE load balancer marks the backend healthy (otherwise "no healthy upstream"). Defined in **`overlays/gke/shop/healthcheckpolicy.yaml`** and included in **`overlays/gke/shop/kustomization.yaml`**.

---

## Images and rollouts

- **Builds:** GitHub Actions (`.github/workflows/build-*.yaml`) build and push images on **push to `main`**. Images are tagged e.g. `ghcr.io/metalbear-co/playground-metal-mart-frontend:latest` and `:${{ github.sha }}`.
- **Deployments** in manifests typically use **`:latest`** with **`imagePullPolicy: Always`**.
- **Important:** Kubernetes does *not* recreate pods when only the *content* of the image at `:latest` changes; the Deployment spec (same tag) is unchanged, so no rollout. To get a new image after a code push you must either:
  - **Restart the deployment:** e.g. `kubectl rollout restart deployment/metal-mart-frontend -n shop`, or  
  - **Change the image spec** (e.g. use image tag by commit SHA or digest in the manifest and have CI/Argo update it so that a new rollout is triggered).

---

## Git remotes

- **`origin`** – Typically your fork (e.g. `karlod-metalbear/playground`). Push feature branches here and open PRs to upstream.
- **`mb`** – Upstream **metalbear-co/playground**. Merge via PR; Argo on GKE syncs from here (e.g. `targetRevision: HEAD` for `main`).

---

## Quick reference

- **Root README:** general deploy commands, SQS, proto, local/minikube.
- **`overlays/gke/DRY-RUN.md`** – How to dry-run the GKE overlay before applying.
- **`apps/shop/README.md`** – MetalMart architecture, mirrord features, local dev, live URL.

When starting a new chat or onboarding, **reference this file** (`docs/AI_ROOT_CONTEXT.md`) so the full project context is available without re-reading previous transcripts.
