const base = process.env.ORDER_SERVICE_URL || "http://localhost:80";

export async function POST(req: Request) {
  const body = await req.json();
  const tenant = req.headers.get("x-pg-tenant");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tenant) headers["x-pg-tenant"] = tenant;
  const res = await fetch(`${base}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
