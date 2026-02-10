import { producer } from "./connections.js";

export type SendOrderPayload = {
  orderId: number;
  items: Array<{ productId: number; quantity: number }>;
  status: string;
  tenant?: string;
};

/**
 * Kafka function: sends order event to the orders topic.
 * Used by both the current implementation and the Temporal publishOrderToKafka activity.
 */
export async function sendOrderToKafka(payload: SendOrderPayload): Promise<void> {
  const { orderId, items, status, tenant } = payload;
  const message = {
    orderId,
    items,
    status,
    timestamp: new Date().toISOString(),
  };
  const kafkaHeaders: Record<string, string> = {};
  if (tenant) kafkaHeaders["x-pg-tenant"] = tenant;

  await producer.send({
    topic: process.env.KAFKA_TOPIC || "orders",
    messages: [{ value: JSON.stringify(message), headers: kafkaHeaders }],
  });
}
