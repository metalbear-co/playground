#!/usr/bin/env bash
# Argo CD session: port-forward, get login credentials, and optionally sync the shop app.
# Run with kubectl context set to the cluster that serves playground.metalbear.dev.
set -e

ARGOCD_PORT="${ARGOCD_PORT:-8443}"
ARGOCD_NS="argocd"

echo "=== Argo CD session ==="
echo ""

# 1. Get initial admin password
echo "1. Admin password (use 'admin' as username):"
PASSWORD=$(kubectl -n "${ARGOCD_NS}" get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d 2>/dev/null) || true
if [[ -z "${PASSWORD}" ]]; then
  echo "   Could not read argocd-initial-admin-secret. Argo CD may use a different auth setup."
  echo "   Try: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
else
  echo "   ${PASSWORD}"
fi
echo ""

# 2. Port-forward
echo "2. Starting port-forward (Argo CD UI at https://localhost:${ARGOCD_PORT})..."
echo "   Press Ctrl+C to stop."
echo ""
echo "   In another terminal, to sync the shop app via CLI:"
echo "   argocd login localhost:${ARGOCD_PORT} --insecure --username admin --password <password>"
echo "   argocd app sync shop"
echo ""
kubectl port-forward "svc/argocd-server" -n "${ARGOCD_NS}" "${ARGOCD_PORT}:443"
