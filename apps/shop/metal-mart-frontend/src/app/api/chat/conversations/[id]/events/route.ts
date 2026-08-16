const base = process.env.CHAT_SERVICE_URL || "http://localhost:80";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // req.signal propagates a browser disconnect upstream so the chat service
  // drops the SSE subscriber instead of leaking it.
  const upstream = await fetch(`${base}/conversations/${id}/events`, {
    signal: req.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
