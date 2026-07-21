import { NextResponse } from "next/server";

type TraceStep = {
  agent: string;
  action: string;
  detail?: string;
  ms?: number;
  status?: number;
};

type AgentDebug = {
  tools?: Array<{
    name: string;
    request: string;
    status: number;
    ms: number;
    bodyPreview?: string;
  }>;
  llm?: {
    mode: "buggy" | "fixed";
    model: string;
    systemPrompt: string;
    userPrompt: string;
    rawOutput: string;
    note?: string;
  };
  facts?: Record<string, string>;
};

const routerUrl =
  process.env.ROUTER_AGENT_URL ?? "http://router-agent.shop-agents.svc.cluster.local";

export async function POST(req: Request) {
  let body: { query?: string; session?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", trace: [], answer: "", debug: null },
      { status: 400 }
    );
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "query is required", trace: [], answer: "", debug: null },
      { status: 400 }
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (body.session?.trim()) {
    headers.baggage = `mirrord-session=${body.session.trim()}`;
  }

  try {
    const res = await fetch(`${routerUrl}/v1/message:send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: {
          role: "user",
          parts: [{ type: "text", text: query }],
        },
        context: { session: body.session?.trim() || undefined, trace: [] },
      }),
    });

    const payload = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        {
          error: payload.error ?? `router-agent returned ${res.status}`,
          trace: (payload.context?.trace as TraceStep[]) ?? [],
          answer: "",
          debug: (payload.context?.debug as AgentDebug) ?? null,
        },
        { status: res.status }
      );
    }

    const answer =
      payload.message?.parts
        ?.filter((p: { type: string }) => p.type === "text")
        .map((p: { text: string }) => p.text)
        .join("\n") ?? "";

    return NextResponse.json({
      answer,
      trace: (payload.context?.trace as TraceStep[]) ?? [],
      debug: (payload.context?.debug as AgentDebug) ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to reach router-agent",
        trace: [],
        answer: "",
        debug: null,
      },
      { status: 502 }
    );
  }
}
