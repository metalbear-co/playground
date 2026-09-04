export type Fulfillment = {
  orderId: number;
  status: "packing" | "ready";
  updatedAt: string;
};

const fulfillments = new Map<number, Fulfillment>();

export function setFulfillment(orderId: number, status: Fulfillment["status"]): Fulfillment {
  const row: Fulfillment = {
    orderId,
    status,
    updatedAt: new Date().toISOString(),
  };
  fulfillments.set(orderId, row);
  return row;
}

export function getFulfillment(orderId: number): Fulfillment | undefined {
  return fulfillments.get(orderId);
}
