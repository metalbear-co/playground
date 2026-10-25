/**
 * Back-office endpoint for the Cloud Agents dashboard (public/cloud-agents.html).
 *
 * POST fires the Claude Code cloud routine that picks up Linear issues
 * labelled "claude-agent-demo" and opens a mirrord-verified preview PR.
 * GET reports whether the endpoint is configured, so the dashboard can show it.
 *
 * Configuration (server-side env):
 *   CLAUDE_CODE_OAUTH_TOKEN  - OAuth token for the claude.ai account that owns
 *                              the routine (create one with `claude setup-token`).
 *   CLOUD_AGENT_TRIGGER_ID   - routine id to run (trig_...).
 *   ANTHROPIC_BASE_URL       - optional API host override.
 */

const API_BASE = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const TRIGGER_ID = process.env.CLOUD_AGENT_TRIGGER_ID ?? "trig_01YSsN4xAz2bf3W7Mcb4FBPF";
const OAUTH_BETA = "oauth-2025-04-20";

function token(): string | undefined {
  return process.env.CLAUDE_CODE_OAUTH_TOKEN || undefined;
}

export async function GET() {
  return Response.json({
    configured: Boolean(token()),
    trigger_id: TRIGGER_ID,
  });
}

export async function POST() {
  const oauth = token();
  if (!oauth) {
    return Response.json(
      { ok: false, error: "CLAUDE_CODE_OAUTH_TOKEN is not set on the frontend service" },
      { status: 503 }
    );
  }

  const res = await fetch(`${API_BASE}/v1/claude_code/routines/${TRIGGER_ID}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${oauth}`,
      "anthropic-beta": OAUTH_BETA,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return Response.json(
    {
      ok: res.ok,
      status: res.status,
      trigger_id: TRIGGER_ID,
      started_at: new Date().toISOString(),
      result: data,
    },
    { status: res.ok ? 200 : res.status }
  );
}
