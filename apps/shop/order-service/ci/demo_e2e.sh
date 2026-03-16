#!/usr/bin/env bash
set -euo pipefail

: "${SHOP_URL:?Need SHOP_URL (e.g. http://localhost:30080 or https://playground.metalbear.dev)}"

MAX_RETRIES=30
RETRY_INTERVAL=5

# Optional baggage header for mirrord CI traffic routing
HEADER_ARGS=()
if [ -n "${BAGGAGE_HEADER:-}" ]; then
  HEADER_ARGS=(-H "baggage: ${BAGGAGE_HEADER}")
  echo "Using baggage header: ${BAGGAGE_HEADER}"
fi

echo "=== Shop E2E Test ==="
echo "Target: ${SHOP_URL}"

# Step 1: Health check with retry
echo ""
echo "--- Step 1: Health check ---"
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sS --fail "${HEADER_ARGS[@]}" "${SHOP_URL}/banner" >/dev/null 2>&1; then
    echo "Health check passed (attempt $i)"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "❌ ERROR: Health check failed after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Waiting for service... (attempt $i/$MAX_RETRIES)"
  sleep $RETRY_INTERVAL
done

# Step 2: GET /banner — verify banner text
echo ""
echo "--- Step 2: GET /banner ---"
banner_resp="$(curl -sS "${HEADER_ARGS[@]}" "${SHOP_URL}/banner")"
echo "$banner_resp" | jq .

echo "$banner_resp" | jq -e '.text' >/dev/null || {
  echo "❌ ERROR: banner text field missing"
  exit 1
}
echo "Banner check passed"

# Step 3: POST /orders — create an order
echo ""
echo "--- Step 3: POST /orders ---"
order_resp="$(curl -sS -X POST "${HEADER_ARGS[@]}" "${SHOP_URL}/orders" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"productId": 1, "quantity": 1}], "total_cents": 1999}')"
echo "$order_resp" | jq .

order_id="$(echo "$order_resp" | jq -e '.orderId')" || {
  echo "❌ ERROR: orderId missing from order response"
  exit 1
}
echo "Order created: id=$order_id"

order_status="$(echo "$order_resp" | jq -r '.status')"
if [ "$order_status" != "confirmed" ]; then
  echo "❌ ERROR: expected status 'confirmed', got '$order_status'"
  exit 1
fi

# Step 4: GET /orders/:id — verify order
echo ""
echo "--- Step 4: GET /orders/$order_id ---"
get_resp="$(curl -sS "${HEADER_ARGS[@]}" "${SHOP_URL}/orders/${order_id}")"
echo "$get_resp" | jq .

echo "$get_resp" | jq -e '.status == "confirmed"' >/dev/null || {
  echo "❌ ERROR: order status is not 'confirmed'"
  exit 1
}

echo ""
echo "✅ Shop demo_e2e passed"
