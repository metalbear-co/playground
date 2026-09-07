import { depsFromEnv, type ShopDeps } from "./deps.js";
import { runShoppingAgent } from "./loop.js";
import type { AgentResult } from "./types.js";

export { runShoppingAgent } from "./loop.js";
export { depsFromEnv, liveDeps, stubDeps, type ShopDeps } from "./deps.js";
export { TOOLS, asTerminalCall } from "./tools.js";
export type { AgentResult, TerminalCall, TraceStep, Product, Order, OrderItem } from "./types.js";

/**
 * Whether chat-service should answer with the shopping agent instead of its
 * canned greeting.
 *
 * Off by default, so the support-chat demo keeps the behaviour it shipped with:
 * one bot greeting per conversation, then a human takes over. Turning it on also
 * makes replies multi-turn, because a shopping agent that answers only the first
 * message cannot complete an order.
 */
export function agentEnabled(): boolean {
  return process.env.SHOPPING_AGENT_ENABLED?.trim().toLowerCase() === "true";
}

/** Whether a terminal place_order should really be sent to order-service. */
export function agentExecutes(): boolean {
  return process.env.SHOPPING_AGENT_EXECUTE?.trim().toLowerCase() === "true";
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Appends what was actually ordered to the agent's own sentence.
 *
 * The agent is asked to name the items and total and often does not — it writes
 * things like "Both are in stock, placing that now", which is true but leaves
 * the customer without a record of what they just bought. This states it from
 * the tool call's arguments, so the figure shown is the one submitted rather
 * than something the model restated from memory.
 *
 * Falls back to quantities alone if inventory cannot be reached: a receipt
 * without names still beats a silent charge.
 */
async function orderSummary(
  args: { items: Array<{ productId: number; quantity: number }>; total_cents: number },
  deps: ShopDeps
): Promise<string> {
  const parts = await Promise.all(
    args.items.map(async (item) => {
      const product = await deps.getProduct(item.productId).catch(() => null);
      return `${item.quantity} × ${product?.name ?? `#${item.productId}`}`;
    })
  );
  return `${parts.join(", ")} — ${money(args.total_cents)}`;
}

/**
 * Turns an agent result into something worth showing the customer.
 *
 * The agent is asked to write this sentence itself, and usually does. These
 * fallbacks cover the turns where it calls a tool silently, so they say only
 * what the tool call already proves — an order is `confirmed`, never "on its
 * way", because nothing has shipped at this point.
 */
export function replyText(result: AgentResult): string {
  if (result.reply) return result.reply;
  const call = result.finalCall;
  switch (call?.tool) {
    case "place_order": {
      const units = call.args.items.reduce((n, i) => n + i.quantity, 0);
      return `Order confirmed — ${units} item${units === 1 ? "" : "s"}, ${money(call.args.total_cents)}.`;
    }
    case "offer_alternative":
      return "That one is not available, but I found something close.";
    case "issue_refund":
      return `Sorry about that — I have started the refund for order #${call.args.order_id}.`;
    default:
      return "Let me get a human to help with that.";
  }
}

/**
 * Answers one customer message in a conversation.
 *
 * Failures are swallowed into a handover message on purpose: a chat widget that
 * goes silent when the model errors is worse than one that admits it.
 */
export async function answerCustomerMessage(opts: {
  message: string;
  history?: Array<{ sender: "customer" | "agent" | "bot"; text: string }>;
  baggage?: string;
}): Promise<string> {
  try {
    const deps = depsFromEnv(opts.baggage);
    const result = await runShoppingAgent({
      message: opts.message,
      history: opts.history,
      deps,
      execute: agentExecutes(),
      baggage: opts.baggage,
    });
    console.log(
      "[agent] %s -> %s (%d steps)",
      result.stopReason,
      result.finalCall?.tool ?? "none",
      result.trace.length
    );

    const text = replyText(result);
    if (result.finalCall?.tool === "place_order") {
      const summary = await orderSummary(result.finalCall.args, deps);
      // The fallback already carries a total; only the agent's own prose needs it.
      return result.reply ? `${text} (${summary})` : `Order confirmed — ${summary}.`;
    }
    return text;
  } catch (err) {
    console.error("[agent] failed:", err);
    return "Sorry — I could not reach our systems just then. A human will pick this up shortly.";
  }
}
