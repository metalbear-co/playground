import { PubSub } from "@google-cloud/pubsub";

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
  process.env.GCP_PROJECT?.trim() ||
  "";
const topicName = process.env.GCP_ORDER_EVENTS_TOPIC?.trim() || "";

export const orderEventsPubSubEnabled = Boolean(projectId && topicName);

export type OrderEventPayload = {
  orderId: number;
  status: string;
  customer_email: string | null;
  total_cents: number;
  event: "order_confirmed";
  baggage?: string;
};

let pubsub: PubSub | null = null;

function getClient(): PubSub | null {
  if (!orderEventsPubSubEnabled) return null;
  if (!pubsub) pubsub = new PubSub({ projectId });
  return pubsub;
}

/** Attribute used by mirrord GCP Pub/Sub splitting (see order-events-pubsub-consumer/mirrord.json). */
function tenantAttribute(baggage?: string): string {
  const base = "demo-local";
  if (!baggage?.trim()) return `${base}-shared`;
  const m = baggage.match(/mirrord=([^;,\s]+)/);
  if (m?.[1]) return `${base}-${m[1]}`;
  return `${base}-shared`;
}

/** Fire-and-forget order event to Pub/Sub; failures are logged and never fail checkout. */
export async function publishOrderEventToPubSub(
  payload: OrderEventPayload
): Promise<void> {
  if (!orderEventsPubSubEnabled) return;
  try {
    const client = getClient();
    if (!client) return;
    const dataBuffer = Buffer.from(JSON.stringify(payload), "utf-8");
    await client.topic(topicName).publishMessage({
      data: dataBuffer,
      attributes: { tenant: tenantAttribute(payload.baggage) },
    });
    console.log("[Order/PubSub] published order event for order %d", payload.orderId);
  } catch (e) {
    console.error("[Order/PubSub] publish failed (order still ok):", e);
  }
}
