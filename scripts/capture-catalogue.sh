#!/usr/bin/env bash
#
# Capture the live Metal Mart catalogue from playground staging and regenerate
# the rehearsal cluster's seed SQL.
#
# Run this whenever the rehearsal cluster should be re-synced with what staging
# actually holds — the point of the rehearsal cluster is that eval scores there
# predict scores against playground, which only holds while the catalogues match.
#
# Reads through the public shop API, so it needs no cluster access and touches
# no shared database.
#
# Usage:
#   ./scripts/capture-catalogue.sh
#   SHOP_URL=https://playground.metalbear.dev ./scripts/capture-catalogue.sh

set -euo pipefail

SHOP_URL="${SHOP_URL:-https://playground.metalbear.dev}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_ROOT/overlays/eval-rehearsal/shop/seed-catalogue.sql"

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.jq"' EXIT

curl -sS --fail --max-time 30 "$SHOP_URL/shop/api/products" > "$tmp"
count="$(jq 'length' "$tmp")"
[ "$count" -gt 0 ] || { echo "catalogue came back empty — refusing to write" >&2; exit 1; }

cat > "$tmp.jq" <<'JQ'
def sq: tostring | gsub("'"; "''");
def lit: "'" + sq + "'";
[ .[] |
  "  (" + (.id|tostring) + ", " +
  (.name|lit) + ", " +
  (if .description == null then "NULL" else (.description|lit) end) + ", " +
  (.price_cents|tostring) + ", " +
  (.stock|tostring) + ", " +
  ((.image_urls // [])|tojson|lit) + "::jsonb, " +
  (.is_new|tostring) + ")"
] | join(",\n")
JQ

{
  cat <<EOF
-- Metal Mart catalogue seed for the eval rehearsal cluster.
--
-- Captured from $SHOP_URL on $(date -u +%Y-%m-%d) via the public shop API.
-- Regenerate with scripts/capture-catalogue.sh.
--
-- The 8-product snapshot hardcoded in
-- .github/workflows/ci-demo-shop-mirrord-vs-baseline.yml (frozen 2026-03-16)
-- is a different thing: that one is the stale fixture the agent eval demo is
-- built around, and it is deliberately left as it is.

INSERT INTO products (id, name, description, price_cents, stock, image_urls, is_new) VALUES
EOF
  jq -r -f "$tmp.jq" "$tmp"
  cat <<'EOF'
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  stock       = EXCLUDED.stock,
  image_urls  = EXCLUDED.image_urls,
  is_new      = EXCLUDED.is_new;

SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT MAX(id) FROM products));
EOF
} > "$OUT"

echo "wrote $OUT ($count products)"
