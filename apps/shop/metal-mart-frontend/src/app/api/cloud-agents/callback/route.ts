/**
 * Completion callback for the Cloud Agents dashboard.
 *
 * A cloud agent calls POST at the end of its run with the links it produced; the
 * dashboard polls GET and shows them on the live row. Without a ticket, GET
 * returns the most recent result of any ticket: the agent chooses the issue it
 * works on, so the dashboard cannot know the ticket ahead of time. DELETE
 * clears one ticket, or every result when no ticket is given (used by
 * "Reset demo state").
 *
 *   POST {ticket, url?, pr_url?, status?, message?}
 *        Authorization: Bearer <CLOUD_AGENTS_CALLBACK_TOKEN>
 *   GET  ?ticket=SOL-175      -> {ticket, result: AgentResult | null}
 *   GET                       -> {ticket: <latest ticket> | null, result: AgentResult | null}
 *   DELETE ?ticket=SOL-175    -> {ticket, cleared: boolean}
 *   DELETE                    -> {ticket: null, cleared: <number removed>}
 *
 * Configuration (server-side env):
 *   CLOUD_AGENTS_CALLBACK_TOKEN - shared secret the agent must present. POST is
 *                                 refused with 503 while it is unset, so the
 *                                 public endpoint never accepts anonymous links.
 */

import {
  type AgentResult,
  type AgentStatus,
  clearAll,
  clearResult,
  getLatest,
  getResult,
  normalizeTicket,
  setResult,
} from "@/lib/cloud-agents-store";

const MAX_BODY = 4 * 1024;
const STATUSES: AgentStatus[] = ["done", "failed", "running"];

function httpsUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function authorized(req: Request): boolean {
  const expected = process.env.CLOUD_AGENTS_CALLBACK_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-callback-token") || "";
  return presented === expected;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("ticket");
  const headers = { "Cache-Control": "no-store" };
  if (raw === null || raw.trim() === "") {
    const latest = getLatest();
    return Response.json({ ticket: latest?.ticket ?? null, result: latest }, { headers });
  }
  const ticket = normalizeTicket(raw);
  if (!ticket) return Response.json({ error: "ticket must look like SOL-175" }, { status: 400 });
  return Response.json({ ticket, result: getResult(ticket) }, { headers });
}

export async function DELETE(req: Request) {
  const raw = new URL(req.url).searchParams.get("ticket");
  if (raw === null || raw.trim() === "") {
    return Response.json({ ticket: null, cleared: clearAll() });
  }
  const ticket = normalizeTicket(raw);
  if (!ticket) return Response.json({ error: "ticket must look like SOL-175" }, { status: 400 });
  return Response.json({ ticket, cleared: clearResult(ticket) });
}

export async function POST(req: Request) {
  if (!process.env.CLOUD_AGENTS_CALLBACK_TOKEN) {
    return Response.json({ ok: false, error: "CLOUD_AGENTS_CALLBACK_TOKEN is not set on the frontend service" }, { status: 503 });
  }
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "invalid or missing callback token" }, { status: 401 });
  }

  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ ok: false, error: "body too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const ticket = normalizeTicket(body.ticket);
  if (!ticket) return Response.json({ ok: false, error: "ticket must look like SOL-175" }, { status: 400 });

  const url = httpsUrl(body.url);
  const pr_url = httpsUrl(body.pr_url);
  if (body.url && !url) return Response.json({ ok: false, error: "url must be https" }, { status: 400 });
  if (body.pr_url && !pr_url) return Response.json({ ok: false, error: "pr_url must be https" }, { status: 400 });

  const status: AgentStatus = STATUSES.includes(body.status as AgentStatus) ? (body.status as AgentStatus) : "done";
  const message = typeof body.message === "string" ? body.message.slice(0, 300) : undefined;

  const result: AgentResult = { ticket, status, url, pr_url, message, received_at: new Date().toISOString() };
  setResult(result);
  return Response.json({ ok: true, result });
}
