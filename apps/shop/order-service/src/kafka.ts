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
  if (process.env.KAFKA_MSG_AUTHOR) kafkaHeaders["author"] = process.env.KAFKA_MSG_AUTHOR;
  if (process.env.KAFKA_MSG_SOURCE) kafkaHeaders["source"] = process.env.KAFKA_MSG_SOURCE;

  await producer.send({
    topic: process.env.KAFKA_TOPIC || "orders",
    messages: [{ value: JSON.stringify(message), headers: kafkaHeaders }],
  });
}
