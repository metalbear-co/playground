const base = process.env.CHAT_SERVICE_URL || "http://localhost:80";

export async function GET() {
  const res = await fetch(`${base}/conversations`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
