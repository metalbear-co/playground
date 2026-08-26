import type { CaseResult, EvalSummary } from "./types.js";

/**
 * Renders a run as markdown.
 *
 * Both halves of the demo print this same shape, so the two runs can be read
 * side by side and the difference is the whole argument. The failure-mode tally
 * matters most: it says *how* the agent was wrong, not just how often.
 */
export function renderReport(summary: EvalSummary, results: CaseResult[]): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const mark = summary.gate === "pass" ? "PASS" : "FAIL";

  const lines: string[] = [];

  lines.push(`## Shopping agent eval — ${summary.depsKind === "live" ? "real dependencies" : "stubbed dependencies"}`);
  lines.push("");
  if (summary.depsKind === "stub") {
    lines.push(
      "> Dependencies were served from a frozen catalogue fixture. This score describes the fixture, not the cluster."
    );
    lines.push("");
  }
  lines.push(`**${mark}** — ${summary.passed}/${summary.total} correct (${pct(summary.accuracy)}), gate ${pct(summary.threshold)}`);
  lines.push("");
  lines.push("| metric | value |");
  lines.push("| --- | --- |");
  lines.push(`| dependencies | ${summary.depsKind} |`);
  lines.push(`| cases | ${summary.total} |`);
  lines.push(`| exact match | ${pct(summary.accuracy)} |`);
  lines.push(`| correct action, any arguments | ${pct(summary.toolAccuracy)} |`);
  lines.push(`| gate | ${pct(summary.threshold)} — ${mark} |`);
  lines.push("");

  lines.push("### By case class");
  lines.push("");
  lines.push("| class | passed | total | rate |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const [tag, s] of Object.entries(summary.byTag).sort()) {
    lines.push(`| ${tag} | ${s.passed} | ${s.total} | ${pct(s.total ? s.passed / s.total : 0)} |`);
  }
  lines.push("");

  const modes = Object.entries(summary.failureModes).sort((a, b) => b[1] - a[1]);
  if (modes.length > 0) {
    lines.push("### How it was wrong");
    lines.push("");
    lines.push("| failure mode | cases |");
    lines.push("| --- | ---: |");
    for (const [mode, n] of modes) lines.push(`| ${mode} | ${n} |`);
    lines.push("");
  }

  const failures = results.filter((r) => !r.passed).slice(0, 15);
  if (failures.length > 0) {
    lines.push("<details><summary>First failures</summary>");
    lines.push("");
    lines.push("| case | input | expected | got | why |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const f of failures) {
      const expected = `${f.case.expected.tool} ${JSON.stringify(f.case.expected.args)}`;
      const got = f.actual ? `${f.actual.tool} ${JSON.stringify(f.actual.args)}` : "—";
      lines.push(
        `| ${f.case.id} | ${escape(f.case.input)} | ${escape(truncate(expected))} | ${escape(truncate(got))} | ${escape(f.reason)} |`
      );
    }
    lines.push("");
    const remaining = results.filter((r) => !r.passed).length - failures.length;
    if (remaining > 0) lines.push(`_${remaining} further failures not listed; see the results JSON._`);
    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

const truncate = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const escape = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
