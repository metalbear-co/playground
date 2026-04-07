const base = process.env.ORDER_SERVICE_URL || "http://localhost:80";

export async function POST(req: Request) {
  const body = await req.json();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const baggage = req.headers.get("baggage");
  if (baggage) headers["baggage"] = baggage;
  const res = await fetch(`${base}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
