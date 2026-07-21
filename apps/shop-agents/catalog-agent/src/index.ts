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

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const publicUrl =
  process.env.PUBLIC_URL || "http://catalog-agent.shop-agents.svc.cluster.local";
const inventoryServiceUrl =
  process.env.INVENTORY_SERVICE_URL ||
  "http://inventory-service.shop.svc.cluster.local";

type Product = {
  id: number;
  name: string;
  description?: string;
  price_cents: number;
  stock: number;
};

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/.well-known/agent.json", (_req, res) => {
  const card: AgentCard = {
    name: "catalog-agent",
    description: "Looks up MetalMart products and stock from inventory-service",
    url: publicUrl,
    version: "1.0.0",
    skills: [
      {
        id: "catalog_lookup",
        name: "Catalog lookup",
        description: "Answer product and stock questions using inventory APIs",
      },
    ],
  };
  res.json(card);
});

function extractProductId(text: string): number | null {
  const named = text.match(/product\s*#?\s*(\d+)/i);
  if (named) return parseInt(named[1], 10);
  const sku = text.match(/\b(?:id|sku)\s*[#:]?\s*(\d+)/i);
  if (sku) return parseInt(sku[1], 10);
  return null;
}

function wantsList(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("products") ||
    lower.includes("catalog") ||
    lower.includes("what do you sell") ||
    lower.includes("what's in stock") ||
    lower.includes("whats in stock") ||
    (lower.includes("list") && lower.includes("product"))
  );
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
    agent: "catalog-agent",
    action: "received",
    detail: query.slice(0, 120),
  });

  const debug: AgentDebug = { tools: [], facts: {} };

  try {
    const productId = extractProductId(query);

    if (productId != null) {
      const url = `${inventoryServiceUrl}/products/${productId}`;
      context = appendTrace(context, {
        agent: "catalog-agent",
        action: "tool",
        detail: `GET ${url}`,
      });
      const hit = await timedFetch(url);
      debug.tools!.push({
        name: "inventory-service",
        request: `GET /products/${productId}`,
        status: hit.status,
        ms: hit.ms,
        bodyPreview: hit.text.slice(0, 280),
      });
      context = appendTrace(context, {
        agent: "catalog-agent",
        action: "tool_result",
        detail: `inventory-service ${hit.status}`,
        ms: hit.ms,
        status: hit.status,
      });

      if (hit.status === 404) {
        const response: A2ASendResponse = {
          message: textMessage("agent", `I couldn't find product #${productId} in the catalog.`),
          context: {
            ...appendTrace(context, {
              agent: "catalog-agent",
              action: "not_found",
              detail: String(productId),
            }),
            debug,
          },
        };
        return res.json(response);
      }
      if (hit.status >= 400 || !hit.json) {
        throw new Error(`inventory-service returned ${hit.status}`);
      }

      const product = hit.json as Product;
      const price = (product.price_cents / 100).toFixed(2);
      debug.facts = {
        product_id: String(product.id),
        name: product.name,
        price: `$${price}`,
        stock: String(product.stock),
      };

      const availability =
        product.stock <= 0
          ? "Currently out of stock."
          : product.stock < 5
            ? `Low stock — ${product.stock} left.`
            : `In stock (${product.stock} available).`;

      const answer = [
        `${product.name} (product #${product.id})`,
        product.description?.trim() || null,
        `Price: $${price}`,
        availability,
      ]
        .filter(Boolean)
        .join("\n");

      context = appendTrace(context, {
        agent: "catalog-agent",
        action: "reply",
        detail: `product ${product.id}`,
      });

      return res.json({
        message: textMessage("agent", answer),
        context: { ...context, debug },
      } satisfies A2ASendResponse);
    }

    if (wantsList(query)) {
      const url = `${inventoryServiceUrl}/products`;
      context = appendTrace(context, {
        agent: "catalog-agent",
        action: "tool",
        detail: `GET ${url}`,
      });
      const hit = await timedFetch(url);
      debug.tools!.push({
        name: "inventory-service",
        request: "GET /products",
        status: hit.status,
        ms: hit.ms,
        bodyPreview: hit.text.slice(0, 280),
      });
      context = appendTrace(context, {
        agent: "catalog-agent",
        action: "tool_result",
        detail: `inventory-service ${hit.status}`,
        ms: hit.ms,
        status: hit.status,
      });

      if (hit.status >= 400 || !Array.isArray(hit.json)) {
        throw new Error(`inventory-service returned ${hit.status}`);
      }

      const products = hit.json as Product[];
      debug.facts = {
        product_count: String(products.length),
        sample: products
          .slice(0, 3)
          .map((p) => `#${p.id} ${p.name}`)
          .join(", "),
      };

      const lines = products.slice(0, 8).map((p) => {
        const price = (p.price_cents / 100).toFixed(2);
        return `• #${p.id} ${p.name} — $${price} (${p.stock} in stock)`;
      });
      const more =
        products.length > 8 ? `\n…and ${products.length - 8} more.` : "";

      context = appendTrace(context, {
        agent: "catalog-agent",
        action: "reply",
        detail: `${products.length} products`,
      });

      return res.json({
        message: textMessage(
          "agent",
          `Here's what we have in the catalog right now:\n${lines.join("\n")}${more}`
        ),
        context: { ...context, debug },
      } satisfies A2ASendResponse);
    }

    context = appendTrace(context, {
      agent: "catalog-agent",
      action: "clarify",
      detail: "need product id or list intent",
    });

    return res.json({
      message: textMessage(
        "agent",
        'I can look up stock and product details. Try "Is product 2 in stock?" or "What products do you sell?"'
      ),
      context: { ...context, debug },
    } satisfies A2ASendResponse);
  } catch (err) {
    console.error("[catalog-agent] error:", err);
    return res.status(502).json({
      error: err instanceof Error ? err.message : "lookup failed",
      context: { ...context, debug },
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[catalog-agent] listening on ${port}`);
});
