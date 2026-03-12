const base = process.env.ORDER_SERVICE_URL || "http://localhost:80";

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${base}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
