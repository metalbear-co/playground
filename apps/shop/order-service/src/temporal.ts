import { Client, Connection } from "@temporalio/client";
import { defaultPayloadConverter } from "@temporalio/common";

const address = process.env.TEMPORAL_ADDRESS?.trim() || "";
const namespace = process.env.TEMPORAL_NAMESPACE?.trim() || "default";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE?.trim() || "order-fulfillment";

export const temporalFulfillmentEnabled = Boolean(address);

export type StartFulfillmentPayload = {
  orderId: number;
  baggage?: string;
};

let clientPromise: Promise<Client | null> | null = null;

async function getClient(): Promise<Client | null> {
  if (!address) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({ address });
      return new Client({ connection, namespace });
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

function sessionFromBaggage(baggage?: string): string | undefined {
  const m = baggage?.match(/mirrord-session=([^,;\s]+)/);
  return m?.[1];
}

/** Fire-and-forget: start OrderFulfillment. Failures are logged and never fail checkout. */
export async function startOrderFulfillment(
  payload: StartFulfillmentPayload
): Promise<void> {
  if (!temporalFulfillmentEnabled) return;
  try {
    const client = await getClient();
    if (!client) return;
    const session = sessionFromBaggage(payload.baggage);
    // workflow_id is on both workflow and activity tasks. Header-only filters
    // miss pack/ready activities, so the cluster worker still logs "packing".
    const workflowId = session
      ? `order-${payload.orderId}-sess-${session}`
      : `order-${payload.orderId}`;
    const headers = payload.baggage
      ? { baggage: defaultPayloadConverter.toPayload(payload.baggage) }
      : undefined;
    await client.workflow.start("orderFulfillment", {
      workflowId,
      taskQueue,
      args: [payload.orderId],
      ...(headers ? { headers } : {}),
    });
    console.log("[Order/Temporal] started orderFulfillment for order %d", payload.orderId);
  } catch (e) {
    console.error("[Order/Temporal] start failed (order still ok):", e);
  }
}
