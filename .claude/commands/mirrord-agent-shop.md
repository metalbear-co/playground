Agent-driven preview + test loop for the MetalMart shop. Use this when the developer asks you to make a change and actually verify it end-to-end in a mirrord preview environment before handing it back.

**Difference from `/preview-shop`:** `/preview-shop` creates a preview and hands the URL to a PM to click around. `/mirrord-agent-shop` writes its own test plan, implements the change, runs Playwright against the preview itself, iterates privately until tests pass, and only then shows the developer screenshots + preview URL + mirrord header for review. If the developer gives feedback, loop again.

---

## Phases

### Phase 1 — Intake

- Restate the developer's change in **one sentence**.
- Read `.github/preview-services.json` and list which of `metal-mart-frontend`, `order-service`, `inventory-service`, `payment-service`, `delivery-service`, `receipt-service` this change will touch.
- **Preview-state awareness.** For each touched service, note whether it has `db_branches` configured in `preview-services.json`. Output a one-line classification per service:
  - `service-name (branched)` — mirrord branches the DB per preview key; tests can assume isolated state.
  - `service-name (shared DB)` — DB is shared across all previews; **test assertions must tolerate pre-existing rows** (query "most recent" / scope by run-start time / use a per-run unique marker like a UUID-suffixed `customer_email`).
  - `service-name (no DB)` — no DB at all.

  This gates how you write Phase 2 assertions. Get it wrong and tests will pass against stale data or fail against your own.

- **Migration hazard check.** If the change adds an `ALTER TABLE` / `CREATE TABLE` / DDL to a service whose `preview-services.json` entry lacks `db_branches`, surface this to the developer in one line: *"Heads-up: this migration will run against the shared DB and persist across all previews. Confirm before I proceed?"* Wait for an explicit ack — this is the *one* place a clarifying question is mandatory, not optional.
- Otherwise, ask **at most one** clarifying question, only if scope is genuinely ambiguous. Otherwise proceed.

### Phase 2 — Write the test plan (before any code)

Write a short, numbered test plan tailored to this specific change. Three sections:

- **Functional checks** — concrete assertions the test will make. Examples:
  - `GET /shop` returns 200 and the `<h1>` text matches `<expected>`
  - `POST /api/orders` with `items: [{productId: 1, quantity: 1}]` returns 200 with `status == "confirmed"`
  - Product detail page renders at least one `<img>` inside the gallery
- **Visual checks** — screenshots to take and what each one should show. Examples:
  - `iter<n>-home.png` — home page: new heading visible, product grid rendered, no visible error states
  - `iter<n>-cart.png` — cart page shows 1 item at the correct price
- **Regression guards** — existing flows that must still work. Examples:
  - Clicking any product tile on `/` opens the detail page
  - Checkout button on `/cart` navigates to `/checkout`

**For any service flagged `(shared DB)` in Phase 1**, every functional check that reads a row from that service must be written tolerant-of-stale-data:
- Use `ORDER BY created_at DESC LIMIT 1` semantics (e.g. assert *the most recent* delivery for an order, not "a delivery for an order").
- Or, inject a per-run unique marker into the row (e.g. UUID in `customer_email`) and filter by it.
- Or, capture a `runStart = new Date()` timestamp and only consider rows with `created_at >= runStart`.

Echo the plan to the developer as a short bulleted list. **Do not ask for approval.** Pause ~5 seconds for a veto; if none, proceed. If they object, revise and re-echo.

### Phase 3 — Branch, edit, commit, push, PR

Reuse `/preview-shop`'s strict branch-naming rule:

- Exactly **2 words**, kebab-case, ASCII lowercase, format `^[a-z]+-[a-z]+$`
- No `claude/` prefix, no slashes, no random suffix, no `demo-` prefix (we always dispatch previews explicitly)
- Correct: `cart-fix`, `product-search`, `rename-swag`
- Forbidden: `claude/foo-bar-xyz1`, `feature/foo`, `add-product-search-page`

```bash
git checkout main && git pull origin main
git checkout -b <word-word>
git branch --show-current   # must match ^[a-z]+-[a-z]+$
```

Edit files under `apps/shop/metal-mart-frontend/` or `apps/shop/<service>/`.

**When you add or modify UI elements that the Phase 2 plan asserts on, add a stable `data-testid="..."` attribute on the same commit.** `page.locator('h1')` and class-based selectors break the moment a designer edits copy or styling; `data-testid` does not. The corresponding `e2e.js` selector should be `page.locator('[data-testid="..."]')`.

Commit and push:

```bash
git add <changed-files>
git commit -m "<type>(<scope>): <description>"
git push -u origin "$(git branch --show-current)"
```

Create the PR — prefer `gh pr create --base main --head <branch>`; if `gh` is unavailable, fall back to `POST https://api.github.com/repos/metalbear-co/playground/pulls` via `WebFetch` (same pattern as `/preview-shop` step 5). If `gh pr create` fails with a `Resource not accessible by personal access token` error, the active GH auth is a fine-grained PAT without PR-create scope; `unset GITHUB_TOKEN` and retry — `gh` will fall back to the keyring token. Capture:

```
BRANCH=<word-word>
PR_NUMBER=<n>
PR_URL=<https://github.com/metalbear-co/playground/pull/n>
PREVIEW_KEY="$BRANCH"
```

### Phase 3a — Dispatch preview + wait (shared helper, called from 3, 5, 7)

**Always** explicit `workflow_dispatch` — uniform path for first build and every rebuild. Do not rely on the `demo-*` auto-trigger.

```bash
CALLER_ID="claude-$(date +%s)"
gh workflow run preview-shop-pr.yml \
  --repo metalbear-co/playground \
  --ref main \
  -f action=start \
  -f branch="$BRANCH" \
  -f base_ref=main \
  -f preview_key="$BRANCH" \
  -f pr_number="$PR_NUMBER" \
  -f pr_url="$PR_URL" \
  -f caller_run_id="$CALLER_ID"
```

Find the dispatched run by correlating `caller=$CALLER_ID` in `displayTitle`:

```bash
RUN_ID=""
for i in $(seq 1 12); do
  RUN_ID=$(gh run list \
    --repo metalbear-co/playground \
    --workflow=preview-shop-pr.yml \
    --event workflow_dispatch \
    --limit 20 \
    --json databaseId,displayTitle \
    --jq ".[] | select(.displayTitle | contains(\"caller=$CALLER_ID\")) | .databaseId" | head -n1)
  [ -n "$RUN_ID" ] && break
  sleep 10
done
```

Poll every 60 seconds, up to 20 ticks (~20 min). Single-line progress update each tick: `preview build: <status> (run $RUN_ID, tick N/20)`.

```bash
STATUS=$(gh run view "$RUN_ID" --repo metalbear-co/playground --json status --jq '.status')
# completed → fetch conclusion; otherwise sleep 60 and repeat
```

On `conclusion != success`:

```bash
gh run view "$RUN_ID" --repo metalbear-co/playground --log-failed | tail -n 200
```

Summarize the failure in 1-2 lines and treat it as a test failure — go to Phase 5.

**Fallback when `gh` is unavailable** (e.g. web Claude Code): dispatch via the REST API:

```
POST https://api.github.com/repos/metalbear-co/playground/actions/workflows/preview-shop-pr.yml/dispatches
Headers: Authorization: Bearer <GITHUB_TOKEN>, Accept: application/vnd.github+json
Body: {"ref": "main", "inputs": {"action":"start", "branch":"<BRANCH>", "base_ref":"main", "preview_key":"<BRANCH>", "pr_number":"<PR_NUMBER>", "pr_url":"<PR_URL>", "caller_run_id":"<CALLER_ID>"}}
```

Then poll `GET /repos/metalbear-co/playground/actions/runs?event=workflow_dispatch&per_page=20` and filter for a run whose `display_title` contains `caller=<CALLER_ID>`.

### Phase 4 — Agent executes the test plan against the preview

**4a. Install Playwright once per session (cached in `/tmp/mirrord-agent-shop/`) and clean prior-iteration artifacts:**

```bash
mkdir -p /tmp/mirrord-agent-shop && cd /tmp/mirrord-agent-shop
[ -f package.json ] || npm init -y >/dev/null
[ -d node_modules/playwright ] || npm install --save-dev playwright >/dev/null
npx playwright install chromium --with-deps
mkdir -p /tmp/screenshots
# Clean stale artifacts so re-runs don't carry over old screenshots and so
# the Write tool doesn't refuse to overwrite e2e.js without a prior Read.
rm -f /tmp/mirrord-agent-shop/e2e.js
rm -f /tmp/screenshots/iter*-*
```

**4b. Write `/tmp/mirrord-agent-shop/e2e.js`** from the Phase 2 test plan. Use this template (adapted from `.github/workflows/preview-verification.yml`):

```js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const previewKey = process.env.PREVIEW_KEY;
  const iter = process.env.ITER || '1';
  const shotsDir = '/tmp/screenshots';
  const shopUrl = 'https://playground.metalbear.dev/shop';
  const baggage = `mirrord-session=${previewKey}`;
  // runStart is useful when asserting against shared-DB services: filter
  // returned rows by created_at >= runStart to ignore stale rows from
  // earlier preview runs.
  const runStart = new Date();
  const results = { iter, previewKey, runStart: runStart.toISOString(), checks: [], screenshots: [] };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    extraHTTPHeaders: { baggage },
  });
  const page = await ctx.newPage();

  // IMPORTANT: always include the *actual* returned value/status in `detail`.
  // A failed assertion's detail string is what lets you diagnose in one
  // glance without re-running. "got: undefined" beats "failed".
  const check = (name, ok, detail) => {
    results.checks.push({ name, ok, detail: detail || '' });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const shoot = async (label) => {
    const p = `${shotsDir}/iter${iter}-${label}.png`;
    await page.screenshot({ path: p, fullPage: true });
    results.screenshots.push(p);
  };

  try {
    // === One block per Phase 2 functional + visual check ===
    // Prefer [data-testid="..."] selectors over h1/class-based ones — they
    // survive copy and styling changes. Add the data-testid to the JSX in
    // the same commit as the test.
    await page.goto(shopUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const h1 = (await page.locator('h1').first().textContent().catch(() => '')) || '';
    check('home heading present', h1.trim().length > 0, `got: "${h1.trim()}"`);
    await shoot('home');

    // Example API check with the baggage header:
    // const r = await page.request.post(`${shopUrl}/api/orders`, {
    //   headers: { baggage, 'Content-Type': 'application/json' },
    //   data: { items: [{ productId: 1, quantity: 1 }], total_cents: 1999 },
    // });
    // const body = await r.json().catch(() => ({}));
    // check('POST /api/orders', r.ok(), `status ${r.status()} body=${JSON.stringify(body).slice(0, 160)}`);

    // === Pattern: querying a SHARED-DB service ===
    // Don't assume the first row is yours. Either filter by a unique marker
    // you set on the request, or assert against the most-recent matching
    // row. Example for a delivery created via Kafka after a POST /orders:
    //
    //   for (let attempt = 0; attempt < 12; attempt++) {
    //     const dRes = await page.request.get(`${shopUrl}/api/deliveries/order/${orderId}`, { headers: { baggage } });
    //     const body = await dRes.json().catch(() => null);
    //     // If the API doesn't already return the latest row, filter:
    //     if (body && new Date(body.created_at) >= runStart) {
    //       /* assert here */
    //       break;
    //     }
    //     await new Promise((r) => setTimeout(r, 2500));
    //   }
  } catch (err) {
    check('fatal', false, err.message || String(err));
    try { await shoot('fatal'); } catch {}
  } finally {
    await browser.close();
    fs.writeFileSync(`${shotsDir}/iter${iter}-results.json`, JSON.stringify(results, null, 2));
    const allOk = results.checks.every(c => c.ok);
    console.log(`\n${results.checks.filter(c => c.ok).length}/${results.checks.length} checks passed`);
    process.exit(allOk ? 0 : 1);
  }
})();
```

One `check()` call per functional check from the plan, one `shoot()` per visual check, `page.request.get/post` for API checks (always pass `headers: { baggage }`).

**4c. Run it:**

```bash
cd /tmp/mirrord-agent-shop && PREVIEW_KEY="$BRANCH" ITER=<n> node e2e.js
cat /tmp/screenshots/iter<n>-results.json
```

**4d. Self-review visually:** for every `iter<n>-*.png`, use the `Read` tool to view the image and compare against the visual criteria written in the Phase 2 plan. If the screenshot doesn't match — heading missing, layout broken, element not visible, unexpected empty state — record that as a failed check **even if the Playwright assertions passed**. Add the visual failure to the results summary.

### Phase 5 — Agent-internal iteration (no developer involvement)

If any functional check failed, any visual self-review flagged a problem, or the preview build failed:

1. Diagnose the root cause from the failing assertion / screenshot / `gh run view --log-failed` output. **Before assuming a product bug, check whether the failure is a shared-DB / stale-data artifact** (review the `detail` string for `created_at` older than `runStart`, or for `id` values that don't fit the freshly-branched DB). If yes, the fix is in the test (or in the API to return the latest row), not in unrelated product code.
2. Edit code, commit (`fix: <concise diagnosis>` or `refactor: ...`), `git push`.
3. Re-enter Phase 3a (rebuild), then Phase 4 with `ITER=<n+1>`.

**Agent-internal cap: 3 attempts.** If still failing after 3 attempts, break out and go to Phase 6 with the report honestly labeled `⚠ Could not get all checks passing after 3 attempts. Need your input.` — list the failing checks. Do not pretend a failing build is passing.

### Phase 6 — Present to developer

**Only reach this phase after tests pass, or after 3 failed internal attempts.** Single concise report:

```
<change summary in one line>

Preview URL: https://playground.metalbear.dev/shop
Header:      baggage: mirrord-session=<BRANCH>
PR:          <PR_URL>

Tests (iter <n>): <N/N passed>
  ✓ <functional check 1>
  ✓ <functional check 2>
  ✗ <functional check 3> — <detail>   (only if some failed)

Screenshots:
  /tmp/screenshots/iter<n>-home.png — <one-line description of what I saw>
  /tmp/screenshots/iter<n>-<step>.png — <...>

Notes from iteration: <only if iter > 1 — one line per fix made during the loop>

Open the URL with the baggage header to review yourself — either the mirrord
Browser Extension (set `baggage: mirrord-session=<BRANCH>`) or:

  curl -H "baggage: mirrord-session=<BRANCH>" https://playground.metalbear.dev/shop

Your turn:
  (a) approve — stop the loop, leave the PR open
  (b) feedback — tell me what to change
  (c) pivot   — different approach
  (d) abort   — close PR, stop preview
```

If Phase 5 hit its internal cap, prepend:

```
⚠ Could not get all checks passing after 3 attempts. Need your input.
```

### Phase 7 — Developer-feedback iteration

- **(a) approve** → Phase 8 approve path.
- **(b) feedback** → restate the feedback in one line. If it implies new assertions, update the Phase 2 test plan. Edit code, commit (`iter<n+1>: <desc>`), push. Re-enter Phase 3a → Phase 4 → Phase 5 (agent-internal re-test if needed) → Phase 6.
- **(c) pivot** → ask 1-2 clarifying questions, then treat as (b) and rewrite the relevant parts of the test plan before coding.
- **(d) abort** → Phase 8 abort path.

**Developer-feedback iteration cap: 5.** At iteration 5, pause before testing and ask: *"we've iterated 5 times with your feedback — continue, re-scope, or take a break?"*

### Phase 8 — Exit

**Approve path (no merging):**

```bash
gh workflow run preview-shop-pr.yml \
  --repo metalbear-co/playground \
  --ref main \
  -f action=stop \
  -f preview_key="$BRANCH" \
  -f pr_number="$PR_NUMBER" \
  -f pr_url="$PR_URL" \
  -f caller_run_id="claude-stop-$(date +%s)"
```

Tell the developer: *"PR is open at `<PR_URL>` for review. Preview stopped. Merge it yourself when ready."*

**Abort path:**

```bash
gh pr close "$PR_URL" --delete-branch
# + the same stop dispatch above, in case the preview was still running
```

---

## Cheat sheet

| | |
|---|---|
| Preview URL | `https://playground.metalbear.dev/shop` |
| Routing header | `baggage: mirrord-session=$BRANCH` |
| Start preview | `gh workflow run preview-shop-pr.yml --repo metalbear-co/playground --ref main -f action=start -f branch=$BRANCH -f base_ref=main -f preview_key=$BRANCH -f pr_number=$PR_NUMBER -f pr_url=$PR_URL -f caller_run_id=$CALLER_ID` |
| Stop preview | same, `-f action=stop` (omit `branch`, `base_ref`) |
| Find run | `gh run list --repo metalbear-co/playground --workflow=preview-shop-pr.yml --event workflow_dispatch --json databaseId,displayTitle --jq '.[] \| select(.displayTitle \| contains("caller=<id>")) \| .databaseId'` |
| Poll run | `gh run view $RUN_ID --repo metalbear-co/playground --json status,conclusion` |
| Failed logs | `gh run view $RUN_ID --repo metalbear-co/playground --log-failed` |
| Screenshots | `/tmp/screenshots/iter<n>-*.png` |
| Test script | `/tmp/mirrord-agent-shop/e2e.js` |
| Results JSON | `/tmp/screenshots/iter<n>-results.json` |
| Services list | `.github/preview-services.json` |
| Branched DBs | services in `preview-services.json` whose `extra_config` includes `db_branches` |

## Guardrails

- **Never merge the PR.** Approval ends the loop; the developer merges on their own.
- **Never present a preview URL to the developer before Phase 4 tests pass** (or before the 3-attempt internal cap is hit — and in that case, label the report as a failure).
- **Never skip Phase 2** — the test plan must exist before code is written. If the developer's request is too vague to write a plan from, that is the one clarifying question to ask in Phase 1.
- **Never poll the preview run faster than every 60 seconds.**
- **Never use `--no-verify` or `git push --force`** during internal iteration.
- **Treat a visual self-review failure as a real failure** even if Playwright assertions passed — a green test suite with a broken-looking UI still goes to Phase 5.
- **Never assert against a shared-DB service without staleness tolerance.** Either the API must return "the most recent" row, or the test must filter by `created_at >= runStart` / a per-run unique marker. A green test against stale data is worse than a red one.
- **Always prefer `[data-testid="..."]` selectors** over tag/class-based selectors for any element introduced by this change. Add the testid in the same commit as the JSX edit.
