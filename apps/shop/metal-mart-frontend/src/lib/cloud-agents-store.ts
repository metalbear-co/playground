/**
 * In-memory results store for the Cloud Agents dashboard.
 *
 * A cloud agent posts its final links (preview share URL, PR URL) to
 * /api/cloud-agents/callback when it finishes; the dashboard polls that route
 * and renders them on the live row. The agent picks whichever Linear issue
 * carries the demo label, so the ticket it reports is not known up front: the
 * dashboard asks for the latest result (most recent received_at) rather than a
 * ticket it guessed. The frontend runs as a single replica, so a module-level
 * map is enough for a demo. State is lost on pod restart, which is acceptable:
 * the next run posts fresh links.
 *
 * The map hangs off globalThis so Next.js dev hot reloads keep it.
 */

export type AgentStatus = "done" | "failed" | "running";

export type AgentResult = {
  ticket: string;
  status: AgentStatus;
  url?: string;
  pr_url?: string;
  message?: string;
  received_at: string;
};

const g = globalThis as unknown as { __cloudAgentResults?: Map<string, AgentResult> };
const results: Map<string, AgentResult> = (g.__cloudAgentResults ??= new Map());

export function normalizeTicket(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]+-\d+$/.test(t) ? t : null;
}

export function getResult(ticket: string): AgentResult | null {
  return results.get(ticket) ?? null;
}

export function setResult(r: AgentResult): void {
  results.set(r.ticket, r);
}

/** End-to-end scenario rows (E2E-01, ...) report through the same callback
 * but belong to the "End-to-end tests" table, which polls by ticket. */
export function isScenarioTicket(ticket: string): boolean {
  return ticket.startsWith("E2E-");
}

/** Most recent agent result, ignoring scenario tickets so an E2E run never
 * renames the live agent row. */
export function getLatest(): AgentResult | null {
  let latest: AgentResult | null = null;
  for (const r of results.values()) {
    if (isScenarioTicket(r.ticket)) continue;
    if (!latest || r.received_at > latest.received_at) latest = r;
  }
  return latest;
}

export function clearResult(ticket: string): boolean {
  return results.delete(ticket);
}

export function clearAll(): number {
  const n = results.size;
  results.clear();
  return n;
}
