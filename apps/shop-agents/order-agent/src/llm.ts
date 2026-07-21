/**
 * Demo LLM for the shop-agents killer demo.
 *
 * No API key required: a deterministic "model" that follows the system prompt.
 * - LLM_MODE=buggy (default): optimistic prompt → hallucinated shipping copy
 * - LLM_MODE=fixed: grounded prompt → answer matches tool facts
 *
 * Demo beat: see wrong LLM output in the UI → run order-agent locally (mirrord)
 * → flip mode / fix the prompt → re-ask → correct behavior against real shop APIs.
 */

export type LlmMode = "buggy" | "fixed";

export type OrderFacts = {
  orderId: number;
  orderStatus: string;
  items: string;
  total: string;
  placed: string;
  deliveryStatus: string;
};

export type LlmResult = {
  mode: LlmMode;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  rawOutput: string;
  answer: string;
  note: string;
};

export function resolveLlmMode(): LlmMode {
  const raw = (process.env.LLM_MODE || "buggy").toLowerCase();
  return raw === "fixed" ? "fixed" : "buggy";
}

function systemPromptFor(mode: LlmMode): string {
  if (mode === "buggy") {
    // Intentional bug: tells the model to "reassure" and invent shipping progress.
    return [
      "You are MetalMart support. Write a short, confident customer reply.",
      "Be optimistic: if delivery status is unclear or still processing,",
      "tell the customer their package has already shipped and is on the way.",
      "Do not quote raw JSON. Keep it under 80 words.",
    ].join(" ");
  }
  return [
    "You are MetalMart support. Write a short, accurate customer reply.",
    "ONLY use facts from the tool results. Never invent shipping progress.",
    "If delivery is missing or still processing, say fulfillment has not shipped yet.",
    "Do not quote raw JSON. Keep it under 80 words.",
  ].join(" ");
}

function userPromptFor(facts: OrderFacts): string {
  return [
    "Tool results:",
    `- order_id: ${facts.orderId}`,
    `- order_status: ${facts.orderStatus}`,
    `- items: ${facts.items}`,
    `- total: $${facts.total}`,
    `- placed: ${facts.placed}`,
    `- delivery_status: ${facts.deliveryStatus}`,
    "",
    "Write the customer-facing reply.",
  ].join("\n");
}

/** Deterministic stand-in for a hosted LLM — behavior follows the system prompt. */
function runDemoModel(mode: LlmMode, facts: OrderFacts): string {
  if (mode === "buggy") {
    return [
      `Great news about order #${facts.orderId}!`,
      `Your ${facts.items} ($${facts.total}) look confirmed on our side,`,
      `and your package has already shipped — it's on the way to you now.`,
      `Thanks for shopping MetalMart.`,
    ].join(" ");
  }
  const shipping =
    facts.deliveryStatus === "no delivery record yet" ||
    facts.deliveryStatus === "processing"
      ? `Fulfillment status: ${facts.deliveryStatus} — it has not shipped yet.`
      : `Delivery status: ${facts.deliveryStatus}.`;
  return [
    `Order #${facts.orderId} is ${facts.orderStatus}.`,
    `Items: ${facts.items}. Total $${facts.total}, placed ${facts.placed}.`,
    shipping,
  ].join(" ");
}

export async function composeCustomerReply(facts: OrderFacts): Promise<LlmResult> {
  const mode = resolveLlmMode();
  const systemPrompt = systemPromptFor(mode);
  const userPrompt = userPromptFor(facts);
  const started = Date.now();
  // Tiny delay so the trace shows a realistic "llm" hop.
  await new Promise((r) => setTimeout(r, 120));
  const rawOutput = runDemoModel(mode, facts);
  const ms = Date.now() - started;

  return {
    mode,
    model: `demo-llm/${mode}`,
    systemPrompt,
    userPrompt,
    rawOutput,
    answer: rawOutput,
    note:
      mode === "buggy"
        ? `LLM_MODE=buggy (${ms}ms) — prompt encourages hallucinated shipping`
        : `LLM_MODE=fixed (${ms}ms) — grounded on tool facts only`,
  };
}
