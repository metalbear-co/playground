import type Anthropic from "@anthropic-ai/sdk";
import type { ShopDeps } from "./deps.js";
import type { OrderItem, TerminalCall } from "./types.js";

/**
 * Tool surface for the shopping agent.
 *
 * Read tools answer questions about the catalogue and past orders. The three
 * terminal tools end the turn, and one of them — with its arguments — is what
 * each eval case is labelled with.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search the Metal Mart catalogue by free text. Returns matching products with their id, " +
      "name, description, price in cents, and current stock. Use this when the customer names a " +
      "product loosely, asks for a category, or asks what is available.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Words to match against product names and descriptions. Empty returns the whole catalogue.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_product",
    description:
      "Fetch one product by id. Returns its price in cents and current stock. Call this before " +
      "placing an order so the total is computed from real prices.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "integer", description: "The product id." } },
      required: ["product_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "check_stock",
    description:
      "Check whether a product has at least the requested quantity available. Call this before " +
      "placing an order for any quantity greater than one.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "integer" },
        quantity: { type: "integer", description: "How many units the customer wants." },
      },
      required: ["product_id", "quantity"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_order",
    description: "Look up a past order by id, to check its status, items, and total before refunding it.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "integer" } },
      required: ["order_id"],
      additionalProperties: false,
    },
    strict: true,
  },

  // ---- terminal tools -----------------------------------------------------
  {
    name: "place_order",
    description:
      "Place the customer's order. Ends the conversation turn. total_cents must be the sum of " +
      "each product's real price multiplied by its quantity — look the prices up first rather " +
      "than assuming them.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "One entry per distinct product.",
          items: {
            type: "object",
            properties: {
              productId: { type: "integer" },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["productId", "quantity"],
            additionalProperties: false,
          },
        },
        total_cents: { type: "integer", description: "Order total in cents." },
        customer_email: { type: "string", description: "Only when the customer gave one." },
      },
      required: ["items", "total_cents"],
      additionalProperties: false,
    },
  },
  {
    name: "offer_alternative",
    description:
      "Offer a different product instead. Ends the conversation turn. Use this when what the " +
      "customer asked for is out of stock, short of the quantity they want, or not in the " +
      "catalogue at all. Pick the closest available product by kind and price.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "integer", description: "The product being offered instead." },
        reason: { type: "string", description: "Short explanation for the customer." },
      },
      required: ["product_id", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "issue_refund",
    description:
      "Refund a past order. Ends the conversation turn. Use this when the customer reports a " +
      "problem with an order they have already received.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "integer" },
        reason: { type: "string", description: "Short explanation for the customer." },
      },
      required: ["order_id", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/**
 * Words too common to narrow a catalogue search. Kept deliberately small: these
 * are filler that appears inside product names ("Mind The Gap"), not a general
 * English stoplist.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "with", "my", "me", "i",
  "some", "please", "want", "need", "get", "buy", "order", "one", "it", "that", "this",
]);

/** Narrows a raw tool_use input into a TerminalCall, or null if it is a read tool. */
export function asTerminalCall(name: string, input: unknown): TerminalCall | null {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "place_order": {
      const items = Array.isArray(args.items) ? (args.items as OrderItem[]) : [];
      return {
        tool: "place_order",
        args: {
          items,
          total_cents: Number(args.total_cents ?? 0),
          ...(typeof args.customer_email === "string" ? { customer_email: args.customer_email } : {}),
        },
      };
    }
    case "offer_alternative":
      return {
        tool: "offer_alternative",
        args: { product_id: Number(args.product_id), reason: String(args.reason ?? "") },
      };
    case "issue_refund":
      return {
        tool: "issue_refund",
        args: { order_id: Number(args.order_id), reason: String(args.reason ?? "") },
      };
    default:
      return null;
  }
}

/** Runs one read tool. Terminal tools never reach here. */
export async function runReadTool(
  name: string,
  input: unknown,
  deps: ShopDeps
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_products": {
      // inventory-service exposes no search endpoint, so matching happens here
      // over the full catalogue. That keeps the drift where it belongs: in the
      // rows the service returns, not in a query the stub could answer differently.
      const query = String(args.query ?? "").toLowerCase().trim();
      const all = await deps.listProducts();
      if (!query) return all;

      const terms = query.split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
      if (terms.length === 0) return all;

      const haystackOf = (p: { name: string; description: string | null }) =>
        `${p.name} ${p.description ?? ""}`.toLowerCase();

      // Require every meaningful term, so "mind the gap" does not also drag in
      // every product whose name happens to contain "the".
      const strict = all.filter((p) => terms.every((t) => haystackOf(p).includes(t)));
      if (strict.length > 0) return strict;

      // Nothing matched everything — fall back to ranked partial matches so the
      // agent gets candidates to reason about instead of a dead end.
      const ranked = all
        .map((p) => ({ p, score: terms.filter((t) => haystackOf(p).includes(t)).length }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.p);

      return ranked.length > 0
        ? ranked
        : { matches: [], note: "No product matched that query." };
    }
    case "get_product": {
      const product = await deps.getProduct(Number(args.product_id));
      return product ?? { error: "No product with that id." };
    }
    case "check_stock": {
      const result = await deps.checkStock(Number(args.product_id), Number(args.quantity ?? 1));
      return result ?? { error: "No product with that id." };
    }
    case "get_order": {
      const order = await deps.getOrder(Number(args.order_id));
      return order ?? { error: "No order with that id." };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
