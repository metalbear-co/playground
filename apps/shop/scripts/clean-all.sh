#!/usr/bin/env bash
# Stop and remove all shop-related Docker containers and network (fresh start).
# Run from repo root: ./apps/shop/scripts/clean-all.sh
# Or from apps/shop: ./scripts/clean-all.sh
# Then run start-all.sh for a clean installation.

set -e

TEMPORAL_UI="temporal-ui"
TEMPORAL_SVC="temporal"
TEMPORAL_PG="temporal-postgresql"
SHOP_PG="shop-postgres"
KAFKA_CONTAINER="shop-kafka"
NETWORK="shop-network"
# App containers (from start-all-docker.sh)
APP_CONTAINERS="metal-mart-frontend order-service delivery-service inventory-service payment-service"

echo "Stopping and removing shop Docker resources..."

for name in "${TEMPORAL_UI}" "${TEMPORAL_SVC}" "${TEMPORAL_PG}" "${SHOP_PG}" "${KAFKA_CONTAINER}" ${APP_CONTAINERS}; do
  if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    docker rm -f "${name}" 2>/dev/null || true
    echo "  removed ${name}"
  fi
done

if docker network ls --format '{{.Name}}' | grep -q "^${NETWORK}$"; then
  docker network rm "${NETWORK}" 2>/dev/null || true
  echo "  removed network ${NETWORK}"
fi

echo "Done. Run ./apps/shop/scripts/start-all.sh or ./apps/shop/scripts/start-all-docker.sh for a fresh start."
