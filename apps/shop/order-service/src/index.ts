import express from "express";
import { Pool } from "pg";
import { Kafka } from "kafkajs";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/orders",
});

const inventoryUrl = process.env.INVENTORY_SERVICE_URL || "http://localhost:80";
const paymentUrl = process.env.PAYMENT_SERVICE_URL || "http://localhost:80";

const kafka = new Kafka({
  clientId: "order-service",
  brokers: (process.env.KAFKA_ADDRESS || "localhost:9092").split(","),
});
const producer = kafka.producer();

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        items JSONB NOT NULL,
        total_cents INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } finally {
    client.release();
  }
}

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/orders", async (req, res) => {
  const tenant = req.headers["x-pg-tenant"] as string | undefined;
  const { items = [], total_cents = 0 } = req.body as {
    items: Array<{ productId: number; quantity: number }>;
    total_cents?: number;
  };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Items required" });
  }

  try {
    for (const item of items) {
      const checkRes = await fetch(`${inventoryUrl}/products/${item.productId}/check-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.quantity || 1 }),
      });
      if (!checkRes.ok) {
        const err = await checkRes.json().catch(() => ({}));
        return res.status(400).json({ error: err.error || "Stock check failed", productId: item.productId });
      }
      const { inStock } = await checkRes.json();
      if (!inStock) {
        return res.status(400).json({ error: "Insufficient stock", productId: item.productId });
      }
    }

    const paymentRes = await fetch(`${paymentUrl}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 0, items }),
    });
    if (!paymentRes.ok) {
      return res.status(502).json({ error: "Payment failed" });
    }

    const totalCents = total_cents;
    const client = await pool.connect();
    let orderId: number;
    try {
      const { rows } = await client.query(
        "INSERT INTO orders (items, total_cents, status) VALUES ($1, $2, 'confirmed') RETURNING id",
        [JSON.stringify(items), totalCents]
      );
      orderId = rows[0].id;
    } finally {
      client.release();
    }

    const message = {
      orderId,
      items,
      status: "confirmed",
      timestamp: new Date().toISOString(),
    };
    const kafkaHeaders: Record<string, string> = {};
    if (tenant) kafkaHeaders["x-pg-tenant"] = tenant;

    await producer.send({
      topic: process.env.KAFKA_TOPIC || "orders",
      messages: [{ value: JSON.stringify(message), headers: kafkaHeaders }],
    });

    res.status(201).json({ orderId, status: "confirmed" });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/orders/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid order ID" });
  try {
    const { rows } = await pool.query("SELECT id, items, total_cents, status, created_at FROM orders WHERE id = $1", [
      id,
    ]);
    if (rows.length === 0) return res.status(404).json({ error: "Order not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function main() {
  await producer.connect();
  await initDb();
  app.listen(port, "0.0.0.0", () => {
    console.log(`Order service listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
