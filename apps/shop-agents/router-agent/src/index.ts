import express from "express";
import {
  type A2AContext,
  type A2ASendRequest,
  type A2ASendResponse,
  type AgentCard,
  appendTrace,
  baggageHeader,
  messageText,
  textMessage,
} from "./shared/a2a.js";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const publicUrl =
  process.env.PUBLIC_URL || "http://router-agent.shop-agents.svc.cluster.local";
const orderAgentUrl =
  process.env.ORDER_AGENT_URL || "http://order-agent.shop-agents.svc.cluster.local";
const catalogAgentUrl =
  process.env.CATALOG_AGENT_URL ||
  "http://catalog-agent.shop-agents.svc.cluster.local";

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/.well-known/agent.json", (_req, res) => {
  const card: AgentCard = {
    name: "router-agent",
    description: "Routes MetalMart support questions to specialist agents",
    url: publicUrl,
    version: "1.1.0",
    skills: [
      {
        id: "route",
        name: "Route support query",
        description: "Classify intent and delegate to catalog or order agents",
      },
    ],
  };
  res.json(card);
});

type RouteTarget = "order-agent" | "catalog-agent" | "unsupported";

function classifyIntent(text: string): RouteTarget {
  const lower = text.toLowerCase();

  const orderLike =
    /\border\s*#?\s*\d+/i.test(text) ||
    (/\b\d{1,10}\b/.test(text) &&
      (lower.includes("order") ||
        lower.includes("delivery") ||
        lower.includes("ship") ||
        lower.includes("tracking") ||
        (lower.includes("status") && !lower.includes("stock"))));

  if (orderLike) return "order-agent";

  const catalogLike =
    lower.includes("product") ||
    lower.includes("catalog") ||
    lower.includes("inventory") ||
    lower.includes("stock") ||
    lower.includes("in stock") ||
    lower.includes("price") ||
    lower.includes("what do you sell") ||
    lower.includes("what's in stock") ||
    lower.includes("whats in stock");

  if (catalogLike) return "catalog-agent";
  return "unsupported";
}

function sessionFromRequest(
  body: A2ASendRequest,
  req: express.Request
): string | undefined {
  if (body.context?.session?.trim()) return body.context.session.trim();
  const baggage = req.headers.baggage;
  const raw = Array.isArray(baggage) ? baggage[0] : baggage;
  const match = raw?.match(/mirrord-session=([^\s,;]+)/);
  return match?.[1];
}

async function delegate(
  targetUrl: string,
  targetName: string,
  body: A2ASendRequest,
  session: string | undefined
): Promise<A2ASendResponse> {
  const res = await fetch(`${targetUrl}/v1/message:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...baggageHeader(session),
    },
    body: JSON.stringify({
      ...body,
      context: { ...body.context, session },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${targetName} returned ${res.status}: ${errText}`);
  }

  return (await res.json()) as A2ASendResponse;
}

app.post("/v1/message:send", async (req, res) => {
  const body = req.body as A2ASendRequest;
  const query = messageText(body.message);
  let context: A2AContext = appendTrace(body.context, {
    agent: "router-agent",
    action: "received",
    detail: query.slice(0, 120),
  });

  if (!query) {
    return res.status(400).json({
      error: "message must include text",
    });
  }

  try {
    const session = sessionFromRequest(body, req);
    const intent = classifyIntent(query);

    context = appendTrace(context, {
      agent: "router-agent",
      action: "classify",
      detail: intent,
    });

    if (intent === "order-agent") {
      context = appendTrace(context, {
        agent: "router-agent",
        action: "delegate",
        detail: "order-agent",
      });
      const response = await delegate(
        orderAgentUrl,
        "order-agent",
        { message: body.message, context: { ...context, session } },
        session
      );
      return res.json(response);
    }

    if (intent === "catalog-agent") {
      context = appendTrace(context, {
        agent: "router-agent",
        action: "delegate",
        detail: "catalog-agent",
      });
      const response = await delegate(
        catalogAgentUrl,
        "catalog-agent",
        { message: body.message, context: { ...context, session } },
        session
      );
      return res.json(response);
    }

    context = appendTrace(context, {
      agent: "router-agent",
      action: "reply",
      detail: "unsupported intent",
    });

    const response: A2ASendResponse = {
      message: textMessage(
        "agent",
        'I can help with order status or product availability. Try "What is the status of order 7?" or "Is product 2 in stock?"'
      ),
      context,
    };
    return res.json(response);
  } catch (err) {
    console.error("[router-agent] error:", err);
    return res.status(502).json({
      error: err instanceof Error ? err.message : "delegation failed",
      context,
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[router-agent] listening on ${port}`);
});
