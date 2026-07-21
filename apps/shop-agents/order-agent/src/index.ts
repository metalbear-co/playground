import express from "express";
import {
  type A2ASendRequest,
  type A2ASendResponse,
  type AgentCard,
  type AgentDebug,
  appendTrace,
  messageText,
  textMessage,
} from "./shared/a2a.js";
import { composeCustomerReply } from "./llm.js";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const publicUrl =
  process.env.PUBLIC_URL || "http://order-agent.shop-agents.svc.cluster.local";
const orderServiceUrl =
  process.env.ORDER_SERVICE_URL || "http://order-service.shop.svc.cluster.local";
const deliveryServiceUrl =
  process.env.DELIVERY_SERVICE_URL ||
  "http://delivery-service.shop.svc.cluster.local";

type OrderRow = {
  id: number;
  items: unknown;
  total_cents: number;
  status: string;
  created_at: string;
};

type DeliveryRow = {
  id: number;
  order_id: number;
  status: string;
  created_at: string;
};

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", llmMode: process.env.LLM_MODE || "buggy" });
});

app.get("/.well-known/agent.json", (_req, res) => {
  const card: AgentCard = {
    name: "order-agent",
    description:
      "Looks up MetalMart orders/delivery, then drafts a customer reply via LLM",
    url: publicUrl,
    version: "1.1.0",
    skills: [
      {
        id: "order_lookup",
        name: "Order lookup + LLM reply",
        description:
          "Fetch order and delivery tools, then generate a grounded customer reply",
      },
    ],
  };
  res.json(card);
});

function extractOrderId(text: string): number | null {
  const hashMatch = text.match(/#\s*(\d+)/);
  if (hashMatch) return parseInt(hashMatch[1], 10);
  const orderMatch = text.match(/order\s*#?\s*(\d+)/i);
  if (orderMatch) return parseInt(orderMatch[1], 10);
  const bare = text.match(/\b(\d{1,10})\b/);
  if (bare) return parseInt(bare[1], 10);
  return null;
}

function formatItems(items: unknown): string {
  if (!Array.isArray(items)) return "unknown items";
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return JSON.stringify(item);
      const row = item as Record<string, unknown>;
      const productId = row.productId ?? row.product_id;
      const quantity = row.quantity;
      if (typeof productId === "number" && typeof quantity === "number") {
        return `product ${productId} × ${quantity}`;
      }
      return JSON.stringify(item);
    })
    .join(", ");
}

async function timedFetch(url: string): Promise<{
  status: number;
  ms: number;
  json: unknown;
  text: string;
}> {
  const started = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ms: Date.now() - started, json, text };
}

app.post("/v1/message:send", async (req, res) => {
  const body = req.body as A2ASendRequest;
  const query = messageText(body.message);
  let context = appendTrace(body.context, {
    agent: "order-agent",
    action: "received",
    detail: query.slice(0, 120),
  });

  const orderId = extractOrderId(query);
  if (orderId == null || Number.isNaN(orderId)) {
    return res.status(400).json({
      error: 'Could not find an order id. Example: "status of order 7"',
      context,
    });
  }

  const debug: AgentDebug = { tools: [], facts: {} };

  try {
    const orderUrl = `${orderServiceUrl}/orders/${orderId}`;
    context = appendTrace(context, {
      agent: "order-agent",
      action: "tool",
      detail: `GET ${orderUrl}`,
    });

    const orderHit = await timedFetch(orderUrl);
    debug.tools!.push({
      name: "order-service",
      request: `GET /orders/${orderId}`,
      status: orderHit.status,
      ms: orderHit.ms,
      bodyPreview: orderHit.text.slice(0, 280),
    });
    context = appendTrace(context, {
      agent: "order-agent",
      action: "tool_result",
      detail: `order-service ${orderHit.status}`,
      ms: orderHit.ms,
      status: orderHit.status,
    });

    if (orderHit.status === 404) {
      const response: A2ASendResponse = {
        message: textMessage("agent", `Order #${orderId} was not found.`),
        context: { ...appendTrace(context, {
          agent: "order-agent",
          action: "not_found",
          detail: String(orderId),
        }), debug },
      };
      return res.json(response);
    }
    if (orderHit.status >= 400 || !orderHit.json) {
      throw new Error(`order-service returned ${orderHit.status}`);
    }

    const order = orderHit.json as OrderRow;

    const deliveryUrl = `${deliveryServiceUrl}/deliveries/order/${orderId}`;
    context = appendTrace(context, {
      agent: "order-agent",
      action: "tool",
      detail: `GET ${deliveryUrl}`,
    });

    const deliveryHit = await timedFetch(deliveryUrl);
    debug.tools!.push({
      name: "delivery-service",
      request: `GET /deliveries/order/${orderId}`,
      status: deliveryHit.status,
      ms: deliveryHit.ms,
      bodyPreview: deliveryHit.text.slice(0, 280),
    });
    context = appendTrace(context, {
      agent: "order-agent",
      action: "tool_result",
      detail: `delivery-service ${deliveryHit.status}`,
      ms: deliveryHit.ms,
      status: deliveryHit.status,
    });

    let deliveryStatus = "no delivery record yet";
    if (deliveryHit.status === 200 && deliveryHit.json) {
      const delivery = deliveryHit.json as DeliveryRow;
      if (delivery?.status) deliveryStatus = delivery.status;
    } else if (deliveryHit.status !== 404) {
      throw new Error(`delivery-service returned ${deliveryHit.status}`);
    }

    const facts = {
      orderId: order.id,
      orderStatus: order.status,
      items: formatItems(order.items),
      total: (order.total_cents / 100).toFixed(2),
      placed: new Date(order.created_at).toLocaleString(),
      deliveryStatus,
    };
    debug.facts = {
      order_id: String(facts.orderId),
      order_status: facts.orderStatus,
      items: facts.items,
      total: `$${facts.total}`,
      placed: facts.placed,
      delivery_status: facts.deliveryStatus,
    };

    context = appendTrace(context, {
      agent: "order-agent",
      action: "llm",
      detail: "compose customer reply",
    });

    const llm = await composeCustomerReply(facts);
    debug.llm = {
      mode: llm.mode,
      model: llm.model,
      systemPrompt: llm.systemPrompt,
      userPrompt: llm.userPrompt,
      rawOutput: llm.rawOutput,
      note: llm.note,
    };

    context = appendTrace(context, {
      agent: "order-agent",
      action: "llm_result",
      detail: `${llm.model} · ${llm.mode}`,
    });

    context = appendTrace(context, {
      agent: "order-agent",
      action: "reply",
      detail: `order ${orderId}`,
    });

    const response: A2ASendResponse = {
      message: textMessage("agent", llm.answer),
      context: { ...context, debug },
    };
    return res.json(response);
  } catch (err) {
    console.error("[order-agent] error:", err);
    return res.status(502).json({
      error: err instanceof Error ? err.message : "lookup failed",
      context: { ...context, debug },
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `[order-agent] listening on ${port} (LLM_MODE=${process.env.LLM_MODE || "buggy"})`
  );
});
