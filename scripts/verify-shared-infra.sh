#!/usr/bin/env bash
# Verification step 1: shared infra deployed and synced on the cluster.
# Run this with kubectl/argocd context set to the cluster that serves playground.metalbear.dev.
set -e

echo "=== 1. Infra namespace exists ==="
kubectl get namespace infra -o wide 2>/dev/null || { echo "FAIL: namespace 'infra' not found. Apply overlays/gke (or ensure shared-infra Argo app is created and synced)."; exit 1; }

echo ""
echo "=== 2. Pods in infra namespace (redis, kafka, postgres) ==="
kubectl get pods -n infra -o wide 2>/dev/null || true
REDIS_READY=$(kubectl get pods -n infra -l app=redis --no-headers 2>/dev/null | grep -c Running || true)
if [[ "${REDIS_READY}" -lt 1 ]]; then
  echo "WARN: No Running redis pod in infra. Counter needs redis-main in infra."
fi

echo ""
echo "=== 3. Argo CD: shared-infra application (if Argo is installed) ==="
if kubectl get application -n argocd shared-infra -o wide 2>/dev/null; then
  echo ""
  kubectl get application -n argocd shared-infra -o jsonpath='Sync: {.status.sync.status}  Health: {.status.health.status}{"\n"}' 2>/dev/null || true
else
  echo "Argo CD app 'shared-infra' not found (or not in argocd namespace). Ensure overlays/gke is applied so the Application exists."
fi

echo ""
echo "=== 4. redis-main service in infra (counter connects here) ==="
kubectl get svc -n infra redis-main -o wide 2>/dev/null || { echo "WARN: Service redis-main not found in infra."; }

echo ""
echo "Done. If namespace infra exists and redis pod is Running, shared infra is deployed."
