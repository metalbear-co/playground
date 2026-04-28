import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities.js";

const {
  reserveStock,
  chargePayment,
  createOrder,
  publishOrderToKafka,
  publishOrderNotificationActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
});

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

/** Checkout workflow: stock → payment → order DB → Kafka */
export async function CheckoutWorkflow(
  input: CheckoutInput
): Promise<CheckoutResult> {
  await reserveStock(input);
  const orderId = await createOrder(input);
  await chargePayment({ ...input, orderId });
  await publishOrderToKafka({
    orderId,
    items: input.items,
    status: "confirmed",
    baggage: input.baggage,
    gift_wrap: input.gift_wrap,
  });
  await publishOrderNotificationActivity({
    orderId,
    total_cents: input.total_cents,
    customer_email: input.customer_email,
    baggage: input.baggage,
    gift_wrap: input.gift_wrap,
  });
  return { orderId, status: "confirmed" };
}
