/**
 * Runtime config for order service. Single source for "use Temporal or not".
 * Default: false (direct checkout). Set USE_TEMPORAL=true to run checkout as a Temporal workflow.
 */
export type OrderMode = "direct" | "temporal";

const raw = process.env.USE_TEMPORAL?.toLowerCase();
export const orderMode: OrderMode =
  raw === "true" || raw === "1" ? "temporal" : "direct";
