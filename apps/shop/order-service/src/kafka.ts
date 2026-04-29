import { producer } from "./connections.js";

export type SendOrderPayload = {
  orderId: number;
  items: Array<{ productId: number; quantity: number }>;
  status: string;
  baggage?: string;
};

/** mirrord preview requests carry a baggage header used for traffic splitting */
export function isPreviewFromBaggage(baggage?: string): boolean {
  if (!baggage) return false;
  return /mirrord\s*=/i.test(baggage);
}

function orderStatusForPreview(baggage?: string): string {
  return isPreviewFromBaggage(baggage) ? "confirmed_preview_env" : "confirmed";
}

/**
 * Kafka function: sends order event to the orders topic.
 * Used by both the current implementation and the Temporal publishOrderToKafka activity.
 * @returns Status string for the HTTP checkout response (preview traffic uses confirmed_preview_env).
 */
export async function sendOrderToKafka(payload: SendOrderPayload): Promise<string> {
  const { orderId, items, baggage } = payload;
  const status = orderStatusForPreview(baggage);
  const message = {
    orderId,
    items,
    status,
    timestamp: new Date().toISOString(),
  };
  const kafkaHeaders: Record<string, string> = {};
  if (baggage) kafkaHeaders["baggage"] = baggage;
  if (process.env.KAFKA_MSG_AUTHOR) kafkaHeaders["author"] = process.env.KAFKA_MSG_AUTHOR;
  if (process.env.KAFKA_MSG_SOURCE) kafkaHeaders["source"] = process.env.KAFKA_MSG_SOURCE;

  await producer.send({
    topic: process.env.KAFKA_TOPIC || "orders",
    messages: [{ value: JSON.stringify(message), headers: kafkaHeaders }],
  });
  return status;
}
