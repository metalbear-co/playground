---
name: mirrord-run-shop
description: Use when running one MetalMart shop service locally under mirrord against the playground GKE cluster. Requires Playwright UI verification for catalog or frontend-affecting changes, not curl alone.
---

# Mirrord Run Shop

Use this for the local inner loop against `https://playground.metalbear.dev/shop`.

`curl` alone is not enough to mark shop or inventory work verified. Playwright
catches UI failures (broken product images, empty `image_urls[0]`, layout
regressions) that API JSON checks miss.

For full agent-owned implementation and validation, use `mirrord-agent-shop`.
That skill also uses local mirrord; it must not use the preview workflow.

## Service Map

- inventory, inventory-service: `apps/shop/inventory-service`
- order, order-service: `apps/shop/order-service`
- payment, payment-service: `apps/shop/payment-service`
- delivery, delivery-service: `apps/shop/delivery-service`
- receipt, receipt-service: `apps/shop/receipt-service`
- frontend, shop, metal-mart-frontend: `apps/shop/metal-mart-frontend`

## Checks Before Start

Run these before starting the service:

```bash
mirrord --version
kubectl config current-context
kubectl -n shop get deploy <deployment>
ls apps/shop/<service>/mirrord.json
```

The kube context must be
`gke_playground-383912_us-central1-c_playground-cluster-1`.

Set a stable session for the whole run:

```bash
export MIRRORD_SESSION="${MIRRORD_SESSION:-${USER:-cursor-shop}}"
```

Use a session value without slashes. The service `mirrord.json` files use the
`USER` environment variable as the mirrord key, so pass `USER="$MIRRORD_SESSION"`
when starting the process.

## Run Under mirrord

Use absolute paths; `mirrord exec` must be the command that starts the local app
process:

```bash
mkdir -p /tmp/mirrord-run
USER="$MIRRORD_SESSION" \
  mirrord exec -f /workspace/playground/apps/shop/<service>/mirrord.json -- \
  npm --prefix /workspace/playground/apps/shop/<service> run dev
```

Do not widen `http_filter` in `mirrord.json` to make a test pass.

For inventory or other backend validation, do **not** run
`metal-mart-frontend` under mirrord. Keep the deployed staging frontend/gateway
in the request path and access `https://playground.metalbear.dev/shop...` with
the baggage header. That proves how the local backend behaves behind the real
staging frontend.

## Reliable tmux Pattern

Use tmux for long-running mirrord services. In this Cursor Cloud base container,
`/exec-daemon/tmux.portal.conf` may be absent; when it is absent, use
`tmux -f /dev/null`. Starting the mirrord command directly as the tmux session's
initial command is the most reliable first attempt.

```bash
SESSION_NAME="<service>-mirrord"
TMUX_CONFIG="/exec-daemon/tmux.portal.conf"
if [ ! -f "$TMUX_CONFIG" ]; then TMUX_CONFIG="/dev/null"; fi

tmux -f "$TMUX_CONFIG" kill-session -t "$SESSION_NAME" 2>/dev/null || true
tmux -f "$TMUX_CONFIG" new-session -d -s "$SESSION_NAME" -c /workspace/playground \
  "export MIRRORD_SESSION='$MIRRORD_SESSION'; \
   export USER=\"\$MIRRORD_SESSION\"; \
   mirrord exec -f /workspace/playground/apps/shop/<service>/mirrord.json -- \
   npm --prefix /workspace/playground/apps/shop/<service> run dev"
tmux -f "$TMUX_CONFIG" capture-pane -pt "$SESSION_NAME:0.0" -S -200
```

If you need follow-up input, use the same `TMUX_CONFIG` for `send-keys`:

```bash
tmux -f "$TMUX_CONFIG" send-keys -t "$SESSION_NAME:0.0" -l '<command>'
tmux -f "$TMUX_CONFIG" send-keys -t "$SESSION_NAME:0.0" C-m
```

## Verify Traffic Is Stolen

Route only your filtered traffic with:

```text
baggage: mirrord-session=${MIRRORD_SESSION}
```

Confirm filtered public traffic reaches the local process:

```bash
curl -sS \
  -H "baggage: mirrord-session=${MIRRORD_SESSION}" \
  https://playground.metalbear.dev/shop/api/products | jq '.[0:5] | .[] | {id, name, image_urls}'
```

Send one matching unfiltered request while mirrord is running and confirm it does
not appear in the local service logs:

```bash
curl -sS https://playground.metalbear.dev/shop/api/products | jq '.[0] | {id, name}'
```

## Verify the Shop UI With Playwright

Run Playwright after mirrord is up whenever the change affects products, images,
catalog APIs, or anything the shop UI renders.

Never mutate the shared playground Postgres (or any cluster DB) to "verify" or
"fix" data. Validate through the public shop path with mirrord + baggage, or
through a local frontend wired to local/mirrord-backed services.

### Install once per session

```bash
mkdir -p /tmp/mirrord-run-shop /tmp/screenshots
[ -d /tmp/mirrord-run-shop/node_modules/playwright ] || npm --prefix /tmp/mirrord-run-shop install playwright
npx --prefix /tmp/mirrord-run-shop playwright install chromium
rm -f /tmp/mirrord-run-shop/e2e.js /tmp/screenshots/mirrord-run-*
```

### Backend/catalog public-path baseline

Use the public shop URL and baggage header so the request goes through the same
gateway and frontend API path a user uses:

```js
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const session = process.env.MIRRORD_SESSION;
  if (!session) throw new Error("Set MIRRORD_SESSION");

  const shopUrl = "https://playground.metalbear.dev/shop";
  const baggage = `mirrord-session=${session}`;
  const results = { checks: [], screenshots: [] };

  const check = (name, ok, detail = "") => {
    results.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: { baggage } });
  const page = await context.newPage();

  try {
    const productsRes = await page.request.get(`${shopUrl}/api/products`, {
      headers: { baggage },
    });
    const products = await productsRes.json();
    check("GET /api/products", productsRes.ok(), `status=${productsRes.status()}`);

    const badImageRows = (Array.isArray(products) ? products : []).filter((p) => {
      const urls = p.image_urls;
      if (!Array.isArray(urls) || urls.length === 0) return false;
      return typeof urls[0] !== "string" || urls[0].trim() === "";
    });
    check(
      "no product has empty image_urls[0]",
      badImageRows.length === 0,
      badImageRows.length ? `ids=${badImageRows.map((p) => p.id).join(",")}` : `checked=${products.length}`,
    );

    await page.goto(`${shopUrl}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    const noImageTiles = await page.getByText("No image", { exact: true }).count();
    check("products grid has no 'No image' tiles", noImageTiles === 0, `count=${noImageTiles}`);

    const gridImgs = page.locator('a[href*="/products/"] img');
    const gridCount = await gridImgs.count();
    check("products grid shows images", gridCount > 0, `img count=${gridCount}`);
    if (gridCount > 0) {
      const info = await gridImgs.first().evaluate((img) => ({
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        src: img.currentSrc || img.src,
      }));
      check("first grid image loaded", info.complete && info.naturalWidth > 0, JSON.stringify(info));
    }

    await page.screenshot({ path: "/tmp/screenshots/mirrord-run-products.png", fullPage: true });
    results.screenshots.push("/tmp/screenshots/mirrord-run-products.png");
  } catch (err) {
    check("fatal", false, err.message || String(err));
  } finally {
    await browser.close();
    fs.writeFileSync("/tmp/screenshots/mirrord-run-results.json", JSON.stringify(results, null, 2));
    process.exit(results.checks.every((c) => c.ok) ? 0 : 1);
  }
})();
```

### Frontend-local baseline

For frontend-only validation, or when the frontend itself has unreleased code,
run the frontend locally and validate `http://127.0.0.1:3000/shop`. Point API env
vars at local or mirrord-backed service URLs. Do not use this path as proof of
inventory/backend behavior; backend validation should use the deployed staging
frontend and public shop URL.

```bash
NEXT_BASE_PATH=/shop \
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=dxas4fpir \
INVENTORY_SERVICE_URL=http://127.0.0.1:80 \
npm --prefix /workspace/playground/apps/shop/metal-mart-frontend run dev
```

### Run Playwright

```bash
MIRRORD_SESSION="${MIRRORD_SESSION}" node /tmp/mirrord-run-shop/e2e.js
cat /tmp/screenshots/mirrord-run-results.json
```

Review every PNG under `/tmp/screenshots/mirrord-run-*.png`. A visual failure
(broken image icon, wrong product photo, empty tile) counts as a failed
verification even if a narrow assertion passed.

## Completion Criteria

Do not mark shop or inventory work verified until all of the following hold:

- `npm --prefix apps/shop/<service> run lint` or `run build` passes for touched services
- Filtered public requests reach the local mirrord process; unfiltered requests do not
- Playwright exits 0 with checks adapted to the change scope
- Screenshots reviewed; product images visibly load on `/shop/products` and affected detail pages
- No unauthorized writes to shared cluster databases

## Inventory-Specific

For `inventory-service`, also follow `.cursor/rules/00-mirrord-inventory-service.mdc`
and `.cursor/rules/01-no-staging-api-without-mirrord.mdc`.

## Handoff Block

```text
✓ <service> running under mirrord (session: ${MIRRORD_SESSION})
  Header: baggage: mirrord-session=${MIRRORD_SESSION}
  Playwright: /tmp/screenshots/mirrord-run-results.json
  Screenshots: /tmp/screenshots/mirrord-run-products.png
```
