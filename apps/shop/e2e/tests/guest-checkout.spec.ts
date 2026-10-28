/**
 * E2E-01: guest checkout, single product.
 *
 * Drives the live storefront through a full order: home, product, cart,
 * checkout, order tracking. Every request carries
 * `baggage: mirrord-session=<E2E_SESSION_KEY>`, so the services that run on
 * the CI runner under `mirrord up` (order, payment, delivery) receive this
 * order while the rest of the cluster serves everyone else.
 *
 * Env:
 *   E2E_SESSION_KEY  required, the mirrord session key (e.g. e2e-<run_id>)
 *   SHOP_URL         storefront base, default https://playground.metalbear.dev/shop
 *   E2E_RESULTS_FILE where the order id and step outcomes are written as JSON
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SESSION_KEY = process.env.E2E_SESSION_KEY;
const SHOP_URL = (process.env.SHOP_URL || "https://playground.metalbear.dev/shop").replace(/\/$/, "");
const RESULTS_FILE = process.env.E2E_RESULTS_FILE || "/tmp/e2e/results.json";
const EMAIL = `${SESSION_KEY}@metalbear.dev`;

type Step = { name: string; ok: boolean; detail?: string };

if (!SESSION_KEY) throw new Error("E2E_SESSION_KEY must be set");

test.use({
  extraHTTPHeaders: { baggage: `mirrord-session=${SESSION_KEY}` },
});

async function waitForTrackingLine(page: Page, label: RegExp, attempts: number): Promise<string | null> {
  // The tracking page fetches once on load, so reload between attempts. The
  // line is read from its own element: `main` text runs the lines together.
  for (let i = 0; i < attempts; i++) {
    const line = page.getByText(label).first();
    if ((await line.count()) > 0) return ((await line.textContent()) || "").trim();
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: "networkidle" });
  }
  return null;
}

test("E2E-01 guest checkout, single product", async ({ page }) => {
  const steps: Step[] = [];
  let orderId: number | null = null;
  const record = (name: string, ok: boolean, detail?: string) => {
    steps.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    await page.goto(SHOP_URL, { waitUntil: "networkidle" });
    const productLinks = page.locator('a[href*="/products/"]');
    await expect(productLinks.first()).toBeVisible();
    record("home: product tiles rendered", true, `${await productLinks.count()} links`);

    await productLinks.first().click();
    await page.waitForURL(/\/products\/\d+/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    record("product page loaded", true, page.url());

    await page.getByRole("link", { name: /add to cart/i }).first().click();
    await page.waitForURL(/\/cart/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Your cart is empty")).toHaveCount(0);
    record("cart has the item", true);

    await page.getByRole("link", { name: /checkout/i }).first().click();
    await page.waitForURL(/\/checkout/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.getByRole("button", { name: /place order/i }).click();

    await expect(page.getByText("Order placed!")).toBeVisible({ timeout: 60_000 });
    const idText = (await page.getByText(/Order ID:/).textContent()) || "";
    orderId = Number((idText.match(/(\d+)/) || [])[1]);
    expect(orderId, `order id from "${idText}"`).toBeGreaterThan(0);
    record("checkout: order placed", true, `order ${orderId}`);

    await page.getByRole("link", { name: /track order/i }).click();
    await page.waitForURL(new RegExp(`/orders/${orderId}`), { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Status:\s*confirmed/)).toBeVisible();
    record("tracking: order status confirmed", true);

    // The delivery row is written by delivery-service after it consumes the
    // Kafka message, which the queue split routes to the runner's copy.
    const delivery = await waitForTrackingLine(page, /^Delivery:\s*\w+/, 20);
    record("tracking: delivery row present", Boolean(delivery), delivery || "no delivery line after 60s");
    expect(delivery, "delivery row on tracking page").not.toBeNull();

    await page.screenshot({ path: `${dirname(RESULTS_FILE)}/order-${orderId}.png`, fullPage: true });
  } catch (err) {
    // Keep the failing step in the results so the job summary shows where the
    // flow broke, then let Playwright report the failure.
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    const next = ["home", "product page", "cart", "checkout", "tracking: order status", "tracking: delivery row"][steps.length] || "step";
    record(`${next} failed`, false, detail);
    throw err;
  } finally {
    mkdirSync(dirname(RESULTS_FILE), { recursive: true });
    writeFileSync(
      RESULTS_FILE,
      JSON.stringify({ scenario: "E2E-01", sessionKey: SESSION_KEY, orderId, email: EMAIL, steps }, null, 2)
    );
  }
});
