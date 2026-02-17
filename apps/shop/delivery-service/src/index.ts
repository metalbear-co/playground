import express from "express";
import { Kafka } from "kafkajs";
import { Pool } from "pg";
import { range }  from "./range_assigner"

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/deliveries",
});

const kafka = new Kafka({
  clientId: "delivery-service",
  brokers: (process.env.KAFKA_ADDRESS || "localhost:9092").split(","),
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } finally {
    client.release();
  }
}

async function startConsumer() {
  const consumer = kafka.consumer({
    groupId: process.env.KAFKA_CONSUMER_GROUP || "delivery-service",
    partitionAssigners: [range]
  });
  await consumer.connect();
  const topic = process.env.KAFKA_TOPIC || "orders";
  await consumer.subscribe({ topic });

  await consumer.run({
    eachMessage: async ({ topic: t, partition, message }) => {
      try {
        console.log(`[${t}] Raw message received`, {
          partition,
          offset: message.offset,
          headers: message.headers ? Object.fromEntries(
            Object.entries(message.headers).map(([k, v]) => [k, v?.toString()])
          ) : null,
          value: message.value?.toString(),
        });
        const body = JSON.parse(message.value?.toString() || "{}");
        const orderId = body.orderId;
        console.log(`[${t}] Received order ${orderId}`);

        const client = await pool.connect();
        try {
          await client.query("INSERT INTO deliveries (order_id, status) VALUES ($1, 'processing')", [orderId]);
        } finally {
          client.release();
        }

        console.log(`Created delivery for order ${orderId}`);
      } catch (err) {
        console.error("Error processing message:", err);
      }
    },
  });
}

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/deliveries", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, order_id, status, created_at FROM deliveries ORDER BY created_at DESC LIMIT 50"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching deliveries:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/deliveries/order/:orderId", async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "Invalid order ID" });
  try {
    const { rows } = await pool.query(
      "SELECT id, order_id, status, created_at FROM deliveries WHERE order_id = $1",
      [orderId]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error("Error fetching delivery:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function main() {
  await initDb();
  await startConsumer();
  app.listen(port, "0.0.0.0", () => {
    console.log(`Delivery service listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
