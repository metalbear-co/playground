const base = process.env.INVENTORY_SERVICE_URL || "http://localhost:80";

export async function GET() {
  const res = await fetch(`${base}/products`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
