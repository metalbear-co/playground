const base = process.env.CHAT_SERVICE_URL || "http://localhost:80";

export async function POST(req: Request) {
  const body = await req.json();
  // The inbound baggage header (mirrord session id) reaches the chat service
  // via OTel auto-instrumentation (src/instrumentation.ts), which propagates
  // it on outgoing fetches; adding it here as well would duplicate the value.
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
