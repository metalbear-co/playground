import Anthropic from "@anthropic-ai/sdk";
import type { ShopDeps } from "./deps.js";
import { asTerminalCall, runReadTool, TOOLS } from "./tools.js";
import type { AgentResult, TraceStep } from "./types.js";

const MODEL = process.env.SHOPPING_AGENT_MODEL?.trim() || "claude-opus-5";
const MAX_STEPS = Number(process.env.SHOPPING_AGENT_MAX_STEPS ?? 12);

const SYSTEM_PROMPT = `You are the shopping assistant for Metal Mart, an online shop selling MetalBear merchandise.

A customer writes to you in the support chat. Work out what they want, look up whatever you need, and finish by calling exactly one of these tools:

- place_order — you know what they want and it is available
- offer_alternative — what they asked for is unavailable, short of the quantity they need, or not in the catalogue
- issue_refund — they have a problem with an order they already received

Rules:
- Never guess a price or a stock level. Look them up.
- Refunds work off the order number the customer gives you. Look the order up if you can, but our records are incomplete and a failed lookup is not a reason to refuse — refund the number they gave.
- total_cents must equal the sum of each product's real price times its quantity.
- Check stock before ordering more than one of anything.
- When the customer sets a budget, respect it — check prices before committing.
- When several products could match, prefer the closest one by kind, then by price.
- Write one short, friendly sentence to the customer alongside your final tool call.`;

/**
 * Runs the shopping agent over one customer message.
 *
 * This is a hand-written loop rather than the SDK's tool runner because the eval
 * needs to stop *at* the terminal tool call and inspect its arguments without
 * executing it — the label for each case is the call itself. The runner executes
 * every tool it sees, which would make read-only scoring awkward and would put a
 * beta dependency on the demo path.
 */
export async function runShoppingAgent(opts: {
  message: string;
  /** Earlier turns of the same conversation, oldest first. Empty for eval cases. */
  history?: Array<{ sender: "customer" | "agent" | "bot"; text: string }>;
  deps: ShopDeps;
  client?: Anthropic;
  /** When true, a place_order terminal call is actually sent to order-service. */
  execute?: boolean;
  baggage?: string;
}): Promise<AgentResult> {
  const client = opts.client ?? new Anthropic();
  const trace: TraceStep[] = [];

  // Consecutive turns from the same side are merged: the Messages API requires
  // strictly alternating roles, and a chat thread does not guarantee that.
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of [...(opts.history ?? []), { sender: "customer" as const, text: opts.message }]) {
    if (!turn.text.trim()) continue;
    const role = turn.sender === "customer" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last?.role === role) {
      last.content = `${last.content}\n\n${turn.text}`;
    } else {
      messages.push({ role, content: turn.text });
    }
  }
  if (messages.length === 0 || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: opts.message });
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { reply: null, finalCall: null, trace, stopReason: "refusal" };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      // The agent answered without committing to an action. That is a failure
      // for scoring purposes, but a legitimate thing for it to do.
      return { reply: text || null, finalCall: null, trace, stopReason: "end_turn" };
    }

    // A terminal tool ends the turn even if the model asked for others alongside it.
    for (const use of toolUses) {
      const terminal = asTerminalCall(use.name, use.input);
      if (!terminal) continue;

      trace.push({ tool: use.name, input: use.input });

      if (opts.execute && terminal.tool === "place_order") {
        try {
          const placed = await opts.deps.placeOrder({ ...terminal.args, baggage: opts.baggage });
          trace[trace.length - 1].output = placed;
        } catch (err) {
          trace[trace.length - 1].error = err instanceof Error ? err.message : String(err);
        }
      }

      return { reply: text || null, finalCall: terminal, trace, stopReason: "terminal" };
    }

    messages.push({ role: "assistant", content: response.content });

    // Read tools run concurrently, and every result goes back in one user
    // message — splitting them teaches the model to stop calling tools in parallel.
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        try {
          const output = await runReadTool(use.name, use.input, opts.deps);
          trace.push({ tool: use.name, input: use.input, output });
          return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          trace.push({ tool: use.name, input: use.input, error: message });
          return {
            type: "tool_result",
            tool_use_id: use.id,
            content: `Tool failed: ${message}`,
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: "user", content: results });
  }

  return { reply: null, finalCall: null, trace, stopReason: "max_steps" };
}
