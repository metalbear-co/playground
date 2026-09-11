/**
 * Prints the dataset in a form you can read off a screen.
 *
 * The scorecard says how many cases passed; it never says what a case is. This
 * shows what the suite actually asserts — a customer message, and the tool call
 * the agent is expected to end its turn with — so the score means something to
 * someone seeing it for the first time.
 *
 *   npm run eval:show              one case per class
 *   npm run eval:show -- --tag kind-missing --limit 4
 */
import { readFileSync } from "node:fs";
import type { EvalCase } from "./types.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const datasetPath = arg("dataset", "eval/dataset/shopping-agent-v1.jsonl");
const tagFilter = arg("tag", "");
const perTag = Number(arg("limit", "1"));

const cases: EvalCase[] = readFileSync(datasetPath, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The label, written the way a person would say it rather than as JSON. */
function expectation(c: EvalCase): string {
  const e = c.expected;
  switch (e.tool) {
    case "place_order": {
      const items = e.args.items.map((i) => `${i.quantity} x #${i.productId}`).join(", ");
      return `place_order  ${items}  total ${money(e.args.total_cents)}`;
    }
    case "offer_alternative":
      return `offer_alternative  product #${e.args.product_id}`;
    case "issue_refund":
      return `issue_refund  order #${e.args.order_id}`;
  }
}

const byTag = new Map<string, EvalCase[]>();
for (const c of cases) {
  if (tagFilter && c.tag !== tagFilter) continue;
  const bucket = byTag.get(c.tag) ?? [];
  bucket.push(c);
  byTag.set(c.tag, bucket);
}

console.log(`\n${cases.length} cases across ${new Set(cases.map((c) => c.tag)).size} classes`);
console.log(`each labelled with the tool call the agent should finish its turn with\n`);

for (const [tag, group] of [...byTag].sort()) {
  console.log(`\x1b[1m${tag}\x1b[0m  (${group.length} cases)`);
  for (const c of group.slice(0, perTag)) {
    // Scoring is worth showing: `tool` means the action is the assertion and
    // the argument is a judgement call, which is otherwise invisible.
    console.log(`  customer  "${c.input}"`);
    console.log(`  expected  ${expectation(c)}`);
    console.log(`  scored on ${c.scoring === "exact" ? "tool + arguments" : "tool only"}\n`);
  }
}
