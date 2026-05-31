---
name: mirrord-run-shop
description: Use when running one MetalMart shop service locally under mirrord against the playground GKE cluster. Requires Playwright UI verification for catalog or frontend-affecting changes — not curl alone.
---

# Mirrord Run Shop

Use this for the local inner loop against https://playground.metalbear.dev/shop.

`curl` alone is not enough to mark shop or inventory work verified. Playwright catches UI failures (broken product images, empty `image_urls[0]`, layout regressions) that API JSON checks miss.

For the full PR → preview-build → agent iteration loop, use `mirrord-agent-shop` instead.

## Service Map

- inventory, inventory-service: `apps/shop/inventory-service`
- order, order-service: `apps/shop/order-service`
- payment, payment-service: `apps/shop/payment-service`
- delivery, delivery-service: `apps/shop/delivery-service`
- receipt, receipt-service: `apps/shop/receipt-service`
- frontend, shop, metal-mart-frontend: `apps/shop/metal-mart-frontend`

## Checks Before Start

```bash
mirrord --version
kubectl config current-context
kubectl -n shop get deploy <deployment>
ls apps/shop/<service>/mirrord.json
```

The kube context must be `gke_playground-383912_us-central1-c_playground-cluster-1`.

Set a stable session for the whole run:

```bash
export MIRRORD_SESSION="${MIRRORD_SESSION:-${USER:-cursor-shop}}"
```

## Run Under mirrord

Use absolute paths; `mirrord exec` must be the leading command:

```bash
mkdir -p /tmp/mirrord-run
USER="$MIRRORD_SESSION" \
  mirrord exec -f /workspace/playground/apps/shop/<service>/mirrord.json -- \
  npm --prefix /workspace/playground/apps/shop/<service> run dev
```

Route only your traffic with:

```text
baggage: mirrord-session=${MIRRORD_SESSION}
```

Do not widen `http_filter` in `mirrord.json` to make a test pass.

## Verify Traffic Is Stolen (curl)

Confirm filtered traffic hits the local process and unfiltered traffic does not (see `.cursor/rules/00-mirrord-inventory-service.mdc` for inventory).

```bash
curl -sS -H "baggage: mirrord-session=${MIRRORD_SESSION}" \
  https://playground.metalbear.dev/shop/api/products | jq '.[0:3] | .[] | {id, name, image_urls}'

curl -sS https://playground.metalbear.dev/shop/api/products | jq '.[0] | {id, name}'
```

Check the local service log for the filtered request; confirm the unfiltered request does **not** appear locally.

## Verify the Shop UI (Playwright) — required

Run Playwright after mirrord is up whenever the change affects products, images, catalog APIs, or anything the shop UI renders.

**Never** mutate the shared playground Postgres (or any cluster DB) to “verify” or “fix” data. Validate through the public shop path with mirrord + baggage only. Repair logic belongs in service code on your branch, not in ad-hoc `kubectl exec` SQL.

### Install once per session

```bash
mkdir -p /tmp/mirrord-run-shop && cd /tmp/mirrord-run-shop
[ -f package.json ] || npm init -y >/dev/null
[ -d node_modules/playwright ] || npm install --save-dev playwright >/dev/null
npx playwright install chromium --with-deps
mkdir -p /tmp/screenshots
rm -f /tmp/mirrord-run-shop/e2e.js /tmp/screenshots/mirrord-run-*
```

### Write `/tmp/mirrord-run-shop/e2e.js`

Adapt checks to the change. Keep this baseline for inventory / product-image work:

```js
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const session = process.env.MIRRORD_SESSION;
  if (!session) {
    console.error("Set MIRRORD_SESSION");
    process.exit(1);
  }
  const baggage = `mirrord-session=${session}`;
  const shopUrl = "https://playground.metalbear.dev/shop";
  const shotsDir = "/tmp/screenshots";
  const results = { session, checks: [], screenshots: [] };

  const check = (name, ok, detail = "") => {
    results.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: { baggage },
  });
  const page = await context.newPage();

  const assertImgLoaded = async (locator, label) => {
    await locator.first().waitFor({ state: "visible", timeout: 20000 });
    const info = await locator.first().evaluate((img) => ({
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      src: img.currentSrc || img.src,
    }));
    const ok = info.complete && info.naturalWidth > 0;
    check(`${label} image loaded`, ok, JSON.stringify(info));
    return ok;
  };

  try {
    // --- API: catch malformed image_urls (e.g. leading "") ---
    const productsRes = await page.request.get(`${shopUrl}/api/products`, {
      headers: { baggage },
    });
    const products = await productsRes.json();
    check("GET /api/products", productsRes.ok(), `status ${productsRes.status()}`);

    const badImageRows = (Array.isArray(products) ? products : []).filter((p) => {
      const urls = p.image_urls;
      if (!Array.isArray(urls) || urls.length === 0) return false;
      const first = urls[0];
      return typeof first !== "string" || first.trim() === "";
    });
    check(
      "no product has empty image_urls[0]",
      badImageRows.length === 0,
      badImageRows.length
        ? `ids=${badImageRows.map((p) => p.id).join(",")} urls=${JSON.stringify(badImageRows[0].image_urls)}`
        : `checked ${products.length} products`
    );

    const p2Res = await page.request.get(`${shopUrl}/api/products/2`, { headers: { baggage } });
    const p2 = await p2Res.json();
    check("GET /api/products/2", p2Res.ok(), `status ${p2Res.status()}`);
    const p2first = Array.isArray(p2.image_urls) ? p2.image_urls[0] : null;
    check(
      "product 2 image_urls[0] usable",
      typeof p2first === "string" && p2first.trim().length > 0,
      `image_urls=${JSON.stringify(p2.image_urls)} image_url=${p2.image_url}`
    );

    // --- UI: product list + detail images actually render ---
    await page.goto(`${shopUrl}/products`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    const noImageTiles = await page.getByText("No image", { exact: true }).count();
    check("products grid has no 'No image' tiles", noImageTiles === 0, `count=${noImageTiles}`);

    const gridImgs = page.locator('a[href*="/products/"] img');
    const gridCount = await gridImgs.count();
    check("products grid shows images", gridCount > 0, `img count=${gridCount}`);
    if (gridCount > 0) await assertImgLoaded(gridImgs, "products grid");

    const p2Path = `${shopUrl}/products/2`;
    await page.screenshot({ path: `${shotsDir}/mirrord-run-products.png`, fullPage: true });
    results.screenshots.push(`${shotsDir}/mirrord-run-products.png`);

    await page.goto(p2Path, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    const detailNoImage = await page.getByText("No image", { exact: true }).count();
    check("product 2 detail has no 'No image' placeholder", detailNoImage === 0, `count=${detailNoImage}`);

    const heroImg = page.locator(".aspect-square img");
    if ((await heroImg.count()) > 0) {
      await assertImgLoaded(heroImg, "product 2 detail hero");
    } else {
      check("product 2 detail hero image present", false, "no .aspect-square img found");
    }

    await page.screenshot({ path: `${shotsDir}/mirrord-run-product-2.png`, fullPage: true });
    results.screenshots.push(`${shotsDir}/mirrord-run-product-2.png`);
  } catch (err) {
    check("fatal", false, err.message || String(err));
    try {
      await page.screenshot({ path: `${shotsDir}/mirrord-run-fatal.png`, fullPage: true });
      results.screenshots.push(`${shotsDir}/mirrord-run-fatal.png`);
    } catch {}
  } finally {
    await browser.close();
    fs.writeFileSync("/tmp/screenshots/mirrord-run-results.json", JSON.stringify(results, null, 2));
    const allOk = results.checks.every((c) => c.ok);
    console.log(`\n${results.checks.filter((c) => c.ok).length}/${results.checks.length} checks passed`);
    process.exit(allOk ? 0 : 1);
  }
})();
```

### Run Playwright

```bash
cd /tmp/mirrord-run-shop
MIRRORD_SESSION="${MIRRORD_SESSION}" node e2e.js
cat /tmp/screenshots/mirrord-run-results.json
```

### Review screenshots

Use the image-reading tool on every PNG under `/tmp/screenshots/mirrord-run-*.png`. A visual failure (broken image icon, wrong product photo, empty tile) counts as a failed verification even if a narrow assertion passed.

## Completion Criteria

Do not mark shop or inventory work verified until all of the following hold:

- `npm --prefix apps/shop/<service> run lint` or `run build` passes for touched services
- Filtered public requests reach the local mirrord process; unfiltered requests do not
- Playwright exits 0 with the checks above (adapted if the change scope differs)
- Screenshots reviewed; product images visibly load on `/shop/products` and affected detail pages
- No unauthorized writes to shared cluster databases

## Inventory-Specific

For `inventory-service`, also follow `.cursor/rules/00-mirrord-inventory-service.mdc` and `.cursor/rules/01-no-staging-api-without-mirrord.mdc`.

## Handoff Block

```
✓ <service> running under mirrord (session: ${MIRRORD_SESSION})
  Log: check terminal / tmux session
  Header: baggage: mirrord-session=${MIRRORD_SESSION}
  Playwright: /tmp/screenshots/mirrord-run-results.json
  Screenshots: /tmp/screenshots/mirrord-run-products.png, mirrord-run-product-2.png
```
