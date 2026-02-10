#!/usr/bin/env bash
# Start everything: Temporal, Postgres, Kafka, and all shop app services.
# Run from repo root: ./apps/shop/scripts/start-all.sh
# Or from apps/shop: ./scripts/start-all.sh
# Requires: Docker Desktop, Node.js, npm
#
# To use direct checkout at runtime: set USE_TEMPORAL=false when running order-service.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${SHOP_DIR}"

ORDER_DIR="${SHOP_DIR}/order-service"
INVENTORY_DIR="${SHOP_DIR}/inventory-service"
PAYMENT_DIR="${SHOP_DIR}/payment-service"
DELIVERY_DIR="${SHOP_DIR}/delivery-service"
FRONTEND_DIR="${SHOP_DIR}/metal-mart-frontend"

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

# --- Docker: Shop Postgres (orders, inventory, deliveries) ---
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

# --- Docker: Kafka (Redpanda is Kafka API compatible, single container) ---
echo "Starting Kafka (port 9092)..."
if docker ps -a --format '{{.Names}}' | grep -q "^${KAFKA_CONTAINER}$"; then
  docker start "${KAFKA_CONTAINER}"
else
  docker run -d --name "${KAFKA_CONTAINER}" --network "${NETWORK}" -p 9092:9092 \
    docker.redpanda.com/redpandadata/redpanda:v24.2.5 \
    redpanda start --smp 1 --memory 1G --reserve-memory 0M --overprovisioned \
    --kafka-addr PLAINTEXT://0.0.0.0:9092 \
    --advertise-kafka-addr PLAINTEXT://localhost:9092
fi

echo "Waiting for Kafka (10s)..."
sleep 10

# --- Shop app services (background) ---
echo "Starting shop app services..."

export PORT=3002
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/inventory"
(cd "${INVENTORY_DIR}" && npm run dev > "${SHOP_DIR}/.inventory.log" 2>&1) &
INVENTORY_PID=$!

export PORT=3003
(cd "${PAYMENT_DIR}" && npm run dev > "${SHOP_DIR}/.payment.log" 2>&1) &
PAYMENT_PID=$!

export PORT=3004
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/deliveries"
export KAFKA_ADDRESS=localhost:9092
(cd "${DELIVERY_DIR}" && npm run dev > "${SHOP_DIR}/.delivery.log" 2>&1) &
DELIVERY_PID=$!

export PORT=3001
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orders"
export INVENTORY_SERVICE_URL="http://localhost:3002"
export PAYMENT_SERVICE_URL="http://localhost:3003"
export KAFKA_ADDRESS=localhost:9092
export USE_TEMPORAL=true
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=temporal
(cd "${ORDER_DIR}" && npm run dev > "${SHOP_DIR}/.order.log" 2>&1) &
ORDER_PID=$!

export PORT=3000
export INVENTORY_SERVICE_URL="http://localhost:3002"
export ORDER_SERVICE_URL="http://localhost:3001"
export DELIVERY_SERVICE_URL="http://localhost:3004"
(cd "${FRONTEND_DIR}" && npm run dev > "${SHOP_DIR}/.frontend.log" 2>&1) &
FRONTEND_PID=$!

echo ""
echo "Shop is starting. PIDs: order=${ORDER_PID} inventory=${INVENTORY_PID} payment=${PAYMENT_PID} delivery=${DELIVERY_PID} frontend=${FRONTEND_PID}"
echo "Logs: .order.log .inventory.log .payment.log .delivery.log .frontend.log"
echo ""
echo "URLs:"
echo "  Shop:        http://localhost:3000"
echo "  Temporal UI: http://localhost:8080"
echo ""
echo "To stop app services: kill ${ORDER_PID} ${INVENTORY_PID} ${PAYMENT_PID} ${DELIVERY_PID} ${FRONTEND_PID}"
echo "To stop Docker: docker stop ${TEMPORAL_UI} ${TEMPORAL_SVC} ${TEMPORAL_PG} ${SHOP_PG} ${KAFKA_CONTAINER}"
