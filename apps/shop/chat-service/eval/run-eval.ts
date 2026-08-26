/**
 * Runs the labeled dataset against the shopping agent and scores it.
 *
 * The command is deliberately identical in both halves of the demo:
 *
 *   npm run eval                          # stubbed — no service URLs in the env
 *   mirrord ci start -- npm run eval      # live — URLs arrive from the target pod
 *
 * Nothing here inspects mirrord, and there is no --stub flag. Dependency choice
 * happens in depsFromEnv(): service URLs present means live, absent means the
 * frozen fixture. That is what lets the CI step stay byte-identical between runs
 * while the score moves.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { depsFromEnv } from "../src/agent/deps.js";
import { runShoppingAgent } from "../src/agent/loop.js";
import { judge } from "./judge.js";
import { renderReport } from "./report.js";
import type { CaseResult, EvalCase, EvalSummary } from "./types.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const datasetPath = arg("dataset", "eval/dataset/shopping-agent-v1.jsonl");
const threshold = Number(arg("threshold", "0.85"));
const concurrency = Number(arg("concurrency", process.env.EVAL_CONCURRENCY ?? "8"));
const limit = Number(arg("limit", "0"));
const outPath = arg("out", "eval/results/latest.json");

/**
 * Takes an even spread across case classes rather than the first N.
 *
 * The dataset is grouped by class, so a plain slice would be entirely
 * exact-name — the easiest class — and a subset run would report a score that
 * says nothing about the hard cases. Round-robins the classes instead, in
 * order, so a subset stays deterministic and representative.
 */
function stratify(cases: EvalCase[], n: number): EvalCase[] {
  if (n >= cases.length) return cases;
  const byTag = new Map<string, EvalCase[]>();
  for (const c of cases) {
    const bucket = byTag.get(c.tag);
    if (bucket) bucket.push(c);
    else byTag.set(c.tag, [c]);
  }
  const buckets = [...byTag.values()];
  const picked: EvalCase[] = [];
  for (let round = 0; picked.length < n; round++) {
    let addedThisRound = false;
    for (const bucket of buckets) {
      if (round >= bucket.length) continue;
      picked.push(bucket[round]);
      addedThisRound = true;
      if (picked.length === n) break;
    }
    if (!addedThisRound) break;
  }
  // Restore dataset order so results read predictably.
  const chosen = new Set(picked.map((c) => c.id));
  return cases.filter((c) => chosen.has(c.id));
}

/** Runs tasks with a fixed number in flight, preserving input order in the output. */
async function mapWithConcurrency<T, R>(
  items: T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const cases: EvalCase[] = readFileSync(datasetPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  const selected = limit > 0 ? stratify(cases, limit) : cases;
  const deps = depsFromEnv();
  const client = new Anthropic();

  console.log(
    `running ${selected.length} cases against ${deps.kind.toUpperCase()} dependencies ` +
      `(concurrency ${concurrency}, gate ${(threshold * 100).toFixed(0)}%)\n`
  );

  let done = 0;
  const results = await mapWithConcurrency(selected, concurrency, async (c) => {
    let result: CaseResult;
    try {
      const run = await runShoppingAgent({ message: c.input, deps, client, execute: false });
      result = judge(c, run.finalCall, { steps: run.trace.length });
    } catch (err) {
      result = judge(c, null, { steps: 0, error: err instanceof Error ? err.message : String(err) });
    }
    done++;
    process.stdout.write(
      `\r  ${done}/${selected.length}  ${result.passed ? "." : "x"}`.padEnd(40)
    );
    return result;
  });
  process.stdout.write("\n\n");

  const passed = results.filter((r) => r.passed).length;
  const byTag: EvalSummary["byTag"] = {};
  const failureModes: EvalSummary["failureModes"] = {};
  for (const r of results) {
    const tag = (byTag[r.case.tag] ??= { total: 0, passed: 0 });
    tag.total++;
    if (r.passed) tag.passed++;
    else {
      // Group on the label, not the parenthesised detail, so the tally is short.
      const mode = r.reason.split(" (")[0];
      failureModes[mode] = (failureModes[mode] ?? 0) + 1;
    }
  }

  const accuracy = selected.length === 0 ? 0 : passed / selected.length;
  const summary: EvalSummary = {
    depsKind: deps.kind,
    total: selected.length,
    passed,
    accuracy,
    toolAccuracy:
      selected.length === 0 ? 0 : results.filter((r) => r.toolCorrect).length / selected.length,
    threshold,
    gate: accuracy >= threshold ? "pass" : "fail",
    byTag,
    failureModes,
  };

  const report = renderReport(summary, results);
  console.log(report);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`\nfull results: ${outPath}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n", { flag: "a" });
  }

  process.exit(summary.gate === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error("eval run failed:", err);
  process.exit(2);
});
