import { readFileSync } from "node:fs";
import type { Order, OrderItem, Product } from "./types.js";

/**
 * Everything the shopping agent can reach outside its own process.
 *
 * The whole demo turns on this seam: the same agent code runs against real
 * services or against a frozen fixture, and only the score changes.
 */
export interface ShopDeps {
  /** Human-readable label for logs and eval reports. */
  readonly kind: "live" | "stub";
  listProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | null>;
  checkStock(id: number, quantity: number): Promise<{ inStock: boolean; available: number } | null>;
  getOrder(id: number): Promise<Order | null>;
  /** Only called in execute mode; read-only runs stop at the tool call. */
  placeOrder(input: {
    items: OrderItem[];
    total_cents: number;
    customer_email?: string;
    baggage?: string;
  }): Promise<{ orderId: number; status: string }>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function getJson<T>(url: string, baggage?: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: baggage ? { baggage } : {},
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown, baggage?: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(baggage ? { baggage } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`POST ${url} failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

/** Talks to the real inventory-service and order-service. */
export function liveDeps(opts: {
  inventoryUrl: string;
  orderUrl: string;
  baggage?: string;
}): ShopDeps {
  const { inventoryUrl, orderUrl, baggage } = opts;
  return {
    kind: "live",
    async listProducts() {
      return (await getJson<Product[]>(`${inventoryUrl}/products`, baggage)) ?? [];
    },
    async getProduct(id) {
      return getJson<Product>(`${inventoryUrl}/products/${encodeURIComponent(String(id))}`, baggage);
    },
    async checkStock(id, quantity) {
      try {
        return await postJson<{ inStock: boolean; available: number }>(
          `${inventoryUrl}/products/${encodeURIComponent(String(id))}/check-stock`,
          { quantity },
          baggage
        );
      } catch {
        // check-stock 404s for unknown products; treat that as "no such product"
        // rather than an agent-visible error.
        return null;
      }
    },
    async getOrder(id) {
      return getJson<Order>(`${orderUrl}/orders/${encodeURIComponent(String(id))}`, baggage);
    },
    async placeOrder(input) {
      return postJson<{ orderId: number; status: string }>(
        `${orderUrl}/orders`,
        { items: input.items, total_cents: input.total_cents, customer_email: input.customer_email },
        input.baggage ?? baggage
      );
    },
  };
}

/**
 * Serves the catalogue from a frozen JSON snapshot.
 *
 * This is the stubbed half of the demo. The fixture and the eval labels were
 * generated from the same snapshot, so a stubbed run agrees with its labels by
 * construction — including where both have drifted away from what the cluster
 * actually holds.
 */
export function stubDeps(fixturePath: string): ShopDeps {
  const products: Product[] = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const byId = new Map(products.map((p) => [p.id, p]));
  return {
    kind: "stub",
    async listProducts() {
      return products;
    },
    async getProduct(id) {
      return byId.get(id) ?? null;
    },
    async checkStock(id, quantity) {
      const p = byId.get(id);
      if (!p) return null;
      return { inStock: p.stock >= quantity, available: p.stock };
    },
    async getOrder() {
      // The fixture carries a catalogue, not an order history. Refund cases in
      // the dataset supply the order in the prompt, so the agent never needs a
      // stubbed lookup to reach its decision.
      return null;
    },
    async placeOrder() {
      throw new Error("placeOrder is not available against stubbed dependencies");
    },
  };
}

/**
 * Picks dependencies from the environment.
 *
 * Live is chosen whenever the service URLs are present. Under `mirrord ci start`
 * they arrive from the target pod, so the eval command needs no flag to switch
 * modes — which is what lets the CI step stay byte-identical between the two
 * runs.
 */
export function depsFromEnv(baggage?: string): ShopDeps {
  const inventoryUrl = process.env.INVENTORY_SERVICE_URL?.trim();
  const orderUrl = process.env.ORDER_SERVICE_URL?.trim();

  if (inventoryUrl && orderUrl) {
    return liveDeps({ inventoryUrl, orderUrl, baggage });
  }

  const fixturePath =
    process.env.SHOPPING_AGENT_FIXTURE?.trim() ||
    new URL("../../eval/fixtures/catalogue-2026-03-16.json", import.meta.url).pathname;

  console.warn(
    "[agent] ***  STUBBED DEPENDENCIES  ***\n" +
      "[agent] INVENTORY_SERVICE_URL / ORDER_SERVICE_URL are unset, so the agent is\n" +
      `[agent] reading a frozen catalogue from ${fixturePath}.\n` +
      "[agent] Scores from this run describe the fixture, not the cluster."
  );
  return stubDeps(fixturePath);
}
