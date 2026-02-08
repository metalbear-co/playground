const base = process.env.ORDER_SERVICE_URL || "http://localhost:80";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await fetch(`${base}/orders/${id}`);
    const data = await res.json().catch(() => ({ error: "Invalid response from order service" }));
    return Response.json(data, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Order service unreachable";
    return Response.json({ error: message }, { status: 502 });
  }
}
