#!/usr/bin/env bash
# Start everything using Dockerfiles (same pattern as inventory-service/Dockerfile).
# Builds images, then runs infra + shop app containers. No npm on host.
# Run from repo root: ./apps/shop/scripts/start-all-docker.sh
# Or from apps/shop: ./scripts/start-all-docker.sh
#
# To use direct checkout at runtime: set USE_TEMPORAL=false when running order-service.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${SHOP_DIR}"

NETWORK="shop-network"
TEMPORAL_PG="temporal-postgresql"
TEMPORAL_SVC="temporal"
TEMPORAL_UI="temporal-ui"
SHOP_PG="shop-postgres"
KAFKA_CONTAINER="shop-kafka"

# --- Docker: network ---
echo "Creating network ${NETWORK}..."
docker network create "${NETWORK}" 2>/dev/null || true

# --- Docker: Temporal Postgres ---
echo "Starting Temporal Postgres..."
docker run -d --name "${TEMPORAL_PG}" --network "${NETWORK}" \
  -e POSTGRES_PASSWORD=temporal -e POSTGRES_USER=temporal \
  postgres:15 2>/dev/null || docker start "${TEMPORAL_PG}"

echo "Waiting for Temporal Postgres (10s)..."
sleep 10

# --- Docker: Temporal server ---
echo "Starting Temporal server (port 7233)..."
docker run -d --name "${TEMPORAL_SVC}" --network "${NETWORK}" -p 7233:7233 \
  -e DB=postgres12 -e DB_PORT=5432 -e POSTGRES_USER=temporal -e POSTGRES_PWD=temporal \
  -e POSTGRES_SEEDS="${TEMPORAL_PG}" \
  temporalio/auto-setup:1.24.2 2>/dev/null || docker start "${TEMPORAL_SVC}"

echo "Waiting for Temporal (20s)..."
sleep 20

echo "Registering namespace 'temporal'..."
docker run --rm --network "${NETWORK}" \
  -e TEMPORAL_ADDRESS="${TEMPORAL_SVC}:7233" -e TEMPORAL_CLI_ADDRESS="${TEMPORAL_SVC}:7233" \
  temporalio/admin-tools:1.24.2 \
  tctl --namespace default namespace register temporal --description "Shop" 2>/dev/null || true

# --- Docker: Temporal Web UI ---
echo "Starting Temporal Web UI (port 8080)..."
docker run -d --name "${TEMPORAL_UI}" --network "${NETWORK}" -p 8080:8080 \
  -e TEMPORAL_ADDRESS="${TEMPORAL_SVC}:7233" temporalio/ui:2.22.2 2>/dev/null || docker start "${TEMPORAL_UI}"

# --- Docker: Shop Postgres ---
echo "Starting Shop Postgres (port 5432)..."
docker run -d --name "${SHOP_PG}" --network "${NETWORK}" -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  postgres:15 2>/dev/null || docker start "${SHOP_PG}"

echo "Waiting for Shop Postgres (5s)..."
sleep 5

echo "Creating shop databases..."
docker exec "${SHOP_PG}" psql -U postgres -c "CREATE DATABASE orders;" 2>/dev/null || true
docker exec "${SHOP_PG}" psql -U postgres -c "CREATE DATABASE inventory;" 2>/dev/null || true
docker exec "${SHOP_PG}" psql -U postgres -c "CREATE DATABASE deliveries;" 2>/dev/null || true

# --- Docker: Kafka ---
echo "Starting Kafka (port 9092)..."
if docker ps -a --format '{{.Names}}' | grep -q "^${KAFKA_CONTAINER}$"; then
  docker start "${KAFKA_CONTAINER}"
else
  if ! docker run -d --name "${KAFKA_CONTAINER}" --network "${NETWORK}" -p 9092:9092 \
    docker.redpanda.com/redpandadata/redpanda:v24.2.5 \
    redpanda start --smp 1 --memory 1G --reserve-memory 0M --overprovisioned \
    --kafka-addr PLAINTEXT://0.0.0.0:9092 \
    --advertise-kafka-addr PLAINTEXT://localhost:9092 2>/dev/null; then
    # Port 9092 in use (e.g. existing Kafka); remove failed container and use alternate host port
    docker rm "${KAFKA_CONTAINER}" 2>/dev/null || true
    echo "Port 9092 in use, using 19092 for Kafka on host (app containers use internal 9092)."
    docker run -d --name "${KAFKA_CONTAINER}" --network "${NETWORK}" -p 19092:9092 \
      docker.redpanda.com/redpandadata/redpanda:v24.2.5 \
      redpanda start --smp 1 --memory 1G --reserve-memory 0M --overprovisioned \
      --kafka-addr PLAINTEXT://0.0.0.0:9092 \
      --advertise-kafka-addr PLAINTEXT://shop-kafka:9092
  fi
fi

echo "Waiting for Kafka (10s)..."
sleep 10

# --- Build shop app images (Dockerfile same pattern as inventory-service) ---
echo "Building shop app images..."

docker build -t shop-inventory-service -f "${SHOP_DIR}/inventory-service/Dockerfile" "${SHOP_DIR}/inventory-service"
docker build -t shop-payment-service -f "${SHOP_DIR}/payment-service/Dockerfile" "${SHOP_DIR}/payment-service"
docker build -t shop-delivery-service -f "${SHOP_DIR}/delivery-service/Dockerfile" "${SHOP_DIR}/delivery-service"
docker build -t shop-order-service -f "${SHOP_DIR}/order-service/Dockerfile" "${SHOP_DIR}/order-service"
docker build -t shop-metal-mart-frontend -f "${SHOP_DIR}/metal-mart-frontend/Dockerfile" "${SHOP_DIR}/metal-mart-frontend"

# --- Run shop app containers (service names for internal DNS) ---
echo "Starting shop app containers..."

docker run -d --name inventory-service --network "${NETWORK}" \
  -e PORT=80 \
  -e DATABASE_URL="postgresql://postgres:postgres@${SHOP_PG}:5432/inventory" \
  shop-inventory-service 2>/dev/null || docker start inventory-service

docker run -d --name payment-service --network "${NETWORK}" \
  -e PORT=80 \
  shop-payment-service 2>/dev/null || docker start payment-service

docker run -d --name delivery-service --network "${NETWORK}" \
  -e PORT=80 \
  -e DATABASE_URL="postgresql://postgres:postgres@${SHOP_PG}:5432/deliveries" \
  -e KAFKA_ADDRESS="${KAFKA_CONTAINER}:9092" \
  shop-delivery-service 2>/dev/null || docker start delivery-service

docker run -d --name order-service --network "${NETWORK}" \
  -e PORT=80 \
  -e DATABASE_URL="postgresql://postgres:postgres@${SHOP_PG}:5432/orders" \
  -e INVENTORY_SERVICE_URL="http://inventory-service:80" \
  -e PAYMENT_SERVICE_URL="http://payment-service:80" \
  -e KAFKA_ADDRESS="${KAFKA_CONTAINER}:9092" \
  -e USE_TEMPORAL=true \
  -e TEMPORAL_ADDRESS="${TEMPORAL_SVC}:7233" \
  -e TEMPORAL_NAMESPACE=temporal \
  shop-order-service 2>/dev/null || docker start order-service

docker run -d --name metal-mart-frontend --network "${NETWORK}" -p 3000:3000 \
  -e PORT=3000 \
  -e INVENTORY_SERVICE_URL="http://inventory-service:80" \
  -e ORDER_SERVICE_URL="http://order-service:80" \
  -e DELIVERY_SERVICE_URL="http://delivery-service:80" \
  shop-metal-mart-frontend 2>/dev/null || docker start metal-mart-frontend

echo ""
echo "Shop is up (all from Dockerfiles)."
echo "  Shop:        http://localhost:3000/shop"
echo "  Temporal UI: http://localhost:8080"
echo ""
echo "To stop: docker stop metal-mart-frontend order-service delivery-service inventory-service payment-service ${TEMPORAL_UI} ${TEMPORAL_SVC} ${TEMPORAL_PG} ${SHOP_PG} ${KAFKA_CONTAINER}"
echo "Or run: ./apps/shop/scripts/clean-all.sh"
