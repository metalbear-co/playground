import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import express from "express";
import rateLimit from "express-rate-limit";
import { NativeConnection, Worker } from "@temporalio/worker";
import { Connection, Client } from "@temporalio/client";
import { orderMode } from "./config.js";
import { pool, producer } from "./connections.js";
import { inventoryUrl, paymentUrl } from "./connections.js";
import { sendOrderToKafka } from "./kafka.js";
import * as activities from "./activities.js";
import { CheckoutWorkflow } from "./workflows/checkout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowBundlePath = path.join(__dirname, "workflow-bundle.js");

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

async function initDb() {

  readFile(process.env.RESPONSEFILE || "dummy.txt");

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

/** Checkout input from POST /orders */
type OrderInput = {
  items: Array<{ productId: number; quantity: number }>;
  total_cents: number;
  tenant?: string;
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

/** Create order via Temporal workflow (durable, retries, etc.). */
async function createOrderViaTemporal(
  input: OrderInput
): Promise<{ orderId: number; status: string }> {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "temporal";
  console.log("[Temporal] Client connecting to", temporalAddress, "namespace", namespace);
  const connection = await Connection.connect({ address: temporalAddress });
  const client = new Client({
    connection,
    namespace,
  });
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || "order-checkout";
  const workflowId = `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.log("[Temporal] Starting workflow", workflowId, "taskQueue", taskQueue);
  const handle = await client.workflow.start(CheckoutWorkflow, {
    taskQueue,
    workflowId,
    args: [input],
  });
  const resultTimeoutMs = 90_000; // 90s so gateway does not 502 before we respond
  const result = await Promise.race([
    handle.result(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Workflow result timeout (no worker?)")), resultTimeoutMs)
    ),
  ]);
  return result;
}

/** Create order via original direct path: inventory → payment → DB → Kafka. */
async function createOrderDirect(
  input: OrderInput
): Promise<{ orderId: number; status: string }> {
  const { items, total_cents: totalCents, tenant } = input;

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
  }

  const paymentRes = await fetch(`${paymentUrl}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 0, items }),
  });
  if (!paymentRes.ok) {
    throw new OrderError("Payment failed", 502, { error: "Payment failed" });
  }

  const client = await pool.connect();
  let orderId: number;
  try {
    const {
      rows: [row],
    } = await client.query(
      "INSERT INTO orders (items, total_cents, status) VALUES ($1, $2, 'confirmed') RETURNING id",
      [JSON.stringify(items), totalCents]
    );
    orderId = row.id;
  } finally {
    client.release();
  }

  await sendOrderToKafka({
    orderId,
    items,
    status: "confirmed",
    tenant,
  });

  return { orderId, status: "confirmed Ari" };
}

app.post("/orders", async (req, res) => {
  const tenant = req.headers["x-pg-tenant"] as string | undefined;
  const body = req.body as { items?: unknown; total_cents?: number };
  const total_cents = typeof body.total_cents === "number" ? body.total_cents : 0;

  const validated = validateOrderItems(body.items);
  if ("error" in validated) {
    return res.status(400).json(
      validated.productId !== undefined
        ? { error: validated.error, productId: validated.productId }
        : { error: validated.error }
    );
  }
  const { items } = validated;

  const input: OrderInput = { items, total_cents, tenant };

  try {
    const result =
      orderMode === "temporal"
        ? await createOrderViaTemporal(input)
        : await createOrderDirect(input);
    return res.status(201).json(result);
  } catch (err) {
    console.error(
      orderMode === "temporal" ? "Temporal order error:" : "Order error:",
      err
    );
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

async function runTemporalWorker() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "temporal";
  console.log("[Temporal] Starting worker, address:", temporalAddress, "namespace:", namespace);
  try {
    console.log("[Temporal] Connecting...");
    const connection = await NativeConnection.connect({
      address: temporalAddress,
    });
    console.log("[Temporal] Connected");
    const workerOptions = {
      connection,
      namespace,
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || "order-checkout",
      activities,
    };
    const workflowOpt = existsSync(workflowBundlePath)
      ? { workflowBundle: { codePath: workflowBundlePath } }
      : { workflowsPath: path.join(__dirname, "workflows") };
    console.log("[Temporal] Creating worker, workflowBundle:", existsSync(workflowBundlePath));
    const worker = await Worker.create({
      ...workerOptions,
      ...workflowOpt,
    });
    console.log("[Temporal] Worker started (task queue: order-checkout)");
    await worker.run();
  } catch (err) {
    console.error("[Temporal] Worker error (server stays up, Temporal checkout will fail until fixed):", err);
    // Do not process.exit(1) so the pod stays up and health/other routes keep working
  }
}

async function main() {
  console.log("[Order] Starting, orderMode:", orderMode);
  await producer.connect();
  await initDb();

  if (orderMode === "temporal") {
    runTemporalWorker().catch((err) => {
      console.error("[Temporal] Unhandled worker error:", err);
      process.exit(1);
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(
      `[Order] Listening on port ${port} (order mode: ${orderMode})`
    );
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
