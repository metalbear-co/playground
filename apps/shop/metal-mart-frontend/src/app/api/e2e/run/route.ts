/**
 * Runs an end-to-end scenario from the Cloud Agents dashboard
 * (public/cloud-agents.html, "End-to-end tests" table).
 *
 * POST {scenario?: "E2E-01", chaos?: string} dispatches the
 * `shop-e2e-mirrord.yml` GitHub workflow. GitHub answers a workflow_dispatch
 * with 204 and no run id, so the workflow itself reports its run URL and
 * outcome to /api/cloud-agents/callback under the scenario id; the dashboard
 * polls that route for the row. Any stored result for the scenario is cleared
 * first so a stale outcome never shows as the new run's.
 * GET reports whether the endpoint is configured.
 *
 * Configuration (server-side env):
 *   GITHUB_E2E_DISPATCH_TOKEN - fine-grained token with Actions: write on the repo.
 *   GITHUB_E2E_REPO           - owner/repo, default metalbear-co/playground.
 *   GITHUB_E2E_WORKFLOW       - workflow file name, default shop-e2e-mirrord.yml.
 *   GITHUB_E2E_REF            - branch the workflow runs on, default main.
 */

import { clearResult } from "@/lib/cloud-agents-store";

const REPO = process.env.GITHUB_E2E_REPO ?? "metalbear-co/playground";
const WORKFLOW = process.env.GITHUB_E2E_WORKFLOW ?? "shop-e2e-mirrord.yml";
const REF = process.env.GITHUB_E2E_REF ?? "main";

const SCENARIOS = new Set(["E2E-01"]);
const CHAOS_RULES = new Set([
  "none",
  "01-db-slow",
  "02-db-connection-drop",
  "03-db-timeout",
  "04-rabbitmq-drop",
  "05-rabbitmq-slow",
  "06-inventory-svc-slow",
]);

function token(): string | undefined {
  return process.env.GITHUB_E2E_DISPATCH_TOKEN || undefined;
}

export async function GET() {
  return Response.json({
    configured: Boolean(token()),
    repo: REPO,
    workflow: WORKFLOW,
    ref: REF,
    scenarios: [...SCENARIOS],
    chaos_rules: [...CHAOS_RULES],
  });
}

export async function POST(req: Request) {
  const auth = token();
  if (!auth) {
    return Response.json(
      { ok: false, error: "GITHUB_E2E_DISPATCH_TOKEN is not set on the frontend service" },
      { status: 503 }
    );
  }

  let scenario = "E2E-01";
  let chaos = "none";
  try {
    const body = (await req.json()) as { scenario?: unknown; chaos?: unknown };
    if (typeof body.scenario === "string" && body.scenario.trim()) scenario = body.scenario.trim().toUpperCase();
    if (typeof body.chaos === "string" && body.chaos.trim()) chaos = body.chaos.trim();
  } catch {
    // An empty body runs the default scenario without chaos.
  }
  if (!SCENARIOS.has(scenario)) return Response.json({ ok: false, error: `unknown scenario ${scenario}` }, { status: 400 });
  if (!CHAOS_RULES.has(chaos)) return Response.json({ ok: false, error: `unknown chaos rule ${chaos}` }, { status: 400 });

  clearResult(scenario);

  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: REF, inputs: { chaos, notify_dashboard: "true" } }),
    cache: "no-store",
  });

  const text = await res.text();
  let detail: unknown = null;
  if (text) {
    try {
      detail = JSON.parse(text);
    } catch {
      detail = { raw: text };
    }
  }

  return Response.json(
    {
      ok: res.ok,
      status: res.status,
      scenario,
      chaos,
      started_at: new Date().toISOString(),
      runs_url: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`,
      error: res.ok ? undefined : (detail as { message?: string } | null)?.message ?? `GitHub returned ${res.status}`,
      result: detail,
    },
    { status: res.ok ? 200 : res.status }
  );
}
