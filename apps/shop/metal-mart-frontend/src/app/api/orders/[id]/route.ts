const base = process.env.ORDER_SERVICE_URL || "http://localhost:80";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${base}/orders/${id}`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
