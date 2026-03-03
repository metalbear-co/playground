#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

PROFILE="${MINIKUBE_PROFILE:-minikube}"
START_MINIKUBE="${START_MINIKUBE:-1}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-300s}"
AUTO_INSTALL_OPERATOR="${AUTO_INSTALL_OPERATOR:-1}"
MIRRORD_LICENSE_KEY="${MIRRORD_LICENSE_KEY:-}"

log() {
  printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd kubectl
require_cmd minikube
require_cmd helm

has_queue_splitting_crds() {
  kubectl get crd mirrordkafkaclientconfigs.queues.mirrord.metalbear.co >/dev/null 2>&1 \
    && kubectl get crd mirrordkafkatopicsconsumers.queues.mirrord.metalbear.co >/dev/null 2>&1
}

if [[ "${START_MINIKUBE}" == "1" ]]; then
  log "Starting minikube profile '${PROFILE}'"
  minikube start -p "${PROFILE}"
fi

log "Switching kubectl context to '${PROFILE}'"
kubectl config use-context "${PROFILE}" >/dev/null

log "Ensuring mirrord namespace exists"
kubectl create namespace mirrord --dry-run=client -o yaml | kubectl apply -f - >/dev/null

if ! has_queue_splitting_crds; then
  if [[ "${AUTO_INSTALL_OPERATOR}" == "1" ]]; then
    if [[ -z "${MIRRORD_LICENSE_KEY}" ]]; then
      cat <<'EOF'
ERROR:
  Mirrord queue-splitting CRDs are missing, and MIRRORD_LICENSE_KEY was not provided.
  This chart version requires a license key.

To continue, run:
  export MIRRORD_LICENSE_KEY='<your-license-key>'
  ./apps/shop/scripts/setup-minikube-mirrord-kafka-demo.sh
EOF
      exit 1
    fi

    log "Installing/upgrading mirrord operator with kafka splitting"
    helm repo add metalbear https://metalbear-co.github.io/charts >/dev/null 2>&1 || true
    helm repo update >/dev/null
    helm upgrade --install mirrord-operator metalbear/mirrord-operator \
      --namespace mirrord --create-namespace \
      --set license.key="${MIRRORD_LICENSE_KEY}" \
      --set kafkaSplitting=true >/dev/null
    kubectl -n mirrord rollout status deployment/mirrord-operator --timeout="${WAIT_TIMEOUT}"
  fi
fi

if ! has_queue_splitting_crds; then
  cat <<'EOF'
ERROR:
  Mirrord queue-splitting CRDs are still unavailable.
  Install/repair mirrord-operator first, then rerun this script.
EOF
  exit 1
fi

log "Applying infrastructure manifests"
kubectl apply -k "${REPO_ROOT}/manifests/infrastructure"

log "Applying shop manifests"
kubectl apply -k "${REPO_ROOT}/manifests/shop"

log "Applying shop mirrord kafka config"
kubectl apply -k "${REPO_ROOT}/manifests/shop-mirrord"

log "Waiting for infrastructure"
kubectl -n infra rollout status statefulset/postgres --timeout="${WAIT_TIMEOUT}"
kubectl -n infra rollout status statefulset/kafka --timeout="${WAIT_TIMEOUT}"
kubectl -n infra rollout status deployment/redis-main --timeout="${WAIT_TIMEOUT}"

log "Waiting for shop services"
kubectl -n shop rollout status deployment/inventory-service --timeout="${WAIT_TIMEOUT}"
kubectl -n shop rollout status deployment/payment-service --timeout="${WAIT_TIMEOUT}"
kubectl -n shop rollout status deployment/order-service --timeout="${WAIT_TIMEOUT}"
kubectl -n shop rollout status deployment/delivery-service --timeout="${WAIT_TIMEOUT}"
kubectl -n shop rollout status deployment/metal-mart-frontend --timeout="${WAIT_TIMEOUT}"

log "Checking queue splitting CRDs"
if has_queue_splitting_crds; then
  echo "Queue splitting CRDs found."
else
  cat <<'EOF'
WARNING: mirrord queue splitting CRDs were not found.
Install mirrord operator with queue splitting support before demoing split_queues.
EOF
fi

cat <<'EOF'

Setup complete.

Next:
  1) cd apps/shop/delivery-service
     mirrord exec -f mirrord.json -- npm run dev

  2) kubectl port-forward -n shop svc/order-service 3001:80

  3) Trigger tenant-tagged orders:
     curl -X POST http://localhost:3001/orders -H "Content-Type: application/json" -H "X-PG-Tenant: dev" -d '{"items":[{"productId":1,"quantity":1}],"total_cents":1000}'
     curl -X POST http://localhost:3001/orders -H "Content-Type: application/json" -H "X-PG-Tenant: prod" -d '{"items":[{"productId":1,"quantity":1}],"total_cents":1000}'
EOF
