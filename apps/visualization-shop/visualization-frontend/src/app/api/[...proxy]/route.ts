const BACKEND_URL =
  process.env.VISUALIZATION_BACKEND_URL ?? "http://visualization-shop-backend";

async function handler(request: Request, { params }: { params: Promise<{ proxy: string[] }> }) {
  const { proxy } = await params;
  const path = proxy.join("/");
  const url = new URL(request.url);
  const target = `${BACKEND_URL}/${path}${url.search}`;

  const res = await fetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    // @ts-expect-error Node.js fetch supports duplex
    duplex: "half",
  });

  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
