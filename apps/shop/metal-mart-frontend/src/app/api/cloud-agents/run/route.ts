/**
 * Back-office endpoint for the Cloud Agents dashboard (public/cloud-agents.html, served at /cloud-agents).
 *
 * POST fires a Claude Code routine that picks up a Linear issue labelled
 * "claude-agent-demo" and opens a mirrord-verified preview PR (see
 * .claude/skills/cloud-demo-skill-with-mirrord).
 *
 * Whose routine runs. A routine belongs to one claude.ai account and runs as
 * that account, so every presenter fires their own: the dashboard sends the
 * presenter's routine id and routine API token in the X-Routine-Id and
 * X-Routine-Token headers (entered once in the page's Agent settings, kept in
 * that browser). When the headers are absent, the server falls back to the
 * routine configured in its env, if any. The id and the token always come from
 * the same place: a browser-supplied id is never paired with the server token.
 *
 * One run per ticket. POST takes the Linear ticket of the dashboard row
 * ({ticket, started_by?}) and claims that ticket's record in the store (see
 * lib/cloud-agents-store) before it fires. When the ticket already has an active
 * run, nothing is fired: the response carries that run's record with
 * already_running: true, and the row follows it. Otherwise the POST mints a run
 * id and passes it with the ticket to the routine in the fire payload (`text`).
 * The agent reports back to /api/cloud-agents/callback with both. The callback
 * URL is deliberately not part of the payload: the agent reads it from its own
 * environment, so a payload can never redirect the callback token elsewhere.
 *
 * POST requires the dashboard token (Authorization: Bearer
 * <CLOUD_AGENTS_CALLBACK_TOKEN>): the page is public, and the endpoint must not
 * be an open relay to the routines API.
 * GET reports whether a server-side routine is configured.
 *
 * Configuration (server-side env, all optional):
 *   CLOUD_AGENT_TRIGGER_ID     - default routine id (trig_...).
 *   CLOUD_AGENT_ROUTINE_TOKEN  - that routine's API token (Edit routine → Trigger → API →
 *                                Generate token). CLAUDE_CODE_OAUTH_TOKEN is read as a
 *                                fallback name.
 *   ANTHROPIC_BASE_URL         - API host override.
 */

import { randomUUID } from "node:crypto";
import { denyUnlessAuthorized } from "@/lib/cloud-agents-auth";
import { claimTicket, cleanText, getRecord, normalizeTicket, releaseClaim, setRecord } from "@/lib/cloud-agents-store";

const API_BASE = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
const API_VERSION = "2023-06-01";
const TRIGGER_RE = /^trig_[A-Za-z0-9]{8,64}$/;

type Routine = { id: string; token: string; source: "browser" | "server" };

function serverRoutine(): Routine | null {
  const id = process.env.CLOUD_AGENT_TRIGGER_ID?.trim();
  const token = (process.env.CLOUD_AGENT_ROUTINE_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || "").trim();
  return id && token && TRIGGER_RE.test(id) ? { id, token, source: "server" } : null;
}

function pickRoutine(req: Request): Routine | { error: string } {
  const id = req.headers.get("x-routine-id")?.trim();
  const token = req.headers.get("x-routine-token")?.trim();
  if (id || token) {
    if (!id || !token) return { error: "Agent settings need both the routine id and the routine API token" };
    if (!TRIGGER_RE.test(id)) return { error: "routine id must look like trig_..." };
    return { id, token, source: "browser" };
  }
  return serverRoutine() ?? { error: "No routine configured. Open Agent settings and enter your routine id and API token." };
}

export async function GET() {
  const r = serverRoutine();
  return Response.json({ configured: Boolean(r), trigger_id: r?.id ?? null });
}

export async function POST(req: Request) {
  const denied = denyUnlessAuthorized(req);
  if (denied) return denied;

  const routine = pickRoutine(req);
  if ("error" in routine) return Response.json({ ok: false, error: routine.error }, { status: 400 });

  let body: { ticket?: unknown; started_by?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const ticket = normalizeTicket(body.ticket);
  if (!ticket) return Response.json({ ok: false, error: "ticket is required, for example SOL-175" }, { status: 400 });

  const runId = randomUUID();
  const claim = claimTicket(ticket, runId, cleanText(body.started_by, 40));
  if ("active" in claim) {
    return Response.json({ ok: true, already_running: true, ticket, run_id: claim.active.run_id, record: claim.active });
  }

  const payload = { source: "cloud-agents-dashboard", run_id: runId, ticket };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/claude_code/routines/${routine.id}/fire`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${routine.token}`,
        "anthropic-beta": ROUTINE_BETA,
        "anthropic-version": API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: JSON.stringify(payload) }),
      cache: "no-store",
    });
  } catch (err) {
    releaseClaim(claim.claimed, claim.previous);
    return Response.json({ ok: false, error: `routines API unreachable: ${String(err)}` }, { status: 502 });
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    releaseClaim(claim.claimed, claim.previous);
    return Response.json(
      { ok: false, status: res.status, trigger_id: routine.id, routine_source: routine.source, ticket, result: data },
      { status: res.status }
    );
  }

  const sessionUrl = (data as { claude_code_session_url?: unknown })?.claude_code_session_url;
  const record = { ...claim.claimed, message: "Agent started" };
  if (typeof sessionUrl === "string" && sessionUrl.startsWith("https://")) record.session_url = sessionUrl;
  // A Reset during the fire clears the claim; do not bring it back.
  if (getRecord(ticket)?.run_id === runId) setRecord(record);

  return Response.json({
    ok: true,
    status: res.status,
    trigger_id: routine.id,
    routine_source: routine.source,
    ticket,
    run_id: runId,
    record,
    result: data,
  });
}
