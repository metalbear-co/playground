/**
 * Back-office endpoint for the Cloud Agents dashboard (public/cloud-agents.html, served at /cloud-agents).
 *
 * POST fires the Claude Code cloud routine that picks up Linear issues
 * labelled "claude-agent-demo" and opens a mirrord-verified preview PR. Every
 * stored result is cleared before the routine fires: the dashboard shows the
 * latest callback of any ticket (the agent picks the issue, so the ticket in the
 * body is only the one the dashboard displays), and a stale result from an
 * earlier run would otherwise surface as if it belonged to the new one.
 * GET reports whether the endpoint is configured, so the dashboard can show it.
 * POST requires the dashboard token (Authorization: Bearer
 * <CLOUD_AGENTS_CALLBACK_TOKEN>): the page is public, and firing the routine
 * must not be open to anonymous visitors.
 *
 * Configuration (server-side env):
 *   CLAUDE_CODE_OAUTH_TOKEN  - OAuth token for the claude.ai account that owns
 *                              the routine (create one with `claude setup-token`).
 *   CLOUD_AGENT_TRIGGER_ID   - routine id to run (trig_...).
 *   ANTHROPIC_BASE_URL       - optional API host override.
 */

import { denyUnlessAuthorized } from "@/lib/cloud-agents-auth";
import { clearAll, normalizeTicket } from "@/lib/cloud-agents-store";

const API_BASE = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const TRIGGER_ID = process.env.CLOUD_AGENT_TRIGGER_ID ?? "trig_01YSsN4xAz2bf3W7Mcb4FBPF";
const OAUTH_BETA = "oauth-2025-04-20";
const API_VERSION = "2023-06-01";

function token(): string | undefined {
  return process.env.CLAUDE_CODE_OAUTH_TOKEN || undefined;
}

export async function GET() {
  return Response.json({
    configured: Boolean(token()),
    trigger_id: TRIGGER_ID,
  });
}

export async function POST(req: Request) {
  const denied = denyUnlessAuthorized(req);
  if (denied) return denied;
  const oauth = token();
  if (!oauth) {
    return Response.json(
      { ok: false, error: "CLAUDE_CODE_OAUTH_TOKEN is not set on the frontend service" },
      { status: 503 }
    );
  }

  let ticket: string | null = null;
  try {
    ticket = normalizeTicket(((await req.json()) as { ticket?: unknown }).ticket);
  } catch {
    ticket = null;
  }
  clearAll();

  const res = await fetch(`${API_BASE}/v1/claude_code/routines/${TRIGGER_ID}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${oauth}`,
      "anthropic-beta": OAUTH_BETA,
      "anthropic-version": API_VERSION,
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
      ticket,
      result: data,
    },
    { status: res.ok ? 200 : res.status }
  );
}
