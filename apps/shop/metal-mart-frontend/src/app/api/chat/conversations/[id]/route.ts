const base = process.env.CHAT_SERVICE_URL || "http://localhost:80";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${base}/conversations/${id}`, { method: "DELETE" });
  return new Response(null, { status: res.status });
}
