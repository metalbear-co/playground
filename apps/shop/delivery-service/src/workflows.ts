import { proxyActivities } from "@temporalio/workflow";

const { createDelivery } = proxyActivities<{
  createDelivery: (orderId: number) => Promise<void>;
}>({
  startToCloseTimeout: "1 minute",
});

/** Workflow that processes an order delivery. Temporal provides durability if the service goes down. */
export async function processDeliveryWorkflow(orderId: number): Promise<void> {
  await createDelivery(orderId);
}
