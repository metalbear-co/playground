import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { pool, producer, inventoryUrl, sqsClient, sqsQueueUrl } from "./connections.js";
import { sendOrderToKafka } from "./kafka.js";
import { publishOrderNotification } from "./rabbit.js";

export type CheckoutInput = {
  items: Array<{ productId: number; quantity: number }>;
  total_cents: number;
  customer_email?: string;
  baggage?: string;
  gift_wrap?: boolean;
};

export type CheckoutResult = {
  orderId: number;
  status: string;
};

const GIFT_WRAP_FEE_CENTS = 499;

function getGiftWrapFeeCents(giftWrap?: boolean): number {
  return giftWrap ? GIFT_WRAP_FEE_CENTS : 0;
}

function getOrderTotalCents(input: CheckoutInput): number {
  return input.total_cents + getGiftWrapFeeCents(input.gift_wrap);
}

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

    const reserveRes = await fetch(
      `${inventoryUrl}/products/${item.productId}/reserve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.quantity || 1 }),
      }
    );
    if (!reserveRes.ok) {
      const err = await reserveRes.json().catch(() => ({}));
      throw new Error(err.error || `Stock reservation failed for product ${item.productId}`);
    }
  }
}

/** Send payment message to SQS */
export async function chargePayment(input: CheckoutInput & { orderId?: number }): Promise<void> {
  if (!sqsQueueUrl) {
    console.warn(
      "[Order] SQS_QUEUE_URL unset — skipping payment SQS in Temporal activity (local dev)"
    );
    return;
  }
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: sqsQueueUrl,
      MessageBody: JSON.stringify({
        orderId: input.orderId,
        amount: getOrderTotalCents(input),
        items: input.items,
        customer_email: input.customer_email ?? null,
      }),
      MessageAttributes: {
        "baggage": {
          DataType: "String",
          StringValue: input.baggage || "unknown",
        },
      },
    })
  );
}

/** Insert order into DB and return orderId */
export async function createOrder(input: CheckoutInput): Promise<number> {
  const totalCents = getOrderTotalCents(input);
  const giftWrapFeeCents = getGiftWrapFeeCents(input.gift_wrap);
  const client = await pool.connect();
  try {
    const {
      rows: [row],
    } = await client.query(
      "INSERT INTO orders (items, total_cents, status, customer_email, gift_wrap, gift_wrap_fee_cents) VALUES ($1, $2, 'confirmed', $3, $4, $5) RETURNING id",
      [JSON.stringify(input.items), totalCents, input.customer_email ?? null, input.gift_wrap === true, giftWrapFeeCents]
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
  baggage?: string;
  gift_wrap?: boolean;
}): Promise<void> {
  await sendOrderToKafka({
    orderId: input.orderId,
    items: input.items,
    status: input.status,
    baggage: input.baggage,
    gift_wrap: input.gift_wrap,
  });
}

/** Async notification fan-out (RabbitMQ); optional when RABBITMQ_URL is unset. */
export async function publishOrderNotificationActivity(input: {
  orderId: number;
  total_cents: number;
  customer_email?: string;
  baggage?: string;
  gift_wrap?: boolean;
}): Promise<void> {
  await publishOrderNotification({
    orderId: input.orderId,
    status: "confirmed",
    customer_email: input.customer_email ?? null,
    total_cents: input.total_cents + getGiftWrapFeeCents(input.gift_wrap),
    event: "order_confirmed",
    baggage: input.baggage,
  });
}
