# MetalMart — mirrord Chaos tests (run guide)

## Big picture

| Piece | What it is |
|---|---|
| **Target service** | Always **`order-service`** for this demo |
| **mirrord config** | `apps/shop/order-service/mirrord.json` |
| **What chaos hits** | That local process’s **outgoing TCP** (Postgres, RabbitMQ, inventory) |
| **Who is affected** | **Only your session** — not the cluster, not other users |
| **Public URL** | `https://playground.metalbear.dev/shop` with `baggage: mirrord-session=<key>` |

Chaos does **not** kill pods. It only degrades/fails connections **from your local order-service**.

You need **one** live mirrord session first, then apply **one** prebaked rule at a time.

---

## Setup (once per demo)

### Terminal A — start the session (leave running)

```bash
cd ~/Desktop/CONTRIBUTION/playground
export MIRRORD_SESSION="${MIRRORD_SESSION:-$USER}"

USER="$MIRRORD_SESSION" \
  mirrord exec -f apps/shop/order-service/mirrord.json -- \
  npm --prefix apps/shop/order-service run dev
```

Copy the printed **session ID** (UUID). That is *not* the same as `MIRRORD_SESSION` (baggage key).

### Terminal B — env for chaos + curls

```bash
cd ~/Desktop/CONTRIBUTION/playground
export MIRRORD_SESSION="${MIRRORD_SESSION:-$USER}"
export SESSION_ID='paste-uuid-from-terminal-A'
```

### Shared traffic command (all tests)

Checkout goes: inventory → payment → **Postgres** → **RabbitMQ** (notification is fire-and-forget).

```bash
time curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "baggage: mirrord-session=${MIRRORD_SESSION}" \
  -d '{"items":[{"productId":1,"quantity":1}],"total_cents":100,"customer_email":"chaos-demo@metalbear.dev"}' \
  https://playground.metalbear.dev/shop/api/orders
```

Between tests:

```bash
mirrord chaos delete -s "$SESSION_ID"
```

---

## All tests (cheat sheet)

Prerequisite: Terminal A session running; `SESSION_ID` and `MIRRORD_SESSION` set in Terminal B. After each test: run the shared curl, then `mirrord chaos delete -s "$SESSION_ID"`.

| # | Story | Session on | Breaks | Rule file | How to run (Terminal B) | Expect |
|---|---|---|---|---|---|---|
| 1 | Slow DB (maintenance) | order-service | Postgres `:5432` | `.mirrord/chaos/01-db-slow.json` | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/01-db-slow.json` | Slower checkout |
| 2 | DB connection gone | order-service | Postgres `:5432` | `.mirrord/chaos/02-db-connection-drop.json` | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/02-db-connection-drop.json` | Checkout fails; DB errors in Terminal A |
| 3 | DB timeouts | order-service | Postgres `:5432` | `.mirrord/chaos/03-db-timeout.json` | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/03-db-timeout.json` | Timeout-style failure |
| 4 | Broker down | order-service | RabbitMQ `:5672` | `.mirrord/chaos/04-rabbitmq-drop.json` | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/04-rabbitmq-drop.json` | Order may still 200; `[Order/Rabbit] publish failed` in logs |
| 5 | Slow broker | order-service | RabbitMQ `:5672` | `.mirrord/chaos/05-rabbitmq-slow.json` | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/05-rabbitmq-slow.json` | Slower publish path |
| 6 | Slow inventory dep | order-service | `inventory-service` | `.mirrord/chaos/06-inventory-svc-slow.json` | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/06-inventory-svc-slow.json` | Checkout waits longer on stock check |

Full upstream hosts:

- Postgres: `postgres.infra.svc.cluster.local:5432`
- RabbitMQ: `rabbitmq.infra.svc.cluster.local:5672`
- Inventory: `inventory-service`

---

## Test 1 — Slow Postgres (“maintenance latency”)

| | |
|---|---|
| **Story** | Planned DB maintenance — DB is up but slow |
| **Session** | order-service (Terminal A) |
| **Rule** | `.mirrord/chaos/01-db-slow.json` |
| **Upstream** | `postgres.infra.svc.cluster.local:5432` |
| **Effect** | ~800ms read / 200ms write latency |
| **How to run** | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/01-db-slow.json` → shared curl → `mirrord chaos delete -s "$SESSION_ID"` |

```bash
mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/01-db-slow.json
# run the shared curl — expect slower response
mirrord chaos delete -s "$SESSION_ID"
```

---

## Test 2 — Postgres connection drop

| | |
|---|---|
| **Story** | Complete DB connection loss (Fatih’s real incident shape) |
| **Session** | order-service |
| **Rule** | `.mirrord/chaos/02-db-connection-drop.json` |
| **Upstream** | `postgres.infra.svc.cluster.local:5432` |
| **Effect** | TCP `reset` on 100% of connections |
| **How to run** | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/02-db-connection-drop.json` → shared curl → `mirrord chaos delete -s "$SESSION_ID"` |

```bash
mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/02-db-connection-drop.json
# curl — expect checkout failure / DB errors in Terminal A
mirrord chaos delete -s "$SESSION_ID"
```

---

## Test 3 — Postgres timeout

| | |
|---|---|
| **Story** | DB connections hang / time out |
| **Session** | order-service |
| **Rule** | `.mirrord/chaos/03-db-timeout.json` |
| **Upstream** | `postgres.infra.svc.cluster.local:5432` |
| **Effect** | `timed_out` connection errors |
| **How to run** | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/03-db-timeout.json` → shared curl → `mirrord chaos delete -s "$SESSION_ID"` |

```bash
mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/03-db-timeout.json
# curl — expect timeout-style failure
mirrord chaos delete -s "$SESSION_ID"
```

---

## Test 4 — RabbitMQ connection drop

| | |
|---|---|
| **Story** | Broker unavailable (central messaging outage) |
| **Session** | order-service |
| **Rule** | `.mirrord/chaos/04-rabbitmq-drop.json` |
| **Upstream** | `rabbitmq.infra.svc.cluster.local:5672` |
| **Effect** | TCP `reset` to RabbitMQ |
| **How to run** | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/04-rabbitmq-drop.json` → shared curl → `mirrord chaos delete -s "$SESSION_ID"` |

```bash
mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/04-rabbitmq-drop.json
# curl — order may still 200; watch Terminal A for [Order/Rabbit] publish failed
mirrord chaos delete -s "$SESSION_ID"
```

---

## Test 5 — Slow RabbitMQ

| | |
|---|---|
| **Story** | Broker up but slow publish/consume |
| **Session** | order-service |
| **Rule** | `.mirrord/chaos/05-rabbitmq-slow.json` |
| **Upstream** | `rabbitmq.infra.svc.cluster.local:5672` |
| **Effect** | Latency on AMQP connections |
| **How to run** | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/05-rabbitmq-slow.json` → shared curl → `mirrord chaos delete -s "$SESSION_ID"` |

```bash
mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/05-rabbitmq-slow.json
# curl — slower notification publish path in logs
mirrord chaos delete -s "$SESSION_ID"
```

---

## Test 6 — Slow inventory dependency

| | |
|---|---|
| **Story** | Downstream HTTP dependency is slow (not DB/Rabbit) |
| **Session** | order-service (still — chaos is on *its* calls out to inventory) |
| **Rule** | `.mirrord/chaos/06-inventory-svc-slow.json` |
| **Upstream** | `inventory-service` |
| **Effect** | Latency on TCP to inventory |
| **How to run** | `mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/06-inventory-svc-slow.json` → shared curl → `mirrord chaos delete -s "$SESSION_ID"` |

```bash
mirrord chaos add -s "$SESSION_ID" -f .mirrord/chaos/06-inventory-svc-slow.json
# curl — checkout waits longer on stock check/reserve
mirrord chaos delete -s "$SESSION_ID"
```

---

## Optional: ask the AI (controlled)

With session up, you can tell Cursor/Claude:

```text
Session ID is <SESSION_ID>.
Using mirrord-chaos, apply .mirrord/chaos/01-db-slow.json only — do not invent or edit the rule.
```

---

## Teardown

```bash
mirrord chaos delete -s "$SESSION_ID"
# Ctrl+C Terminal A
```

Do not leave mirrord running after the demo.
