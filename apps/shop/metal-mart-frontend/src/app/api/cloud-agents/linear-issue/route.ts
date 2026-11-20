/**
 * "New demo ticket" for the Cloud Agents dashboard.
 *
 * POST copies a template Linear issue into a new issue in the same team: same
 * title, description, labels, priority, estimate and project, with status
 * Backlog and the "claude-agent-demo" label (added when the template lacks it,
 * because the agent refuses issues without it). The dashboard then adds the new
 * ticket as a task row. GET reports whether the feature is configured, so the
 * page shows the button only when it works.
 *
 *   GET                         -> {configured, template}
 *   POST {created_by?}          -> {ok, ticket, title, url, template}
 *        Authorization: Bearer <CLOUD_AGENTS_CALLBACK_TOKEN>
 *
 * The Linear API key never leaves the server. POST requires the dashboard
 * token: the page is public, and the endpoint must not let anyone create issues.
 *
 * Configuration (server-side env, both from the cloud-agents secret):
 *   LINEAR_API_KEY               - Linear personal API key with Read and Create
 *                                  issues permissions on the template's team.
 *   CLOUD_AGENTS_TEMPLATE_ISSUE  - identifier of the issue to copy, e.g. SOL-205.
 *   LINEAR_API_URL               - API endpoint override (tests).
 */

import { denyUnlessAuthorized } from "@/lib/cloud-agents-auth";
import { cleanText, normalizeTicket } from "@/lib/cloud-agents-store";

const LINEAR_API_URL = process.env.LINEAR_API_URL ?? "https://api.linear.app/graphql";
const DEMO_LABEL = "claude-agent-demo";

type Template = {
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  estimate: number | null;
  project: { id: string } | null;
  team: { id: string; states: { nodes: { id: string; name: string; position: number }[] } };
  labels: { nodes: { id: string; name: string }[] };
};

function config(): { key: string; template: string } | null {
  const key = process.env.LINEAR_API_KEY?.trim();
  const template = normalizeTicket(process.env.CLOUD_AGENTS_TEMPLATE_ISSUE);
  return key && template ? { key, template } : null;
}

async function linear<T>(key: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null;
  if (!res.ok || !body || body.errors?.length || !body.data) {
    const msg = body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Linear API: ${msg}`);
  }
  return body.data;
}

const TEMPLATE_QUERY = `query Template($id: String!) {
  issue(id: $id) {
    identifier title description priority estimate
    project { id }
    team { id states(filter: { type: { eq: "backlog" } }) { nodes { id name position } } }
    labels { nodes { id name } }
  }
}`;

const LABEL_QUERY = `query DemoLabel($name: String!) {
  issueLabels(filter: { name: { eq: $name } }) { nodes { id name } }
}`;

const CREATE_MUTATION = `mutation Copy($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier title url } }
}`;

export async function GET() {
  const c = config();
  return Response.json({ configured: Boolean(c), template: c?.template ?? null });
}

export async function POST(req: Request) {
  const denied = denyUnlessAuthorized(req);
  if (denied) return denied;
  const c = config();
  if (!c) {
    return Response.json(
      { ok: false, error: "New demo ticket is not configured: LINEAR_API_KEY and CLOUD_AGENTS_TEMPLATE_ISSUE are needed" },
      { status: 503 }
    );
  }

  let createdBy: string | undefined;
  try {
    createdBy = cleanText(((await req.json()) as { created_by?: unknown }).created_by, 40);
  } catch {
    createdBy = undefined;
  }

  try {
    const { issue: t } = await linear<{ issue: Template | null }>(c.key, TEMPLATE_QUERY, { id: c.template });
    if (!t) throw new Error(`template issue ${c.template} not found`);

    // The team's Backlog status: the backlog-type state named "Backlog", else the first one.
    const states = [...t.team.states.nodes].sort((a, b) => a.position - b.position);
    const backlog = states.find((s) => s.name.toLowerCase() === "backlog") ?? states[0];
    if (!backlog) throw new Error("the template's team has no Backlog status");

    const labelIds = t.labels.nodes.map((l) => l.id);
    if (!t.labels.nodes.some((l) => l.name === DEMO_LABEL)) {
      const { issueLabels } = await linear<{ issueLabels: { nodes: { id: string }[] } }>(c.key, LABEL_QUERY, {
        name: DEMO_LABEL,
      });
      if (!issueLabels.nodes[0]) throw new Error(`label ${DEMO_LABEL} not found in Linear`);
      labelIds.push(issueLabels.nodes[0].id);
    }

    const footer = `\n\n---\nCopied from ${t.identifier} by the Cloud Agents dashboard${createdBy ? ` for ${createdBy}` : ""}.`;
    const input: Record<string, unknown> = {
      teamId: t.team.id,
      title: t.title,
      description: (t.description ?? "") + footer,
      labelIds,
      stateId: backlog.id,
    };
    if (t.priority) input.priority = t.priority;
    if (t.estimate !== null && t.estimate !== undefined) input.estimate = t.estimate;
    if (t.project) input.projectId = t.project.id;

    const { issueCreate } = await linear<{
      issueCreate: { success: boolean; issue: { identifier: string; title: string; url: string } | null };
    }>(c.key, CREATE_MUTATION, { input });
    if (!issueCreate.success || !issueCreate.issue) throw new Error("Linear did not create the issue");

    return Response.json({
      ok: true,
      ticket: issueCreate.issue.identifier,
      title: issueCreate.issue.title,
      url: issueCreate.issue.url,
      template: t.identifier,
    });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
