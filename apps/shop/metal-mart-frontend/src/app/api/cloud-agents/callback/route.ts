/**
 * Ticket records for the Cloud Agents dashboard.
 *
 * A cloud agent calls POST while it works and at the end of its run, with the
 * Linear ticket, the run id from its fire payload, and the links it produced
 * (or status "failed" and a message when it could not finish). The dashboard
 * polls GET for the tickets in its rows. There is one record per ticket (see
 * lib/cloud-agents-store), so every presenter who has the ticket in a row sees
 * the same status.
 *
 *   POST {ticket, run_id?, title?, url?, pr_url?, status?, message?}
 *        Authorization: Bearer <CLOUD_AGENTS_CALLBACK_TOKEN>
 *        A report with a run_id that is not the ticket's current run is refused
 *        with 409, so a run that a newer run replaced cannot overwrite it.
 *   GET  ?ticket=SOL-175            -> {ticket, active, result: TicketRecord | null}
 *   GET  ?tickets=SOL-175,SOL-176   -> {results: {"SOL-175": TicketRecord | null, ...}}
 *   DELETE ?ticket=SOL-175 | (none: every record)
 *        Authorization: Bearer <CLOUD_AGENTS_CALLBACK_TOKEN>
 *
 * Configuration (server-side env):
 *   CLOUD_AGENTS_CALLBACK_TOKEN - shared secret the agent and the dashboard
 *                                 must present (see lib/cloud-agents-auth).
 *                                 POST and DELETE are refused with 503 while it
 *                                 is unset, so the public endpoint never
 *                                 accepts anonymous writes.
 */

import { denyUnlessAuthorized } from "@/lib/cloud-agents-auth";
import {
  type AgentStatus,
  type TicketRecord,
  cleanText,
  clearAll,
  clearTicket,
  getRecord,
  isActive,
  normalizeRunId,
  normalizeTicket,
  setRecord,
} from "@/lib/cloud-agents-store";

const MAX_BODY = 4 * 1024;
const MAX_TICKETS = 25;
const STATUSES: AgentStatus[] = ["done", "failed", "running"];
const NO_STORE = { "Cache-Control": "no-store" };

function httpsUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const rawTickets = params.get("tickets");
  const rawTicket = params.get("ticket");

  if (rawTickets !== null && rawTickets.trim() !== "") {
    const list = rawTickets.split(",").map(normalizeTicket);
    if (list.length > MAX_TICKETS || list.some((t) => !t)) return bad(`tickets must be up to ${MAX_TICKETS} ids like SOL-175`);
    const results: Record<string, TicketRecord | null> = {};
    for (const t of list as string[]) results[t] = getRecord(t);
    return Response.json({ results }, { headers: NO_STORE });
  }
  if (rawTicket !== null && rawTicket.trim() !== "") {
    const ticket = normalizeTicket(rawTicket);
    if (!ticket) return bad("ticket must look like SOL-175");
    const result = getRecord(ticket);
    return Response.json({ ticket, active: isActive(result), result }, { headers: NO_STORE });
  }
  return bad("ticket or tickets is required");
}

export async function DELETE(req: Request) {
  const denied = denyUnlessAuthorized(req);
  if (denied) return denied;
  const rawTicket = new URL(req.url).searchParams.get("ticket");
  if (rawTicket !== null && rawTicket.trim() !== "") {
    const ticket = normalizeTicket(rawTicket);
    if (!ticket) return bad("ticket must look like SOL-175");
    return Response.json({ ticket, cleared: clearTicket(ticket) });
  }
  return Response.json({ ticket: null, cleared: clearAll() });
}

export async function POST(req: Request) {
  const denied = denyUnlessAuthorized(req);
  if (denied) return denied;

  const text = await req.text();
  if (text.length > MAX_BODY) return bad("body too large", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    return bad("body must be JSON");
  }

  const ticket = normalizeTicket(body.ticket);
  if (!ticket) return bad("ticket is required and must look like SOL-175");
  const run_id = normalizeRunId(body.run_id) ?? undefined;
  if (body.run_id && !run_id) return bad("run_id must be the id from the fire payload");

  const url = httpsUrl(body.url);
  const pr_url = httpsUrl(body.pr_url);
  if (body.url && !url) return bad("url must be https");
  if (body.pr_url && !pr_url) return bad("pr_url must be https");

  const status: AgentStatus = STATUSES.includes(body.status as AgentStatus) ? (body.status as AgentStatus) : "done";
  const existing = getRecord(ticket);
  if (run_id && existing?.run_id && existing.run_id !== run_id) {
    return bad(`${ticket} now belongs to another run; this report was not stored`, 409);
  }

  // Updates of the same run merge into its record; a report without a known
  // run (a scheduled run, or a record lost on pod restart) starts a new one.
  const sameRun = Boolean(existing && (!run_id || existing.run_id === run_id));
  const base: Partial<TicketRecord> = sameRun && existing ? existing : { title: existing?.title };
  const now = new Date().toISOString();
  const record: TicketRecord = {
    ...base,
    ticket,
    status,
    run_id: run_id ?? base.run_id,
    title: cleanText(body.title, 160) ?? base.title,
    url: url ?? base.url,
    pr_url: pr_url ?? base.pr_url,
    message: cleanText(body.message, 300),
    started_at: base.started_at ?? now,
    received_at: now,
  };
  setRecord(record);
  return Response.json({ ok: true, result: record });
}
