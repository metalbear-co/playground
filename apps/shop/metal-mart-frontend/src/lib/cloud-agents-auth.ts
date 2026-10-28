/**
 * Shared-secret check for the Cloud Agents dashboard's write endpoints.
 *
 * The dashboard (public/cloud-agents.html) and the cloud agents present
 * CLOUD_AGENTS_CALLBACK_TOKEN as a bearer token. Every endpoint that starts a
 * run, dispatches a workflow, or changes stored results requires it, so the
 * public storefront never lets an anonymous caller trigger automation or
 * rewrite what the dashboard shows. Reads stay open.
 */

export function tokenConfigured(): boolean {
  return Boolean(process.env.CLOUD_AGENTS_CALLBACK_TOKEN);
}

export function authorized(req: Request): boolean {
  const expected = process.env.CLOUD_AGENTS_CALLBACK_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-callback-token") || "";
  return presented === expected;
}

/** The response to send when the caller is not authorized, or null when it is. */
export function denyUnlessAuthorized(req: Request): Response | null {
  if (!tokenConfigured()) {
    return Response.json({ ok: false, error: "CLOUD_AGENTS_CALLBACK_TOKEN is not set on the frontend service" }, { status: 503 });
  }
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "invalid or missing dashboard token" }, { status: 401 });
  }
  return null;
}
