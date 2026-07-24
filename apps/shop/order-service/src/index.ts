import "./otel.js";
import { readFileSync } from "fs";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { pool, producer, sqsClient, sqsQueueUrl } from "./connections.js";
import { inventoryUrl } from "./connections.js";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { sendOrderToKafka } from "./kafka.js";
import { publishOrderNotification } from "./rabbit.js";
import { publishOrderEventToPubSub } from "./pubsub.js";

const JWT_SECRET = process.env.JWT_SECRET || "demo-secret-key";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

async function initDb() {

  readFile(process.env.BANNERFILE || "dummy.txt");

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        items JSONB NOT NULL,
        total_cents INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        customer_email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255)
    `);
  } finally {
    client.release();
  }

}

function readFile(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    console.log("Response file loaded:", filePath);
    return content;
  } catch (err) {
    console.error("Failed to read response file:", err);
    process.exit(1);
  }
}

app.use(express.json());

const orderReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/banner", (_req, res) => {
  const text = readFile(process.env.BANNERFILE || "dummy.txt");
  res.json({ text });
});

/** Checkout input from POST /orders */
type OrderInput = {
  items: Array<{ productId: number; quantity: number }>;
  total_cents: number;
  customer_email?: string;
  baggage?: string;
};

const MAX_PRODUCT_ID = 2 ** 31 - 1; // safe integer, prevents URL injection

/**
 * Validate and normalize order items at the boundary. Ensures productId and
 * quantity are safe integers so they can be used in URLs and downstream.
 */
function validateOrderItems(raw: unknown): { items: Array<{ productId: number; quantity: number }> } | { error: string; productId?: number } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Items required" };
  }
  const items: Array<{ productId: number; quantity: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== "object") {
      return { error: "Invalid item" };
    }
    const productId = Number(entry.productId);
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(productId) || productId < 1 || productId > MAX_PRODUCT_ID) {
      return { error: "Invalid productId", productId: productId };
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { error: "Invalid quantity" };
    }
    items.push({ productId, quantity });
  }
  return { items };
}

/** Thrown by createOrderDirect to preserve HTTP status and response body. */
class OrderError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "OrderError";
  }
}

/** Create order via direct path: inventory → payment → DB → Kafka. */
async function createOrderDirect(
  input: OrderInput
): Promise<{
  orderId: number;
  status: string;
  demo?: string;
  customer_email?: string | null;
  baggage?: string | null;
}> {
  const { items, total_cents: totalCents, customer_email, baggage } = input;

  for (const item of items) {
    const productId = encodeURIComponent(String(item.productId));
    const checkRes = await fetch(
      `${inventoryUrl}/products/${productId}/check-stock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.quantity || 1 }),
      }
    );
    if (!checkRes.ok) {
      const err = await checkRes.json().catch(() => ({}));
      throw new OrderError(err.error || "Stock check failed", 400, {
        error: err.error || "Stock check failed",
        productId: item.productId,
      });
    }
    const { inStock } = await checkRes.json();
    if (!inStock) {
      throw new OrderError("Insufficient stock", 400, {
        error: "Insufficient stock",
        productId: item.productId,
      });
    }

    const reserveRes = await fetch(
      `${inventoryUrl}/products/${productId}/reserve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.quantity || 1 }),
      }
    );
    if (!reserveRes.ok) {
      const err = await reserveRes.json().catch(() => ({}));
      throw new OrderError(err.error || "Stock reservation failed", 409, {
        error: err.error || "Stock reservation failed",
        productId: item.productId,
      });
    }
  }

  const client = await pool.connect();
  let orderId: number;
  try {
    const {
      rows: [row],
    } = await client.query(
      "INSERT INTO orders (items, total_cents, status, customer_email) VALUES ($1, $2, 'confirmed', $3) RETURNING id",
      [JSON.stringify(items), totalCents, customer_email ?? null]
    );
    orderId = row.id;
  } finally {
    client.release();
  }

  const token = jwt.sign(
    { orderId, amount: totalCents, customer_email: customer_email ?? null },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  console.log("[Order] JWT created for order %d: %s", orderId, token);

  if (sqsQueueUrl) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: sqsQueueUrl,
        MessageBody: JSON.stringify({ jwt: token }),
      })
    );
  } else {
    console.warn(
      "[Order] SQS_QUEUE_URL unset — skipping payment SQS (local dev; payment-service will not debit)"
    );
  }

  await sendOrderToKafka({
    orderId,
    items,
    status: "confirmed",
    baggage,
  });

  await publishOrderNotification({
    orderId,
    status: "confirmed",
    customer_email: customer_email ?? null,
    total_cents: totalCents,
    event: "order_confirmed",
    baggage,
  });

  await publishOrderEventToPubSub({
    orderId,
    status: "confirmed",
    customer_email: customer_email ?? null,
    total_cents: totalCents,
    event: "order_confirmed",
    baggage,
  });

  return {
    orderId,
    status: "preview served by mirrord",
    demo: "preview-before-after",
    customer_email: customer_email ?? null,
    baggage: baggage ?? null,
  };
}

app.post("/orders", async (req, res) => {
  const baggage = req.headers["baggage"] as string | undefined;
  const body = req.body as { items?: unknown; total_cents?: number; customer_email?: string };
  const total_cents = typeof body.total_cents === "number" ? body.total_cents : 0;
  const customer_email = typeof body.customer_email === "string" ? body.customer_email : undefined;
  console.log("Order request:", JSON.stringify({ baggage, total_cents, customer_email, items: body.items }, null, 2));

  const validated = validateOrderItems(body.items);
  if ("error" in validated) {
    return res.status(400).json(
      validated.productId !== undefined
        ? { error: validated.error, productId: validated.productId }
        : { error: validated.error }
    );
  }
  const { items } = validated;

  const input: OrderInput = { items, total_cents, customer_email, baggage };

  try {
    const result = await createOrderDirect(input);
    console.log("Order response:", JSON.stringify(result, null, 2));
    return res.status(201).json(result);
  } catch (err) {
    console.error("Order error:", err);
    if (err instanceof OrderError) {
      return res.status(err.status).json(err.body);
    }
    return res
      .status(500)
      .json({
        error: err instanceof Error ? err.message : "Internal server error",
      });
  }
});

app.get("/orders/:id", orderReadLimiter, async (req, res) => {
  const rawId = req.params.id;
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid order ID" });
  try {
    const { rows } = await pool.query(
      "SELECT id, items, total_cents, status, created_at FROM orders WHERE id = $1",
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Order not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function main() {
  console.log("[Order] Starting");
  await producer.connect();
  await initDb();

  app.listen(port, "0.0.0.0", () => {
    console.log(`[Order] Listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
