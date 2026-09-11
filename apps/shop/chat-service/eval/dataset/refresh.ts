/**
 * Re-derives the eval labels from the catalogue the cluster actually holds.
 *
 * The dataset ships with labels computed from a fixture frozen in March. Prices,
 * stock and the product range have all moved since, so those labels describe a
 * shop that no longer exists — and a run against real dependencies fails cases
 * where the agent was right and the label was stale.
 *
 * The fix is not to freeze a newer fixture, which only resets the clock. It is
 * to derive the labels from the running system, which is exactly what needs a
 * connection to it:
 *
 *   mirrord exec --config-file .mirrord/agent-evals.json -- npm run eval:refresh
 *
 * Outside a session INVENTORY_SERVICE_URL is unset, there is nothing to read,
 * and this refuses rather than quietly rewriting labels from the same stale
 * fixture it is meant to replace.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveDeps } from "../../src/agent/deps.js";

/**
 * The largest per-class count in an existing dataset, or null if there is none.
 *
 * The generator caps every class at the same size, so the biggest class is the
 * cap that produced the file — except where the catalogue could not fill a
 * class, which is why this takes the maximum rather than any single class.
 */
function existingPerClass(path: string): number | null {
  try {
    const counts = new Map<string, number>();
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const tag = JSON.parse(line).tag as string;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts.size === 0 ? null : Math.max(...counts.values());
  } catch {
    return null;
  }
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const inventoryUrl = process.env.INVENTORY_SERVICE_URL?.trim();
  const orderUrl = process.env.ORDER_SERVICE_URL?.trim();

  if (!inventoryUrl || !orderUrl) {
    console.error(
      "refusing to refresh: INVENTORY_SERVICE_URL / ORDER_SERVICE_URL are unset.\n" +
        "Labels have to come from the running cluster, so run this inside a session:\n" +
        "  mirrord exec --config-file ../../../.mirrord/agent-evals.json -- npm run eval:refresh"
    );
    process.exit(1);
  }

  const outPath = arg("out", "eval/dataset/shopping-agent-v1.jsonl");

  // Refreshing replaces the labels, not the shape of the suite. Taking the
  // per-class size from the dataset already on disk keeps the case count
  // stable across a refresh; a fixed default would silently resize the suite
  // and make the before and after runs incomparable.
  const perClass = arg("per-class", String(existingPerClass(outPath) ?? 6));

  console.log(`reading the live catalogue from ${inventoryUrl}`);
  const products = await liveDeps({ inventoryUrl, orderUrl }).listProducts();
  if (products.length === 0) {
    console.error("the catalogue came back empty — refusing to write labels from it");
    process.exit(1);
  }

  const prices = [...new Set(products.map((p) => p.price_cents))].sort((a, b) => a - b);
  console.log(
    `  ${products.length} products, ${prices.length} price points ` +
      `(${prices[0]}–${prices[prices.length - 1]})`
  );

  // The generator takes a catalogue snapshot on disk, so hand it what the
  // cluster just returned rather than anything checked in.
  const snapshot = join(mkdtempSync(join(tmpdir(), "eval-refresh-")), "catalogue.json");
  writeFileSync(snapshot, JSON.stringify(products, null, 2));

  console.log("regenerating labels from it\n");
  execFileSync(
    "npx",
    ["tsx", "eval/dataset/generate.ts", "--catalogue", snapshot, "--out", outPath, "--per-class", perClass],
    { stdio: "inherit" }
  );

  console.log(`\nlabels now describe the cluster, not the March fixture.`);
}

main().catch((err) => {
  console.error("refresh failed:", err);
  process.exit(1);
});
