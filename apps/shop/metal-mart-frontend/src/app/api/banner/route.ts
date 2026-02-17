const base = process.env.ORDER_SERVICE_URL || "http://localhost:80";

export async function GET() {
  const res = await fetch(`${base}/banner`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
