const base = process.env.FULFILLMENT_SERVICE_URL || "http://localhost:3007";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const res = await fetch(`${base}/fulfillments/order/${orderId}`);
  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
