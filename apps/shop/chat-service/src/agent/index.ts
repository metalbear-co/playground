import { depsFromEnv } from "./deps.js";
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

/** Turns an agent result into something worth showing the customer. */
export function replyText(result: AgentResult): string {
  if (result.reply) return result.reply;
  switch (result.finalCall?.tool) {
    case "place_order":
      return "Done — your order is on its way.";
    case "offer_alternative":
      return "That one is not available, but I found something close.";
    case "issue_refund":
      return "Sorry about that — I have started your refund.";
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
    const result = await runShoppingAgent({
      message: opts.message,
      history: opts.history,
      deps: depsFromEnv(opts.baggage),
      execute: agentExecutes(),
      baggage: opts.baggage,
    });
    console.log(
      "[agent] %s -> %s (%d steps)",
      result.stopReason,
      result.finalCall?.tool ?? "none",
      result.trace.length
    );
    return replyText(result);
  } catch (err) {
    console.error("[agent] failed:", err);
    return "Sorry — I could not reach our systems just then. A human will pick this up shortly.";
  }
}
