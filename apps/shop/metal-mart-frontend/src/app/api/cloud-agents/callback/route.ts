/**
 * Ticket records for the Cloud Agents dashboard and the Software Factory board.
 *
 * A cloud agent calls POST while it works and at the end of its run, with the
 * Linear ticket, the run id from its fire payload, and the links it produced
 * (or status "failed" and a message when it could not finish). The boards poll
 * GET for the tickets they show. There is one record per ticket and board (see
 * lib/cloud-agents-store), so every presenter who has the ticket on a board sees
 * the same status, and the two boards never see each other's runs.
 *
 * `source` names the board: "cloud-agents-dashboard" (the default, so the Cloud
 * Agents dashboard and its agents send nothing) or "software-factory".
 *
 *   POST {ticket, run_id?, source?, title?, url?, pr_url?, status?, stage?, key?, checks?, evidence?, log?, diff?, mirrord_up?, message?}
 *        Authorization: Bearer <CLOUD_AGENTS_CALLBACK_TOKEN>
 *        The board comes from the run id when the server started that run, else
 *        from `source`. A report with a run_id that is not the ticket's current
 *        run on that board is refused with 409, so a run that a newer run
 *        replaced cannot overwrite it.
 *        stage (plan | code | verify | review | pr) is the Software Factory
 *        column and is stored for Software Factory runs only. A report without
 *        it keeps the record's stage; a "done" report without it means the PR is
 *        open (stage "pr").
 *        key is the run's mirrord session key, shown on the Software Factory
 *        card; stored for Software Factory runs only. A report without it
 *        keeps the record's key.
 *        checks ([{service, request, without?, with?, ok}], up to 8) and
 *        evidence (up to 6 file URLs in the playground repo: screenshots, the
 *        redacted mirrord up log) fill the Verify station of a Software Factory
 *        card; stored for Software Factory runs only. A report without them
 *        keeps the record's values.
 *        log (up to 10 lines of detail, each up to 200 characters) goes with
 *        the report's message into the run log of a Software Factory card. Each
 *        report with a message or a log adds one entry; the record keeps the
 *        newest 50. Lines shaped like a JWT or a long hex token are masked.
 *        diff (git diff output, up to 10,000 characters; longer text is cut)
 *        is the run's code change, shown in the Code station of a Software
 *        Factory card. A report without it keeps the record's diff.
 *        mirrord_up (the mirrord-up-<id>.yaml text, up to 6,000 characters) is
 *        the file the run started `mirrord up` with, shown in the Verify
 *        station. A report without it keeps the record's file.
 *   GET  ?ticket=SOL-175[&source=…]           -> {ticket, active, result: TicketRecord | null}
 *   GET  ?tickets=SOL-175,SOL-176[&source=…]  -> {results: {"SOL-175": TicketRecord | null, ...}}
 *   GET  ?run_id=<id>                         -> {run_id, ticket, source} | 404
 *        Lets an agent find out which board started its run.
 *   DELETE ?ticket=SOL-175[&source=…] | (no ticket: every record of that board)
 *        Authorization: Bearer <CLOUD_AGENTS_CALLBACK_TOKEN>
 *
 * Configuration (server-side env):
 *   CLOUD_AGENTS_CALLBACK_TOKEN - shared secret the agent and the boards must
 *                                 present (see lib/cloud-agents-auth). POST and
 *                                 DELETE are refused with 503 while it is unset,
 *                                 so the public endpoint never accepts anonymous
 *                                 writes.
 */

import { denyUnlessAuthorized } from "@/lib/cloud-agents-auth";
import {
  type AgentStatus,
  type RecordSource,
  type TicketRecord,
  DEFAULT_SOURCE,
  appendLog,
  cleanText,
  clearAll,
  clearTicket,
  getRecord,
  isActive,
  lookupRun,
  normalizeChecks,
  normalizeEvidence,
  normalizeKey,
  normalizeDiff,
  normalizeLogLines,
  normalizeMirrordUp,
  normalizeRunId,
  normalizeSource,
  normalizeStage,
  normalizeTicket,
  setRecord,
} from "@/lib/cloud-agents-store";

const MAX_BODY = 24 * 1024;
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

const BAD_SOURCE = "source must be cloud-agents-dashboard or software-factory";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const rawRun = params.get("run_id");
  if (rawRun !== null && rawRun.trim() !== "") {
    const runId = normalizeRunId(rawRun);
    if (!runId) return bad("run_id must be the id from the fire payload");
    const run = lookupRun(runId);
    if (!run) return bad("unknown run_id", 404);
    return Response.json(run, { headers: NO_STORE });
  }

  const source = normalizeSource(params.get("source"));
  if (!source) return bad(BAD_SOURCE);
  const rawTickets = params.get("tickets");
  const rawTicket = params.get("ticket");

  if (rawTickets !== null && rawTickets.trim() !== "") {
    const list = rawTickets.split(",").map(normalizeTicket);
    if (list.length > MAX_TICKETS || list.some((t) => !t)) return bad(`tickets must be up to ${MAX_TICKETS} ids like SOL-175`);
    const results: Record<string, TicketRecord | null> = {};
    for (const t of list as string[]) results[t] = getRecord(t, source);
    return Response.json({ results }, { headers: NO_STORE });
  }
  if (rawTicket !== null && rawTicket.trim() !== "") {
    const ticket = normalizeTicket(rawTicket);
    if (!ticket) return bad("ticket must look like SOL-175");
    const result = getRecord(ticket, source);
    return Response.json({ ticket, active: isActive(result), result }, { headers: NO_STORE });
  }
  return bad("ticket, tickets or run_id is required");
}

export async function DELETE(req: Request) {
  const denied = denyUnlessAuthorized(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const source = normalizeSource(params.get("source"));
  if (!source) return bad(BAD_SOURCE);
  const rawTicket = params.get("ticket");
  if (rawTicket !== null && rawTicket.trim() !== "") {
    const ticket = normalizeTicket(rawTicket);
    if (!ticket) return bad("ticket must look like SOL-175");
    return Response.json({ ticket, cleared: clearTicket(ticket, source) });
  }
  return Response.json({ ticket: null, cleared: clearAll(source) });
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

  // The board that started the run wins over what the report says. An unknown
  // `source` falls back to the Cloud Agents board, so a report that worked
  // before the Software Factory existed still works the same way.
  const source: RecordSource = (run_id && lookupRun(run_id)?.source) || normalizeSource(body.source) || DEFAULT_SOURCE;
  const factory = source !== DEFAULT_SOURCE;

  const url = httpsUrl(body.url);
  const pr_url = httpsUrl(body.pr_url);
  if (body.url && !url) return bad("url must be https");
  if (body.pr_url && !pr_url) return bad("pr_url must be https");

  const status: AgentStatus = STATUSES.includes(body.status as AgentStatus) ? (body.status as AgentStatus) : "done";
  // stage and key belong to the Software Factory board. On the Cloud Agents
  // board they are ignored, never refused, as they were before that board existed.
  const stage = factory ? (normalizeStage(body.stage) ?? undefined) : undefined;
  if (factory && body.stage && !stage) return bad("stage must be one of plan, code, verify, review, pr");
  const key = factory ? (normalizeKey(body.key) ?? undefined) : undefined;
  if (factory && body.key && !key) return bad("key must be the mirrord session key, e.g. sol-211-20261122-085206");
  const checks = factory && body.checks !== undefined ? normalizeChecks(body.checks) : undefined;
  if (checks === null) return bad("checks must be 1 to 8 items like {service, request, without, with, ok}");
  const evidence = factory && body.evidence !== undefined ? normalizeEvidence(body.evidence) : undefined;
  if (evidence === null) return bad("evidence must be 1 to 6 https URLs of files in metalbear-co/playground");
  const logLines = factory && body.log !== undefined ? normalizeLogLines(body.log) : undefined;
  if (logLines === null) return bad("log must be 1 to 10 strings");
  const diff = factory && body.diff !== undefined ? normalizeDiff(body.diff) : undefined;
  if (diff === null) return bad("diff must be the git diff text");
  const mirrordUp = factory && body.mirrord_up !== undefined ? normalizeMirrordUp(body.mirrord_up) : undefined;
  if (mirrordUp === null) return bad("mirrord_up must be the mirrord-up yaml text");
  const existing = getRecord(ticket, source);
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
    ...(factory
      ? { source, stage: stage ?? (status === "done" ? "pr" : base.stage), key: key ?? base.key, checks: checks ?? base.checks, evidence: evidence ?? base.evidence, diff: diff ?? base.diff, mirrord_up: mirrordUp ?? base.mirrord_up }
      : {}),
    run_id: run_id ?? base.run_id,
    title: cleanText(body.title, 160) ?? base.title,
    url: url ?? base.url,
    pr_url: pr_url ?? base.pr_url,
    message: cleanText(body.message, 300),
    started_at: base.started_at ?? now,
    received_at: now,
  };
  if (factory && (record.message || logLines || status !== "running")) {
    record.log = appendLog(base.log, {
      at: now,
      status,
      stage: record.stage,
      ...(record.message ? { message: record.message } : {}),
      ...(logLines ? { lines: logLines } : {}),
    });
  }
  setRecord(record);
  return Response.json({ ok: true, result: record });
}
