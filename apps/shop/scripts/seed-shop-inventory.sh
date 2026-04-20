#!/usr/bin/env bash
# Replace inventory `products` with three items matching playground.metalbear.dev/shop (subset of live catalog).
# Run from repo root. Requires: psql in PATH for DATABASE_URL mode, or kubectl, or Docker shop-postgres.
#
# Targets (first match wins):
#   1) DATABASE_URL — e.g. postgresql://postgres:postgres@localhost:5432/inventory (after port-forward)
#   2) kubectl: deployment postgres in namespace infra (minikube / GKE with this layout)
#   3) docker: container shop-postgres (apps/shop/scripts/start-all-docker.sh)
#
# Ensure inventory-service has started at least once so the `products` table exists.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

SQL=$(cat <<'EOSQL'
TRUNCATE TABLE products RESTART IDENTITY;

INSERT INTO products (name, description, price_cents, stock, image_url, image_urls, is_new)
VALUES
  (
    'Team Work Makes The Dream Work Sticker',
    'MetalBear teamwork sticker',
    499,
    32,
    NULL,
    '["team_work_makes_the_Dream_work_ljp4we"]'::jsonb,
    true
  ),
  (
    'Team Work Makes The Dream Work T-Shirt',
    'MetalBear teamwork tee — front and back designs',
    2499,
    42,
    NULL,
    '["team_Work_makes_the_Dream_Work_-_front_w5qdnb","team_work_makes_the_dream_work_-_back_onanux"]'::jsonb,
    true
  ),
  (
    'Mind The Gap Sticker',
    'MetalBear Mind The Gap sticker',
    499,
    198,
    NULL,
    '["Mind_the_Gap_pkyuc6"]'::jsonb,
    false
  );
EOSQL
)

run_sql() {
  if [[ -n "${DATABASE_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
    echo "using DATABASE_URL + local psql"
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<< "${SQL}"
    return
  fi
  if command -v kubectl >/dev/null 2>&1 && kubectl get deploy postgres -n infra >/dev/null 2>&1; then
    echo "using kubectl exec deploy/postgres -n infra"
    kubectl exec -i -n infra deploy/postgres -- psql -U postgres -d inventory -v ON_ERROR_STOP=1 <<< "${SQL}"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'shop-postgres'; then
    echo "using docker exec shop-postgres"
    docker exec -i shop-postgres psql -U postgres -d inventory -v ON_ERROR_STOP=1 <<< "${SQL}"
    return
  fi
  echo "error: could not reach Postgres. Set DATABASE_URL, or use minikube with infra/postgres, or start shop-postgres (Docker)." >&2
  exit 1
}

run_sql
echo "Seeded 3 products into inventory."
