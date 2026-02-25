#!/usr/bin/env bash
# Truncate products table and restart inventory-service so it re-seeds with the new swag catalog.
# Run with kubectl context set to the cluster (e.g. GKE playground).
set -e

POSTGRES_NS="${POSTGRES_NS:-infra}"
SHOP_NS="${SHOP_NS:-shop}"

echo "=== Re-seed inventory (swag catalog) ==="
echo ""

# 1. Get postgres pod name
PG_POD=$(kubectl -n "${POSTGRES_NS}" get pods -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null) || true
if [[ -z "${PG_POD}" ]]; then
  echo "Error: No postgres pod found in namespace ${POSTGRES_NS}"
  exit 1
fi
echo "Postgres pod: ${PG_POD}"

# 2. Truncate products table
echo "Truncating products table..."
kubectl -n "${POSTGRES_NS}" exec "${PG_POD}" -- psql -U postgres -d inventory -c "TRUNCATE products RESTART IDENTITY;" 2>/dev/null || {
  echo "Error: Could not truncate. Try: kubectl -n ${POSTGRES_NS} exec -it ${PG_POD} -- psql -U postgres -d inventory -c \"TRUNCATE products RESTART IDENTITY;\""
  exit 1
}
echo "Done."
echo ""

# 3. Restart inventory-service so initDb re-seeds
echo "Restarting inventory-service..."
kubectl -n "${SHOP_NS}" rollout restart deployment/inventory-service
kubectl -n "${SHOP_NS}" rollout status deployment/inventory-service --timeout=120s
echo ""
echo "Inventory re-seeded. Refresh the shop to see the new products."
