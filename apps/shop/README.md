# MetalMart – Shop Demo App

Ecommerce demo app showcasing mirrord features: **HTTP Filtering**, **Queue Splitting**, and **DB Branching**.

## Architecture

- **metal-mart-frontend** (Next.js 16) – Product catalogue, cart, checkout, order tracking
- **inventory-service** – Products, stock (PostgreSQL)
- **order-service** – Orders, orchestrates checkout (PostgreSQL, Kafka producer)
- **payment-service** – Mock payment (no external API)
- **delivery-service** – Kafka consumer, creates deliveries

## Mirrord Demo Features

1. **HTTP Filtering** – Order service uses `X-PG-Tenant` header to route traffic (see `order-service/mirrord.json`)
2. **Queue Splitting** – Delivery service filters Kafka messages by `x-pg-tenant` header (see `delivery-service/mirrord.json`)
3. **DB Branching** – Order and Inventory services use isolated PostgreSQL branches (requires `operator.pgBranching=true` in mirrord-operator Helm chart)

## Local Development

```bash
# Start dependencies (Postgres, Kafka) – e.g. via Docker Compose or kind
# Then run each service with mirrord
cd apps/shop/order-service && mirrord exec npm run dev
cd apps/shop/delivery-service && mirrord exec npm run dev
cd apps/shop/inventory-service && mirrord exec npm run dev
cd apps/shop/metal-mart-frontend && NEXT_BASE_PATH= npm run dev
```

## URLs

- Shop: `https://playground.metalbear.dev/shop`
