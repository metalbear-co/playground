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

  // -- F. bulk orders beyond any plausible stock (offer_alternative, tool) --
  //
  // A conference-sized quantity nobody carries. The number is chosen to exceed
  // every product's stock rather than read off any snapshot, which is what
  // makes these cases worth having: they test whether the agent verifies stock
  // before committing, and they answer the same way whatever the catalogue is
  // doing. A case whose expected answer moves with the data tests the fixture,
  // not the agent.
  //
  // An earlier revision generated "I need <stock> of X" and "I need <stock>+25
  // of X" straight from the snapshot's own counts. Those failed the moment
  // stock moved, which looked like drift detection but was circular — and no
  // one writes a test asking for exactly the number of units in the warehouse.
  const bulkPhrasings: Array<(n: string, q: number) => string> = [
    (n, q) => `I need ${q} ${n}s for a conference next month.`,
    (n, q) => `Can you do a bulk order — ${q} of the ${n}?`,
    (n, q) => `We want ${q} ${n}s for an event. Possible?`,
  ];
  // A flat constant, not derived from the snapshot. Deriving it — max stock plus
  // a margin — reintroduces exactly the coupling these cases exist to avoid: the
  // figure would sit above stock in the snapshot it was computed from and below
  // it in a catalogue that has since restocked, so the expected answer would
  // flip with the data. 5000 units of a sticker is beyond any merch shop, which
  // is the property that has to hold in every catalogue.
  const beyondAnyStock = 5000;
  for (const p of byId) {
    for (const phrase of bulkPhrasings) {
      // Scored on the action alone. Which substitute to offer when nothing can
      // fill the order is a judgement call between comparable products, and
      // scoring it would measure taste rather than correctness.
      add({
        input: phrase(p.name, beyondAnyStock),
        expected: alternative(p, `no product has ${beyondAnyStock} units available`),
        scoring: "tool",
        tag: "bulk-beyond-stock",
      });
    }
  }

  // -- H. product kind absent entirely (offer_alternative, tool) -----------
  // Scored on the action only: when nothing of that kind exists, several
  // substitutes are equally defensible.
  const kindPhrasings = [
    (k: string) => `I'm looking for a ${k} — what have you got?`,
    (k: string) => `Any chance you sell a ${k}?`,
    (k: string) => `Do you do ${k}s?`,
  ];
  for (const kind of ["mug", "hoodie", "keychain", "tote bag", "notebook", "cap", "plush toy", "poster", "water bottle"]) {
    const exists = inStock.some((p) => p.name.toLowerCase().includes(kind.split(" ")[0]));
    if (exists) continue;
    for (const phrase of kindPhrasings) {
      add({ input: phrase(kind),
        expected: alternative(byPrice[0], `no ${kind} in the catalogue`), scoring: "tool", tag: "kind-missing" });
    }
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
const perClass = Number(arg("per-class", "6"));

/**
 * Caps every case class to the same size.
 *
 * Enumerating whatever each class can produce is not a balanced suite: the
 * lookup-and-multiply classes generate combinatorially many cases while the
 * interesting ones (stock boundaries, products we do not stock) are bounded by
 * the catalogue. Left uncapped they outnumber everything else two to one, and
 * the headline score mostly measures arithmetic the agent was never going to
 * get wrong.
 *
 * Taking the first N of each class in generation order keeps this deterministic
 * and keeps the suite small enough to run in front of an audience.
 */
function balance(all: EvalCase[], n: number): EvalCase[] {
  const byTag = new Map<string, EvalCase[]>();
  for (const c of all) {
    const bucket = byTag.get(c.tag);
    if (bucket) bucket.push(c);
    else byTag.set(c.tag, [c]);
  }

  // Spread the sample across each class rather than taking its first N. Cases
  // are generated in product order, so a prefix silently drops every
  // high-numbered product — a suite capped low would omit whole products and
  // any drift affecting them, which looks like the agent improving. Striding
  // keeps the product range intact at every size.
  const kept: EvalCase[] = [];
  for (const bucket of byTag.values()) {
    if (bucket.length <= n) {
      kept.push(...bucket);
      continue;
    }
    const stride = bucket.length / n;
    for (let i = 0; i < n; i++) kept.push(bucket[Math.floor(i * stride)]);
  }
  kept.sort((a, b) => a.id.localeCompare(b.id));
  // Renumber so ids stay contiguous and stable for a given catalogue + N.
  return kept.map((c, i) => ({ ...c, id: `case-${String(i + 1).padStart(4, "0")}` }));
}

const catalogue: Product[] = JSON.parse(readFileSync(cataloguePath, "utf-8"));
const built = balance(build(catalogue), perClass);

const short = Object.entries(
  built.reduce<Record<string, number>>((a, c) => ((a[c.tag] = (a[c.tag] ?? 0) + 1), a), {})
).filter(([, n]) => n < perClass);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, built.map((c) => JSON.stringify(c)).join("\n") + "\n");

const byTag = built.reduce<Record<string, number>>((acc, c) => {
  acc[c.tag] = (acc[c.tag] ?? 0) + 1;
  return acc;
}, {});

console.log(`catalogue : ${cataloguePath} (${catalogue.length} products)`);
console.log(`dataset   : ${outPath} (${built.length} cases, ${perClass} per class)\n`);
for (const [tag, n] of Object.entries(byTag).sort()) {
  console.log(`  ${tag.padEnd(20)} ${String(n).padStart(4)}`);
}
const terminals = built.reduce<Record<string, number>>((acc, c) => {
  acc[c.expected.tool] = (acc[c.expected.tool] ?? 0) + 1;
  return acc;
}, {});
if (short.length > 0) {
  console.log(`\n  classes the catalogue could not fill to ${perClass}:`);
  for (const [tag, n] of short) console.log(`    - ${tag}: only ${n}`);
}
if (skipped.length > 0) {
  console.log(`\n  ${skipped.length} case classes skipped (catalogue cannot express them):`);
  for (const s of skipped) console.log(`    - ${s}`);
}
console.log("\n  terminal tool distribution:");
for (const [tool, n] of Object.entries(terminals).sort()) {
  console.log(`  ${tool.padEnd(20)} ${String(n).padStart(4)}`);
}
