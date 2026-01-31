const base = process.env.DELIVERY_SERVICE_URL || "http://localhost:80";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const res = await fetch(`${base}/deliveries/order/${orderId}`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
