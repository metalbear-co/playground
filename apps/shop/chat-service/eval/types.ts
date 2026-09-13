import type { TerminalCall } from "../src/agent/types.js";

/**
 * How strictly a case is judged.
 *
 * `exact`  — tool name and every argument must match. Used wherever the case has
 *            one defensible answer: a computed order total, a specific order id,
 *            a product family with exactly one member.
 * `tool`   — only the tool name must match. Used where the right *action* is
 *            unambiguous but the specific argument is a judgement call — chiefly
 *            "we don't sell that, offer something else", where any of several
 *            products would be a reasonable substitute. Scoring these on the
 *            argument would measure taste, not correctness.
 * `request` — tool name plus `instead_of`: the request the agent could not
 *            fill. Splits an offer_alternative case into the half that has a
 *            right answer (which request was unfillable) and the half that does
 *            not (which substitute to offer), and scores only the first.
 */
export type Scoring = "exact" | "tool" | "request";

export type EvalCase = {
  id: string;
  /** What the customer types into the support chat. */
  input: string;
  expected: TerminalCall;
  scoring: Scoring;
  /** Case class, used to break the score down by failure mode in the report. */
  tag: string;
};

export type CaseResult = {
  case: EvalCase;
  actual: TerminalCall | null;
  toolCorrect: boolean;
  /** Under `tool` scoring this equals toolCorrect. */
  passed: boolean;
  reason: string;
  steps: number;
  error?: string;
};

export type EvalSummary = {
  depsKind: "live" | "stub";
  total: number;
  passed: number;
  accuracy: number;
  toolAccuracy: number;
  threshold: number;
  gate: "pass" | "fail";
  byTag: Record<string, { total: number; passed: number }>;
  failureModes: Record<string, number>;
};
