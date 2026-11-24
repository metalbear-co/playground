/**
 * In-memory ticket records for the Cloud Agents dashboard and the Software
 * Factory board.
 *
 * Each board shows one card or row per Linear ticket, and the server keeps one
 * record per ticket and board: status, the current run id, the preview and PR
 * links. Every row with a ticket reads that ticket's record, so two presenters
 * who add the same ticket to the same board see the same run, and a ticket
 * never has two runs at the same time on one board: /api/cloud-agents/run
 * claims the record before it fires a routine and refuses a second run while
 * the record is active.
 *
 * The boards are separate namespaces (RecordSource). A run started from the
 * Software Factory never shows on the Cloud Agents dashboard, and the same
 * ticket can run on both boards in parallel. Cloud Agents records keep the plain
 * ticket as their key; other boards prefix it with the board name.
 *
 * A record is active while its status is "running" and the run started less
 * than ACTIVE_MS ago. After that the run is treated as stalled (it ended without
 * a report, or is still going) and the ticket can be run again.
 *
 * The frontend runs as a single replica, so a module-level map is enough for a
 * demo. State is lost on pod restart, which is acceptable: the rows go back to
 * Ready and the next run posts fresh links. The maps hang off globalThis so
 * Next.js dev hot reloads keep them.
 */

export type AgentStatus = "done" | "failed" | "running";

/**
 * The board a run belongs to. It is also the `source` of the routine fire
 * payload. A record without a source belongs to the Cloud Agents dashboard.
 */
export const RECORD_SOURCES = ["cloud-agents-dashboard", "software-factory"] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];
export const DEFAULT_SOURCE: RecordSource = "cloud-agents-dashboard";

/** Returns the source, DEFAULT_SOURCE when none is given, or null when the value is unknown. */
export function normalizeSource(raw: unknown): RecordSource | null {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_SOURCE;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return (RECORD_SOURCES as readonly string[]).includes(s) ? (s as RecordSource) : null;
}

/**
 * The Software Factory station a run is at. The agent sends it with each
 * report of a Software Factory run; the board puts the ticket's card in that
 * column. Production is not a run stage: the board moves a card there after
 * the merge.
 */
export const AGENT_STAGES = ["plan", "code", "verify", "review", "pr"] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

export function normalizeStage(raw: unknown): AgentStage | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return (AGENT_STAGES as readonly string[]).includes(s) ? (s as AgentStage) : null;
}

/**
 * The mirrord session key of a run (`<ticket>-<timestamp>`, lower case). The
 * run's local code receives only requests whose baggage carries
 * `mirrord-session=<key>`. The Software Factory board shows it on the card.
 */
export function normalizeKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(k) ? k : null;
}

/**
 * One real-traffic check from the Verify station of a Software Factory run:
 * the request, the response without the session key (baseline) and with it.
 */
export type VerifyCheck = { service: string; request: string; without?: string; with?: string; ok: boolean };

const MAX_CHECKS = 8;

/** Returns the checks, or null when the value is not a list of checks. Text fields are cleaned and capped. */
export function normalizeChecks(raw: unknown): VerifyCheck[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHECKS) return null;
  const out: VerifyCheck[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") return null;
    const o = c as Record<string, unknown>;
    const service = cleanText(o.service, 40);
    const request = cleanText(o.request, 120);
    if (!service || !request || typeof o.ok !== "boolean") return null;
    out.push({ service, request, without: cleanText(o.without, 160), with: cleanText(o.with, 160), ok: o.ok });
  }
  return out;
}

/**
 * Evidence files of a run (screenshots, the redacted mirrord up log) that the
 * agent pushed to its branch. Only files in the playground repo are accepted,
 * so the board never loads images from other hosts.
 */
const EVIDENCE_PREFIXES = [
  "https://raw.githubusercontent.com/metalbear-co/playground/",
  "https://github.com/metalbear-co/playground/",
];
const MAX_EVIDENCE = 6;

export function normalizeEvidence(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_EVIDENCE) return null;
  const out: string[] = [];
  for (const e of raw) {
    if (typeof e !== "string" || e.length > 300) return null;
    let u: URL;
    try {
      u = new URL(e.trim());
    } catch {
      return null;
    }
    const s = u.toString();
    if (u.protocol !== "https:" || u.search || u.hash || !EVIDENCE_PREFIXES.some((p) => s.startsWith(p))) return null;
    out.push(s);
  }
  return out;
}

/**
 * The run log of a Software Factory card: one entry per report, with the
 * station, the status line and up to MAX_LOG_LINES detail lines (scope items,
 * mirrord up services, static and review checks). The board shows it
 * per station in the card's panel. The server keeps it, so every presenter
 * sees the whole run, also after a reload.
 */
export type LogEntry = { at: string; status: AgentStatus; stage?: AgentStage; message?: string; lines?: string[] };

export const MAX_LOG = 50;
const MAX_LOG_LINES = 10;
const MAX_LOG_LINE = 200;

// Detail lines come from agent output, so they are masked for anything shaped
// like a secret: a JWT, or a hex token of 64 or more characters. A git SHA
// (40 hex characters) stays.
const SECRET_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}|\b[0-9a-fA-F]{64,}\b/g;

/** Returns 1 to MAX_LOG_LINES cleaned lines, or null when the value is not a list of strings. */
export function normalizeLogLines(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LOG_LINES) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const line = cleanText(item.replace(SECRET_RE, "[redacted]"), MAX_LOG_LINE);
    if (line) out.push(line);
  }
  return out.length ? out : null;
}

export const MAX_DIFF = 10000;
export const MAX_MIRRORD_UP = 6000;

/**
 * The code change of a Software Factory run, as `git diff` output. The board
 * shows it in the Code station.
 */
export function normalizeDiff(raw: unknown): string | null {
  return normalizeFileText(raw, MAX_DIFF);
}

/**
 * The mirrord-up-<id>.yaml file a Software Factory run started `mirrord up`
 * with. The board shows it in the Verify station.
 */
export function normalizeMirrordUp(raw: unknown): string | null {
  return normalizeFileText(raw, MAX_MIRRORD_UP);
}

/**
 * Multi-line file text from an agent. Text past `max` characters is cut at a
 * line end, and secret-shaped strings are masked like log lines.
 */
function normalizeFileText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  let d = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(SECRET_RE, "[redacted]");
  if (!d.trim()) return null;
  if (d.length > max) {
    const cut = d.lastIndexOf("\n", max);
    d = d.slice(0, cut > 0 ? cut : max) + "\n… cut at " + max + " characters";
  }
  return d;
}

/** Adds an entry to a run log and keeps the newest MAX_LOG entries. */
export function appendLog(log: LogEntry[] | undefined, entry: LogEntry): LogEntry[] {
  const next = [...(log ?? []), entry];
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
}

export type TicketRecord = {
  ticket: string;
  status: AgentStatus;
  source?: RecordSource;
  stage?: AgentStage;
  key?: string;
  checks?: VerifyCheck[];
  evidence?: string[];
  log?: LogEntry[];
  diff?: string;
  mirrord_up?: string;
  run_id?: string;
  title?: string;
  started_by?: string;
  started_at?: string;
  session_url?: string;
  url?: string;
  pr_url?: string;
  message?: string;
  received_at: string;
};

export type RunInfo = { run_id: string; ticket: string; source: RecordSource };

export const ACTIVE_MS = 45 * 60 * 1000;
const MAX_RECORDS = 200;
const MAX_RUNS = 500;

const g = globalThis as unknown as {
  __cloudAgentRecords?: Map<string, TicketRecord>;
  __cloudAgentRuns?: Map<string, RunInfo>;
};
const records: Map<string, TicketRecord> = (g.__cloudAgentRecords ??= new Map());
// run id -> the ticket and board it was started for, so a report and the
// agent's lookup (GET ?run_id=) find the board from the run id alone.
const runs: Map<string, RunInfo> = (g.__cloudAgentRuns ??= new Map());

export function sourceOf(r: TicketRecord): RecordSource {
  return r.source ?? DEFAULT_SOURCE;
}

function key(ticket: string, source: RecordSource): string {
  return source === DEFAULT_SOURCE ? ticket : `${source}:${ticket}`;
}

export function normalizeTicket(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]+-\d+$/.test(t) ? t : null;
}

/** Run ids are generated by the run route: lower-case letters, digits and dashes. */
export function normalizeRunId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{5,63}$/.test(r) ? r : null;
}

/** Short free text (title, name, message): one line, trimmed, capped. */
export function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

export function isActive(r: TicketRecord | null | undefined, now = Date.now()): boolean {
  if (!r || r.status !== "running") return false;
  const since = Date.parse(r.started_at ?? r.received_at);
  return Number.isFinite(since) && now - since < ACTIVE_MS;
}

export function getRecord(ticket: string, source: RecordSource = DEFAULT_SOURCE): TicketRecord | null {
  return records.get(key(ticket, source)) ?? null;
}

export function setRecord(r: TicketRecord): void {
  const k = key(r.ticket, sourceOf(r));
  records.delete(k);
  records.set(k, r);
  // Map iteration is insertion order, so the first key is the oldest write.
  while (records.size > MAX_RECORDS) records.delete(records.keys().next().value as string);
}

export function lookupRun(runId: string): RunInfo | null {
  return runs.get(runId) ?? null;
}

/**
 * Claims a ticket on a board for a new run. Returns the active record when the
 * ticket is already running there (nothing changes), or the new "running"
 * record plus the record it replaced, so a failed fire can put the old one
 * back. Synchronous, so two requests for the same ticket cannot both claim it.
 */
export function claimTicket(
  ticket: string,
  runId: string,
  startedBy: string | undefined,
  source: RecordSource = DEFAULT_SOURCE
): { active: TicketRecord } | { claimed: TicketRecord; previous: TicketRecord | null } {
  const previous = getRecord(ticket, source);
  if (isActive(previous)) return { active: previous as TicketRecord };
  const now = new Date().toISOString();
  const claimed: TicketRecord = {
    ticket,
    status: "running",
    ...(source !== DEFAULT_SOURCE
      ? { source, stage: "plan" as const, log: [{ at: now, status: "running" as const, stage: "plan" as const, message: "Starting the agent" }] }
      : {}),
    run_id: runId,
    title: previous?.title,
    started_by: startedBy,
    started_at: now,
    message: "Starting the agent",
    received_at: now,
  };
  setRecord(claimed);
  runs.set(runId, { run_id: runId, ticket, source });
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value as string);
  return { claimed, previous };
}

/** Undoes a claim whose fire failed, unless something else wrote the ticket since. */
export function releaseClaim(claimed: TicketRecord, previous: TicketRecord | null): void {
  const source = sourceOf(claimed);
  if (claimed.run_id) runs.delete(claimed.run_id);
  if (getRecord(claimed.ticket, source)?.run_id !== claimed.run_id) return;
  if (previous) setRecord(previous);
  else records.delete(key(claimed.ticket, source));
}

export function clearTicket(ticket: string, source: RecordSource = DEFAULT_SOURCE): boolean {
  return records.delete(key(ticket, source));
}

/** Clears every record of one board. */
export function clearAll(source: RecordSource = DEFAULT_SOURCE): number {
  let n = 0;
  for (const [k, r] of records) {
    if (sourceOf(r) === source) {
      records.delete(k);
      n++;
    }
  }
  return n;
}
