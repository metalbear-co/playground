# ip-visit-gcp-pubsub-consumer

Minimal **Python** subscriber for **Google Cloud Pub/Sub**, wired like `ip-visit-sqs-consumer` for mirrord **queue splitting** (`queue_type`: `GCPPubSub`).

## Prerequisites

1. GCP **topic** and **pull subscription**.
2. mirrord operator with **`gcpPubsubSplitting: true`** (Helm values).
3. **`MirrordWorkloadQueueRegistry`** in-cluster (see `manifests/ip-visit/base/app/consumer-gcp-pubsub/workload-queue-registry.yaml`).
4. Credentials: **Workload Identity** (recommended on GKE) or ADC (`gcloud auth application-default login` locally).

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
cd apps/ip-visit/ip-visit-gcp-pubsub-consumer
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_CLOUD_PROJECT=my-project
export PUBSUB_SUBSCRIPTION_ID=my-sub
export PORT=8080
python main.py
```

## Publish test message (gcloud)

```bash
gcloud pubsub topics publish my-topic --message='{"ip":"203.0.113.1"}' \
  --attribute=tenant=demo-local-alice
```

Adjust `--attribute` keys to match your `feature.split_queues` / `message_filter` in `mirrord.json`.

## Split queues config

- Registry queue key **`ip-pubsub`** must match the key under `feature.split_queues` in `mirrord.json`.
- Optional: use **`jq_filter`** in mirrord config for Pub/Sub (see mirrord schema / docs) instead of or in addition to attribute filters.
