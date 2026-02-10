import { pool, producer, inventoryUrl, paymentUrl } from "./connections.js";
import { sendOrderToKafka } from "./kafka.js";

export type CheckoutInput = {
  items: Array<{ productId: number; quantity: number }>;
  total_cents: number;
  tenant?: string;
};

export type CheckoutResult = {
  orderId: number;
  status: string;
};

/** Check stock for all items via inventory-service */
export async function reserveStock(input: CheckoutInput): Promise<void> {
  for (const item of input.items) {
    const checkRes = await fetch(
      `${inventoryUrl}/products/${item.productId}/check-stock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.quantity || 1 }),
      }
    );
    if (!checkRes.ok) {
      const err = await checkRes.json().catch(() => ({}));
      throw new Error(err.error || "Stock check failed");
    }
    const { inStock } = await checkRes.json();
    if (!inStock) {
      throw new Error(`Insufficient stock for product ${item.productId}`);
    }
  }
}

/** Charge payment via payment-service */
export async function chargePayment(input: CheckoutInput): Promise<void> {
  const paymentRes = await fetch(`${paymentUrl}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 0, items: input.items }),
  });
  if (!paymentRes.ok) {
    throw new Error("Payment failed");
  }
}

/** Insert order into DB and return orderId */
export async function createOrder(input: CheckoutInput): Promise<number> {
  const client = await pool.connect();
  try {
    const {
      rows: [row],
    } = await client.query(
      "INSERT INTO orders (items, total_cents, status) VALUES ($1, $2, 'confirmed') RETURNING id",
      [JSON.stringify(input.items), input.total_cents]
    );
    return row.id as number;
  } finally {
    client.release();
  }
}

/** Publish order event to Kafka (calls the Kafka function) */
export async function publishOrderToKafka(input: {
  orderId: number;
  items: Array<{ productId: number; quantity: number }>;
  status: string;
  tenant?: string;
}): Promise<void> {
  await sendOrderToKafka({
    orderId: input.orderId,
    items: input.items,
    status: input.status,
    tenant: input.tenant,
  });
}
