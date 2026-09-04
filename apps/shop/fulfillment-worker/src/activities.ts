import { setFulfillment } from "./store.js";

export async function packOrder(orderId: number): Promise<void> {
  setFulfillment(orderId, "packing");
  console.log("[Fulfillment] packing order %d", orderId);
}

export async function markReady(orderId: number): Promise<void> {
  setFulfillment(orderId, "ready");
  console.log("[Fulfillment] order %d ready", orderId);
}
