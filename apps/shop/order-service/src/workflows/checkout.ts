import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities.js";

const {
  reserveStock,
  chargePayment,
  createOrder,
  publishOrderToKafka,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
});

export type CheckoutInput = {
  items: Array<{ productId: number; quantity: number }>;
  total_cents: number;
  tenant?: string;
};

export type CheckoutResult = {
  orderId: number;
  status: string;
};

/** Checkout workflow: stock → payment → order DB → Kafka */
export async function CheckoutWorkflow(
  input: CheckoutInput
): Promise<CheckoutResult> {
  await reserveStock(input);
  await chargePayment(input);
  const orderId = await createOrder(input);
  await publishOrderToKafka({
    orderId,
    items: input.items,
    status: "confirmed",
    tenant: input.tenant,
  });
  return { orderId, status: "confirmed" };
}
