import amqp from "amqplib";

const url = process.env.RABBITMQ_URL?.trim() || "";
const queueName = process.env.RABBITMQ_QUEUE?.trim() || "order-notifications";

export const rabbitNotificationsEnabled = Boolean(url);

export type OrderNotificationPayload = {
  orderId: number;
  status: string;
  customer_email: string | null;
  total_cents: number;
  event: "order_confirmed";
  baggage?: string;
};

let channelPromise: Promise<amqp.Channel> | null = null;

async function getChannel(): Promise<amqp.Channel | null> {
  if (!url) return null;
  if (!channelPromise) {
    channelPromise = (async () => {
      const connection = await amqp.connect(url);
      connection.on("error", (err) => {
        console.error("[Order/Rabbit] connection error:", err);
      });
      const ch = await connection.createChannel();
      await ch.assertQueue(queueName, { durable: true });
      return ch;
    })();
  }
  return channelPromise;
}

/** Fire-and-forget order notification; failures are logged and never fail checkout. */
export async function publishOrderNotification(
  payload: OrderNotificationPayload
): Promise<void> {
  if (!rabbitNotificationsEnabled) return;
  try {
    const ch = await getChannel();
    if (!ch) return;
    const body = Buffer.from(JSON.stringify(payload), "utf-8");
    const opts: amqp.Options.Publish = {
      persistent: true,
      contentType: "application/json",
    };
    if (payload.baggage) {
      opts.headers = { baggage: payload.baggage };
    }
    ch.sendToQueue(queueName, body, opts);
    console.log("[Order/Rabbit] published notification for order %d", payload.orderId);
  } catch (e) {
    console.error("[Order/Rabbit] publish failed (order still ok):", e);
  }
}
