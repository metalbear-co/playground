/**
 * Builds the labeled eval dataset from a catalogue snapshot.
 *
 * The label for each case is the terminal tool call the shopping agent should
 * make, with its arguments computed from the snapshot this script is pointed at.
 *
 * That coupling is the point of the demo. Run it against the frozen fixture and
 * the labels agree with the stubs by construction — including everywhere both
 * have drifted away from what the cluster now holds. Run it against live staging
 * (through mirrord) and the labels describe reality.
 *
 * Usage:
 *   npx tsx eval/dataset/generate.ts \
 *     --catalogue eval/fixtures/catalogue-2026-03-16.json \
 *     --out eval/dataset/shopping-agent-v1.jsonl
 *
 * Generation is deterministic: cases are enumerated, never sampled, so the same
 * catalogue always produces the same dataset in the same order.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Product } from "../../src/agent/types.js";
import type { EvalCase } from "../types.js";

// ---------------------------------------------------------------- catalogue

type Kind = "sticker" | "t-shirt" | "other";

function kindOf(p: Product): Kind {
  const n = p.name.toLowerCase();
  if (n.includes("sticker")) return "sticker";
  if (n.includes("t-shirt") || n.includes("tee")) return "t-shirt";
  return "other";
}

/** "Mind The Gap T-Shirt" -> "mind the gap"; the part shared across a family. */
function familyOf(p: Product): string {
  return p.name
    .toLowerCase()
    .replace(/\b(sticker|t-shirt|tee|hoodie|mug|cap|plush|notebook|keychain|tote bag|tote)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ------------------------------------------------------------------ helpers

const cases: EvalCase[] = [];
/** Case classes the catalogue could not express, reported rather than dropped silently. */
const skipped: string[] = [];
let seq = 0;

function add(c: Omit<EvalCase, "id">): void {
  cases.push({ id: `case-${String(++seq).padStart(4, "0")}`, ...c });
}

function order(items: Array<[Product, number]>): EvalCase["expected"] {
  return {
    tool: "place_order",
    args: {
      items: items.map(([p, q]) => ({ productId: p.id, quantity: q })),
      total_cents: items.reduce((sum, [p, q]) => sum + p.price_cents * q, 0),
    },
  };
}

function alternative(p: Product, reason: string): EvalCase["expected"] {
  return { tool: "offer_alternative", args: { product_id: p.id, reason } };
}

// ------------------------------------------------------------------- build

function build(catalogue: Product[]): EvalCase[] {
  const inStock = catalogue.filter((p) => p.stock > 0);
  const stickers = inStock.filter((p) => kindOf(p) === "sticker");
  const shirts = inStock.filter((p) => kindOf(p) === "t-shirt");

  // Deterministic ordering everywhere below.
  const byId = [...inStock].sort((a, b) => a.id - b.id);
  const byPrice = [...inStock].sort((a, b) => a.price_cents - b.price_cents || a.id - b.id);

  // -- A. exact name (place_order, exact) ----------------------------------
  const exactPhrasings = [
    (n: string) => `I'd like a ${n}, please.`,
    (n: string) => `Can you add one ${n} to my order?`,
    (n: string) => `Put a ${n} in my basket.`,
  ];
  for (const p of byId) {
    for (const phrase of exactPhrasings) {
      add({ input: phrase(p.name), expected: order([[p, 1]]), scoring: "exact", tag: "exact-name" });
    }
  }

  // -- B. fuzzy name (place_order, exact) ----------------------------------
  // Strip the product-type word so the agent has to resolve a partial name.
  for (const p of byId) {
    const partial = familyOf(p) || p.name.toLowerCase();
    const noun = kindOf(p) === "sticker" ? "sticker" : kindOf(p) === "t-shirt" ? "shirt" : "one";
    add({ input: `Do you have the ${partial} ${noun}? I'll take one.`, expected: order([[p, 1]]), scoring: "exact", tag: "fuzzy-name" });
    add({ input: `one ${partial} please`, expected: order([[p, 1]]), scoring: "exact", tag: "fuzzy-name" });
    add({ input: `looking for that ${partial} ${noun} everyone has`, expected: order([[p, 1]]), scoring: "exact", tag: "fuzzy-name" });
  }

  // -- C. multi-item (place_order, exact) ----------------------------------
  for (let i = 0; i < byId.length; i++) {
    for (const gap of [1, 2, 3]) {
      const a = byId[i];
      const b = byId[(i + gap) % byId.length];
      if (a.id === b.id) continue;
      add({ input: `I want a ${a.name} and a ${b.name}.`, expected: order([[a, 1], [b, 1]]), scoring: "exact", tag: "multi-item" });
      if (gap === 1) {
        add({ input: `Two ${a.name} and one ${b.name}, thanks.`, expected: order([[a, 2], [b, 1]]), scoring: "exact", tag: "multi-item" });
        const c = byId[(i + 3) % byId.length];
        if (c.id !== a.id && c.id !== b.id) {
          add({ input: `Order me a ${a.name}, a ${b.name} and a ${c.name}.`,
            expected: order([[a, 1], [b, 1], [c, 1]]), scoring: "exact", tag: "multi-item" });
        }
      }
    }
  }

  // -- D. quantity words (place_order, exact) ------------------------------
  const quantities: Array<[string, number]> = [
    ["a couple of", 2], ["three", 3], ["half a dozen", 6], ["four", 4], ["a pair of", 2], ["ten", 10],
  ];
  for (const [phrase, qty] of quantities) {
    for (const p of byId.filter((x) => x.stock >= qty).slice(0, 6)) {
      add({ input: `Can I get ${phrase} ${p.name}?`, expected: order([[p, qty]]), scoring: "exact", tag: "quantity-words" });
    }
  }

  // -- E. budget (place_order, exact) --------------------------------------
  // The cheapest item overall, and the cheapest within a kind. Both are
  // single-answer only when there is no price tie; ties are skipped rather
  // than labelled arbitrarily.
  const cheapestUnique = (pool: Product[]): Product | null => {
    const sorted = [...pool].sort((a, b) => a.price_cents - b.price_cents || a.id - b.id);
    if (sorted.length === 0) return null;
    if (sorted.length > 1 && sorted[0].price_cents === sorted[1].price_cents) return null;
    return sorted[0];
  };

  for (const [label, pool] of [["overall", inStock], ["sticker", stickers], ["shirt", shirts]] as const) {
    const winner = cheapestUnique(pool as Product[]);
    if (!winner) {
      skipped.push(`budget-cheapest/${label}: price tie, no single defensible answer`);
      continue;
    }
    const noun = label === "overall" ? "thing" : label;
    add({ input: `What's the cheapest ${noun} you sell? I'll take it.`, expected: order([[winner, 1]]), scoring: "exact", tag: "budget-cheapest" });
    add({ input: `I'm on a budget — send me your least expensive ${noun}.`, expected: order([[winner, 1]]), scoring: "exact", tag: "budget-cheapest" });
  }

  // Budget ceilings. Under a cap, buy the dearest item that still fits — a
  // single answer whenever that price is unique in the catalogue.
  for (const cap of [1000, 2000, 3000, 5000]) {
    const affordable = byPrice.filter((p) => p.price_cents <= cap);
    if (affordable.length === 0) continue;
    const best = affordable[affordable.length - 1];
    if (affordable.filter((p) => p.price_cents === best.price_cents).length > 1) {
      skipped.push(`budget-ceiling/${money(cap)}: price tie, no single defensible answer`);
      continue;
    }
    add({ input: `I've got ${money(cap)} to spend. Get me the best thing that fits.`,
      expected: order([[best, 1]]), scoring: "exact", tag: "budget-ceiling" });
    add({ input: `Nothing over ${money(cap)} please — what's the nicest option in that range?`,
      expected: order([[best, 1]]), scoring: "exact", tag: "budget-ceiling" });
  }

  // -- F. quantity boundary (exact) ----------------------------------------
  // At exactly the stock level the order stands; one over and it cannot.
  // These are the cases stock drift moves.
  for (const p of byId.slice(0, 8)) {
    add({ input: `I need ${p.stock} of the ${p.name} for an event.`,
      expected: order([[p, p.stock]]), scoring: "exact", tag: "quantity-at-stock" });

    const sameKind = inStock.filter((x) => x.id !== p.id && kindOf(x) === kindOf(p));
    const fallback = [...sameKind].sort((a, b) => b.stock - a.stock || a.id - b.id)[0];
    if (fallback) {
      // Scored on the action, not the substitute. Which same-kind product to
      // offer is a tiebreak between near-identical items — the stickers share a
      // price and differ by a unit or two of stock, so "most stock" is a rule
      // the agent has no way to infer and no customer would care about. The
      // drift signal lives in the action flipping between place_order and
      // offer_alternative as stock moves, and that is what this scores.
      add({ input: `I need ${p.stock + 25} of the ${p.name} for an event.`,
        expected: alternative(fallback, `only ${p.stock} of the ${p.name} are in stock`),
        scoring: "tool", tag: "quantity-over-stock" });
    }
  }

  // -- G. family variant that does not exist (offer_alternative, exact) ----
  // "a Mind The Gap hoodie" — the family exists, that variant does not, and the
  // family has exactly one member, so the substitute is not a matter of taste.
  const missingVariants = ["hoodie", "mug", "cap", "poster"];
  for (const p of byId) {
    const family = familyOf(p);
    if (!family) continue;
    const familyMembers = inStock.filter((x) => familyOf(x) === family);
    if (familyMembers.length !== 1) continue;
    for (const variant of missingVariants) {
      add({ input: `Do you sell a ${family} ${variant}?`,
        expected: alternative(p, `no ${family} ${variant} in the catalogue`),
        scoring: "exact", tag: "variant-missing" });
    }
  }

  // -- H. product kind absent entirely (offer_alternative, tool) -----------
  // Scored on the action only: when nothing of that kind exists, several
  // substitutes are equally defensible.
  for (const kind of ["mug", "hoodie", "keychain", "tote bag", "notebook", "cap", "plush toy"]) {
    const exists = inStock.some((p) => p.name.toLowerCase().includes(kind.split(" ")[0]));
    if (exists) continue;
    add({ input: `I'm looking for a ${kind} — what have you got?`,
      expected: alternative(byPrice[0], `no ${kind} in the catalogue`), scoring: "tool", tag: "kind-missing" });
    add({ input: `Any chance you sell a ${kind}?`,
      expected: alternative(byPrice[0], `no ${kind} in the catalogue`), scoring: "tool", tag: "kind-missing" });
  }

  // -- I. refunds (issue_refund, exact) ------------------------------------
  const complaints = [
    "arrived damaged", "never showed up", "is the wrong size",
    "came with a print defect", "arrived with a torn package",
  ];
  for (let i = 0; i < 30; i++) {
    const orderId = 1000 + i;
    const complaint = complaints[i % complaints.length];
    add({ input: `My order #${orderId} ${complaint}. Can I get my money back?`,
      expected: { tool: "issue_refund", args: { order_id: orderId, reason: complaint } },
      scoring: "exact", tag: "refund" });
  }

  return cases;
}

// -------------------------------------------------------------------- main

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const cataloguePath = arg("catalogue", "eval/fixtures/catalogue-2026-03-16.json");
const outPath = arg("out", "eval/dataset/shopping-agent-v1.jsonl");

const catalogue: Product[] = JSON.parse(readFileSync(cataloguePath, "utf-8"));
const built = build(catalogue);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, built.map((c) => JSON.stringify(c)).join("\n") + "\n");

const byTag = built.reduce<Record<string, number>>((acc, c) => {
  acc[c.tag] = (acc[c.tag] ?? 0) + 1;
  return acc;
}, {});

console.log(`catalogue : ${cataloguePath} (${catalogue.length} products)`);
console.log(`dataset   : ${outPath} (${built.length} cases)\n`);
for (const [tag, n] of Object.entries(byTag).sort()) {
  console.log(`  ${tag.padEnd(20)} ${String(n).padStart(4)}`);
}
const terminals = built.reduce<Record<string, number>>((acc, c) => {
  acc[c.expected.tool] = (acc[c.expected.tool] ?? 0) + 1;
  return acc;
}, {});
if (skipped.length > 0) {
  console.log(`\n  ${skipped.length} case classes skipped (catalogue cannot express them):`);
  for (const s of skipped) console.log(`    - ${s}`);
}
console.log("\n  terminal tool distribution:");
for (const [tool, n] of Object.entries(terminals).sort()) {
  console.log(`  ${tool.padEnd(20)} ${String(n).padStart(4)}`);
}
