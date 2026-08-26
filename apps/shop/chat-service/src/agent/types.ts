/** Shapes shared by the shopping agent, its dependencies, and the eval runner. */

/** A product as inventory-service returns it from GET /products. */
export type Product = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_url?: string | null;
  image_urls?: string[] | null;
  is_new?: boolean;
};

export type OrderItem = { productId: number; quantity: number };

export type Order = {
  id: number;
  items: OrderItem[];
  total_cents: number;
  status: string;
  created_at?: string;
};

/**
 * The three ways a shopping agent turn can end. The eval label is one of these
 * plus its arguments, so the judge compares tool name and arguments and never
 * has to inspect prose.
 */
export type TerminalCall =
  | { tool: "place_order"; args: { items: OrderItem[]; total_cents: number; customer_email?: string } }
  | { tool: "offer_alternative"; args: { product_id: number; reason: string } }
  | { tool: "issue_refund"; args: { order_id: number; reason: string } };

export const TERMINAL_TOOLS = ["place_order", "offer_alternative", "issue_refund"] as const;

/** One step of the agent's reasoning, captured so a run can be replayed and audited. */
export type TraceStep = {
  tool: string;
  input: unknown;
  /** Absent for terminal tools in read-only mode, where nothing is executed. */
  output?: unknown;
  error?: string;
};

export type AgentResult = {
  /** The customer-facing message, or null when the agent produced no prose. */
  reply: string | null;
  /** Null when the agent ran out of steps without committing to an action. */
  finalCall: TerminalCall | null;
  trace: TraceStep[];
  stopReason: "terminal" | "end_turn" | "max_steps" | "refusal";
};
