#!/usr/bin/env bash
# Stop Temporal server and UI (any port: 8080, 8088, etc.).
# Run from repo root: ./apps/shop/scripts/stop-temporal.sh
# Or from apps/shop: ./scripts/stop-temporal.sh

set -e

echo "Stopping Temporal (UI + server + Postgres)..."

# Stop by container name (our scripts use these)
for name in temporal-ui temporal temporal-postgresql; do
  if docker ps -a -q --filter "name=^${name}$" 2>/dev/null | grep -q .; then
    docker rm -f "${name}" 2>/dev/null || true
    echo "  stopped ${name}"
  fi
done

# Stop any container publishing port 8088 or 8080 (Temporal UI)
while read -r id ports; do
  if echo "${ports}" | grep -qE '0\.0\.0\.0:8088|0\.0\.0\.0:8080|:::8088|:::8080'; then
    docker rm -f "${id}" 2>/dev/null || true
    echo "  stopped container ${id} (was using port 8088/8080)"
  fi
done < <(docker ps --format '{{.ID}} {{.Ports}}' 2>/dev/null || true)

echo "Done. Temporal UI at http://localhost:8088 (or 8080) should be gone."
