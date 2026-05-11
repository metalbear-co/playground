# order-events-pubsub-consumer

Minimal **Python** pull subscriber for **Google Cloud Pub/Sub**, used with MetalMart **order-service** as the publisher and mirrord **queue splitting** (`queue_type`: `GCPPubSub`).

## Prerequisites

1. GCP **topic** and **pull subscription** (same subscription ID you set in `PUBSUB_SUBSCRIPTION_ID` for this workload).
2. mirrord operator with **`gcpPubsubSplitting: true`** (Helm values).
3. **`MirrordWorkloadQueueRegistry`** — see `manifests/shop/base/app/order-events-pubsub-consumer/workload-queue-registry.yaml`.
4. **order-service** env: `GOOGLE_CLOUD_PROJECT` and `GCP_ORDER_EVENTS_TOPIC` (publisher is skipped if either is unset).
5. Credentials: **Workload Identity** (recommended on GKE) or ADC (`gcloud auth application-default login` locally).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` | yes | GCP project ID |
| `PUBSUB_SUBSCRIPTION_ID` | yes | Subscription **ID** (short name), not full path |
| `PORT` | no | HTTP port (default `80` in Kubernetes manifest) |
| `PUBSUB_EMULATOR_HOST` | no | e.g. `localhost:8085` for emulator |

The mirrord operator overrides `PUBSUB_SUBSCRIPTION_ID` during a split session so the workload reads from a temporary subscription.

## Local run

```bash
cd apps/shop/order-events-pubsub-consumer
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_CLOUD_PROJECT=my-project
export PUBSUB_SUBSCRIPTION_ID=my-sub
export PORT=8080
python main.py
```

## Publish test message (gcloud)

```bash
gcloud pubsub topics publish my-topic --message='{"orderId":1,"event":"order_confirmed"}' \
  --attribute=tenant=demo-local-alice
```

Adjust `--attribute` keys to match `feature.split_queues` / `message_filter` in `mirrord.json`.

## Split queues config

- Registry queue key **`order-pubsub`** must match the key under `feature.split_queues` in `mirrord.json`.
