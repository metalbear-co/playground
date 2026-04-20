#!/usr/bin/env bash
# Build all shop app images into the minikube Docker daemon (native arm64/amd64),
# patch deployments to use IfNotPresent, and restart so the cluster uses local images.
#
# Run from repo root after: kubectl apply -k manifests/shop
#   bash apps/shop/scripts/minikube-build-shop-images.sh
#
# Optional: NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME or CLOUDINARY_CLOUD_NAME for the Next.js build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SHOP_DIR="${REPO_ROOT}/apps/shop"
cd "${REPO_ROOT}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: '$1' not found in PATH" >&2
    exit 1
  }
}

need_cmd minikube
need_cmd kubectl
need_cmd docker

if [[ "${DOCKER_DEFAULT_PLATFORM:-}" == "linux/amd64" ]]; then
  echo "warning: DOCKER_DEFAULT_PLATFORM=linux/amd64 unset for this script (minikube shop builds)." >&2
  unset DOCKER_DEFAULT_PLATFORM
fi

if ! minikube status >/dev/null 2>&1; then
  echo "error: minikube cluster is not running (try: minikube start)" >&2
  exit 1
fi

echo "using minikube Docker daemon for builds…"
eval "$(minikube docker-env)"

CLOUD_NAME="${NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:-${CLOUDINARY_CLOUD_NAME:-}}"

METAL_IMG="$(
  awk '/image: ghcr\.io\/metalbear-co\/playground-metal-mart-frontend/ { print $2; exit }' \
    "${REPO_ROOT}/manifests/shop/base/app/metal-mart-frontend/deployment.yaml"
)"
if [[ -z "${METAL_IMG}" ]]; then
  echo "error: could not read metal-mart-frontend image from manifests" >&2
  exit 1
fi

echo "building inventory-service → ghcr.io/metalbear-co/playground-inventory-service:latest"
docker build -t ghcr.io/metalbear-co/playground-inventory-service:latest \
  -f "${SHOP_DIR}/inventory-service/Dockerfile" "${SHOP_DIR}/inventory-service"

echo "building payment-service → ghcr.io/metalbear-co/playground-payment-service:latest"
docker build -t ghcr.io/metalbear-co/playground-payment-service:latest \
  -f "${SHOP_DIR}/payment-service/Dockerfile" "${SHOP_DIR}/payment-service"

echo "building delivery-service → ghcr.io/metalbear-co/playground-delivery-service:latest"
docker build -t ghcr.io/metalbear-co/playground-delivery-service:latest \
  -f "${SHOP_DIR}/delivery-service/Dockerfile" "${SHOP_DIR}/delivery-service"

echo "building order-service → ghcr.io/metalbear-co/playground-order-service:latest"
docker build -t ghcr.io/metalbear-co/playground-order-service:latest \
  -f "${SHOP_DIR}/order-service/Dockerfile" "${SHOP_DIR}/order-service"

echo "building receipt-service → ghcr.io/metalbear-co/playground-receipt-service:latest"
docker build -t ghcr.io/metalbear-co/playground-receipt-service:latest \
  -f "${SHOP_DIR}/receipt-service/Dockerfile" "${SHOP_DIR}/receipt-service"

echo "building notifications-service → ghcr.io/metalbear-co/playground-notifications-service:latest"
docker build -t ghcr.io/metalbear-co/playground-notifications-service:latest \
  -f "${SHOP_DIR}/notifications-service/Dockerfile" "${SHOP_DIR}/notifications-service"

echo "building metal-mart-frontend → ${METAL_IMG}"
docker build -t "${METAL_IMG}" \
  --build-arg "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=${CLOUD_NAME}" \
  -f "${SHOP_DIR}/metal-mart-frontend/Dockerfile" "${SHOP_DIR}/metal-mart-frontend"

echo "patching imagePullPolicy to IfNotPresent (avoid GHCR pulls when image is local)…"
SHOP_DEPLOYMENTS=(
  inventory-service
  payment-service
  delivery-service
  order-service
  receipt-service
  notifications-service
  metal-mart-frontend
)
for dep in "${SHOP_DEPLOYMENTS[@]}"; do
  if kubectl get deployment "${dep}" -n shop >/dev/null 2>&1; then
    kubectl patch deployment "${dep}" -n shop --type=json \
      -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' \
      >/dev/null
  else
    echo "warning: deployment ${dep} not found in namespace shop (skipping patch)" >&2
  fi
done

echo "restarting shop deployments to pick up local images…"
kubectl rollout restart deployment -n shop
kubectl rollout status deployment/inventory-service -n shop --timeout=180s || true
kubectl rollout status deployment/payment-service -n shop --timeout=120s || true
kubectl rollout status deployment/delivery-service -n shop --timeout=180s || true
kubectl rollout status deployment/order-service -n shop --timeout=180s || true
kubectl rollout status deployment/receipt-service -n shop --timeout=120s || true
kubectl rollout status deployment/notifications-service -n shop --timeout=120s || true
kubectl rollout status deployment/metal-mart-frontend -n shop --timeout=300s || true

echo "minikube shop image build finished."
