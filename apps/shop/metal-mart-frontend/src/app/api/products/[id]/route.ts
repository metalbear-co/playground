const base = process.env.INVENTORY_SERVICE_URL || "http://localhost:80";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${base}/products/${id}`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
