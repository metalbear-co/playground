import express from "express";
import { Kafka } from "kafkajs";
import { Pool } from "pg";
import { range } from "./range_assigner.js"

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
    await client.query(`
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS gift_wrap BOOLEAN NOT NULL DEFAULT FALSE
    `);
  } finally {
    client.release();
  }
}

async function startConsumer() {
  const consumer = kafka.consumer({
    groupId: process.env.KAFKA_CONSUMER_GROUP || "delivery-service",
    partitionAssigners: [range],
    sessionTimeout: 30000,
    rebalanceTimeout: 60000,
    heartbeatInterval: 10000,
    maxWaitTimeInMs: 5000,
    retry: {
      retries: 10,
      initialRetryTime: 300,
    },
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
        const giftWrap = body.gift_wrap === true;
        console.log(`[${t}] Received order ${orderId} (gift_wrap=${giftWrap})`);

        const client = await pool.connect();
        try {
          await client.query(
            "INSERT INTO deliveries (order_id, status, gift_wrap) VALUES ($1, 'processing', $2)",
            [orderId, giftWrap]
          );
        } finally {
          client.release();
        }

        console.log(`🚀 [LOCAL] Created delivery for order ${orderId}`);
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
      "SELECT id, order_id, status, gift_wrap, created_at FROM deliveries ORDER BY created_at DESC LIMIT 50"
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
      "SELECT id, order_id, status, gift_wrap, created_at FROM deliveries WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [orderId]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error("Error fetching delivery:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function main() {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Delivery service listening on port ${port}`);
  });
  await initDb();
  await startConsumer();
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
