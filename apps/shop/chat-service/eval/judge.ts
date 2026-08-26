import type { OrderItem, TerminalCall } from "../src/agent/types.js";
import type { EvalCase, CaseResult } from "./types.js";

/**
 * Code-based judge.
 *
 * There is no model in the loop here: a case passes when the shopping agent's
 * final tool call matches the label. That makes a score reproducible and makes
 * every failure explainable in one line, which is what the CI gate needs.
 */

/** Sorts by product and merges repeats, so item order and splitting never matter. */
export function canonicalItems(items: OrderItem[]): OrderItem[] {
  const merged = new Map<number, number>();
  for (const item of items ?? []) {
    const id = Number(item?.productId);
    const qty = Number(item?.quantity);
    if (!Number.isFinite(id) || !Number.isFinite(qty)) continue;
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  return [...merged.entries()]
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([productId, quantity]) => ({ productId, quantity }));
}

const sameItems = (a: OrderItem[], b: OrderItem[]): boolean =>
  JSON.stringify(canonicalItems(a)) === JSON.stringify(canonicalItems(b));

/**
 * Why a case failed, in a form worth putting on a slide.
 *
 * `reason` is a short label; the failure-mode tally in the report groups on it.
 */
function compare(expected: TerminalCall, actual: TerminalCall): { passed: boolean; reason: string } {
  if (expected.tool !== actual.tool) {
    return { passed: false, reason: `wrong-tool (${actual.tool} instead of ${expected.tool})` };
  }

  switch (expected.tool) {
    case "place_order": {
      const act = actual.args as typeof expected.args;
      const itemsMatch = sameItems(expected.args.items, act.items);
      const totalMatch = Number(act.total_cents) === expected.args.total_cents;
      if (itemsMatch && totalMatch) return { passed: true, reason: "ok" };
      if (itemsMatch && !totalMatch) {
        return {
          passed: false,
          reason: `wrong-total (${act.total_cents} vs ${expected.args.total_cents})`,
        };
      }
      if (!itemsMatch && totalMatch) return { passed: false, reason: "wrong-items" };
      return { passed: false, reason: "wrong-items-and-total" };
    }
    case "offer_alternative": {
      const act = actual.args as typeof expected.args;
      return Number(act.product_id) === expected.args.product_id
        ? { passed: true, reason: "ok" }
        : { passed: false, reason: `wrong-alternative (${act.product_id} vs ${expected.args.product_id})` };
    }
    case "issue_refund": {
      const act = actual.args as typeof expected.args;
      return Number(act.order_id) === expected.args.order_id
        ? { passed: true, reason: "ok" }
        : { passed: false, reason: `wrong-order-id (${act.order_id} vs ${expected.args.order_id})` };
    }
  }
}

export function judge(
  evalCase: EvalCase,
  actual: TerminalCall | null,
  opts: { steps: number; error?: string }
): CaseResult {
  const base = { case: evalCase, actual, steps: opts.steps, ...(opts.error ? { error: opts.error } : {}) };

  if (opts.error) {
    return { ...base, toolCorrect: false, passed: false, reason: "error" };
  }
  if (!actual) {
    return { ...base, toolCorrect: false, passed: false, reason: "no-decision" };
  }

  const toolCorrect = actual.tool === evalCase.expected.tool;

  // `tool` scoring is for cases where the right action is clear but the specific
  // argument is a judgement call — see the note on Scoring in types.ts.
  if (evalCase.scoring === "tool") {
    return {
      ...base,
      toolCorrect,
      passed: toolCorrect,
      reason: toolCorrect ? "ok" : `wrong-tool (${actual.tool} instead of ${evalCase.expected.tool})`,
    };
  }

  const { passed, reason } = compare(evalCase.expected, actual);
  return { ...base, toolCorrect, passed, reason };
}
