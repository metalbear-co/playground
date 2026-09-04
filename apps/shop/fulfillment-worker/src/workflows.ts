import { proxyActivities, sleep } from "@temporalio/workflow";
import type * as activities from "./activities.js";

const { packOrder, markReady } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

export async function orderFulfillment(orderId: number): Promise<void> {
  await packOrder(orderId);
  await sleep("2 seconds");
  await markReady(orderId);
}
