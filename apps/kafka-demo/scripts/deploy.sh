#!/usr/bin/env bash
# Build + push the kafka-demo images to a registry and deploy them to the
# kafka-demo namespace. Manual deploy — not managed by ArgoCD.
#
# The images are built for linux/amd64 (GKE nodes) and pushed to GHCR, matching
# how the shop images are delivered. Requires `docker login ghcr.io` first.
#
# Override the registry/platform via env if needed (then also update the image
# refs in manifests/kafka-demo, or use `kustomize edit set image`).
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

REGISTRY="${REGISTRY:-ghcr.io/metalbear-co}"
PLATFORM="${PLATFORM:-linux/amd64}"

echo "==> Target cluster: $(kubectl config current-context)"
echo "==> Building + pushing images to $REGISTRY ($PLATFORM)"
for s in gateway service-a service-b service-c; do
  docker buildx build --platform "$PLATFORM" \
    -f "apps/kafka-demo/$s/Dockerfile" \
    -t "$REGISTRY/playground-kafka-demo-$s:latest" \
    --push .
done

echo "==> Ensuring namespace + DB secret (connection string stays out of git)"
kubectl create namespace kafka-demo --dry-run=client -o yaml | kubectl apply -f -
if ! kubectl -n kafka-demo get secret kafka-demo-db >/dev/null 2>&1; then
  : "${DATABASE_URL:?Set DATABASE_URL to your Postgres connection string, e.g. postgresql://USER:PASSWORD@postgres.infra.svc.cluster.local:5432/postgres}"
  kubectl -n kafka-demo create secret generic kafka-demo-db --from-literal=url="$DATABASE_URL"
fi

echo "==> Applying manifests to the kafka-demo namespace only"
kubectl apply -k manifests/kafka-demo

echo "==> Waiting for rollouts"
for d in gateway service-a service-b service-c; do
  kubectl -n kafka-demo rollout status "deployment/$d" --timeout=120s
done

cat <<'EOF'

==> Done.

Open the button UI:
    kubectl -n kafka-demo port-forward svc/gateway 8080:80
    open http://localhost:8080

Watch the sequence numbers flow through the services:
    kubectl -n kafka-demo logs -l app=service-a -f --tail=20

Tear down (removes only the kafka-demo namespace + its resources):
    kubectl delete -k manifests/kafka-demo
EOF
