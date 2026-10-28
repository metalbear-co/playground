# MetalMart end-to-end scenarios (mirrord up in CI)

Playwright scenarios that run against the **live playground cluster**. Nothing is deployed and no cluster is created: the services under test run on the CI runner under one `mirrord up` session, and the browser drives the real storefront with a per-run session key in the `baggage` header, so only this run's traffic reaches the local processes.

| Scenario | Spec | Services under `mirrord up` | Stays in the cluster |
|---|---|---|---|
| E2E-01 Guest checkout, single product | `tests/guest-checkout.spec.ts` | order-service (steal + header filter), payment-service (SQS queue split), delivery-service (Kafka queue split) | frontend, inventory-service, receipt-service, Postgres, Kafka, SQS, RabbitMQ |

## How it runs

Workflow: [`.github/workflows/shop-e2e-mirrord.yml`](../../../.github/workflows/shop-e2e-mirrord.yml) (`workflow_dispatch`).

1. Build order, payment and delivery (`npm ci && npm run build`).
2. `mirrord up -f .mirrord/ci/mirrord-up.yaml --key e2e-<run_id>` ([config](../../../.mirrord/ci/mirrord-up.yaml)): one run starts the three services, each as a split-mode session with the header filter and the SQS/Kafka queue split keyed to the run. `MIRRORD_CI_API_KEY` is set, so every child session registers as a CI session, not a user seat.
3. `npx playwright test` with `E2E_SESSION_KEY=e2e-<run_id>`: home, product, cart, checkout, order tracking until the delivery row appears.
4. `scripts/assert-local-logs.sh` proves each hop ran on the runner by finding the order id in the `mirrord up` log (`/tmp/mirrord/up.log`), where every line is prefixed with its service name.
5. `scripts/write-summary.sh` renders the job summary: browser steps, then one row per hop with where it ran and the evidence.
6. Stop `mirrord up` (its process group), upload the log and the Playwright report, and report the outcome to the dashboard.

Inputs: `chaos` applies a rule from `.mirrord/chaos/` to the order-service session before the test (a real failure demo); `compare` also dispatches the kind baseline workflow for a timing comparison.

## Triggering from the dashboard

`/shop/cloud-agents` row **E2E-01** has *Run* and *Run with chaos*. They call `POST /api/e2e/run`, which dispatches the workflow. The workflow reports its run URL and outcome to `/api/cloud-agents/callback` under ticket `E2E-01`, and the row polls that ticket.

## Secrets and config

GitHub repository secrets used by the workflow: `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `MIRRORD_CI_API_KEY` (all already used by the preview workflows) and `CLOUD_AGENTS_CALLBACK_TOKEN` (same value as the frontend's `cloud-agents` secret).

Frontend (`cloud-agents` Kubernetes secret, namespace `shop`): `GITHUB_E2E_DISPATCH_TOKEN`, a fine-grained GitHub token with **Actions: write** on `metalbear-co/playground`. Without it, `POST /api/e2e/run` returns 503 and the row says so.

## Running the spec locally

```bash
# build the three services first (npm ci && npm run build in each), then from the repo root:
mirrord up -f .mirrord/ci/mirrord-up.yaml --key e2e-local-1 > /tmp/mirrord/up.log 2>&1 &
cd apps/shop/e2e && npm ci && npx playwright install chromium
E2E_SESSION_KEY=e2e-local-1 npx playwright test
MIRRORD_UP_LOG=/tmp/mirrord/up.log ./scripts/assert-local-logs.sh /tmp/e2e/results.json
```

Pass the key with `--key`; `MIRRORD_KEY` alone was not picked up by mirrord 3.258.0. Without local sessions the browser flow still passes against the cluster, but `assert-local-logs.sh` has no local log to check.
