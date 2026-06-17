---
name: mirrord-agent-shop
description: Use when a developer asks for a MetalMart shop change that must be implemented and verified end-to-end with local mirrord and Playwright before handoff.
---

# Mirrord Agent Shop

Use this skill when the agent must own implementation and validation for the
MetalMart shop. This workflow is local-mirrord-only: do not dispatch or wait for
the `preview-shop-pr.yml` workflow, and do not use `mirrord preview` as the
agent validation path.

Read `docs/AI_ROOT_CONTEXT.md` first for repo and deployment context.

## Phase 1: Intake

- Restate the requested change in one sentence.
- Identify which shop services are affected:
  - `metal-mart-frontend`
  - `inventory-service`
  - `order-service`
  - `payment-service`
  - `delivery-service`
  - `receipt-service`
- Classify each touched service as:
  - `shared DB` if it uses playground Postgres or another shared backing store
  - `no DB` if it has no database
- If the change introduces DDL or requires shared DB mutation, stop and ask for
  explicit human confirmation. Never mutate the shared playground database as a
  validation shortcut.
- Ask at most one clarifying question, and only if scope is genuinely ambiguous.

## Phase 2: Write the Test Plan Before Code

Write a short numbered plan with three sections:

1. Functional checks
2. Visual checks
3. Regression guards

For any `shared DB` service, data assertions must tolerate stale rows. Use one of:

- Most-recent-row semantics
- A unique per-run marker
- `created_at >= runStart`

Echo the plan briefly, do not ask for approval, and proceed unless the developer
objects.

## Phase 3: Branch, Edit, Commit, Push, PR

- Create a normal feature branch that follows the active cloud-agent branch
  requirements.
- Edit only the touched app or service paths plus tests/helpers needed for the
  requested validation.
- When tests depend on changed UI, add stable `data-testid="..."` attributes in
  the same commit as the UI change.
- Commit and push the implementation before validation starts.
- Open or update the PR before validation starts; update it again after any
  validation-driven fixes, including Playwright screenshots (see Phase 6).

Capture:

```text
BRANCH=<branch>
PR_URL=<url>
MIRRORD_SESSION=<stable lowercase session key>
```

Use a session key without slashes, for example the final branch path segment with
any unsupported characters replaced by `-`.

## Phase 4: Start Local Services Under mirrord

Before any request to `https://playground.metalbear.dev/shop...`, confirm the
target and cluster:

```bash
mirrord --version
kubectl config current-context
kubectl -n shop get deploy <deployment>
test "$(kubectl config current-context)" = "gke_playground-383912_us-central1-c_playground-cluster-1"
```

Start each touched service with its checked-in `mirrord.json`. Keep
`mirrord exec` as the command that starts the app process; do not widen
`http_filter` settings.

Use the same `MIRRORD_SESSION` for every touched service in the run. Start
backends first, then `metal-mart-frontend` when the frontend itself is in scope.

For backend-only or inventory validation, do **not** run `metal-mart-frontend`
under mirrord. Leave the deployed staging frontend/gateway in the request path
and access `https://playground.metalbear.dev/shop...` with the baggage header so
the test shows how the local backend behaves behind the real staging frontend.

For frontend changes, run `metal-mart-frontend` under mirrord as well. Do not
start it with plain `npm run dev` or validate against `localhost`. Let mirrord
inject cluster env and DNS so API routes reach in-cluster backends (or other
local mirrord-backed services started with the same session). Access the shop
only through `https://playground.metalbear.dev/shop...` with the baggage header.

### Reliable tmux pattern in this container

In the Cursor Cloud base used here, `/exec-daemon/tmux.portal.conf` may be
absent. If it is absent, use `tmux -f /dev/null`. Prefer starting the long-running
mirrord command directly as the tmux session command; this worked reliably on the
first attempt and avoids shell/client edge cases with `send-keys`.

```bash
SESSION_NAME="<service>-mirrord"
MIRRORD_SESSION="<stable-session-key>"
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

If follow-up input is required, use the same `-f "$TMUX_CONFIG"` value for
`send-keys`:

```bash
tmux -f "$TMUX_CONFIG" send-keys -t "$SESSION_NAME:0.0" -l '<command>'
tmux -f "$TMUX_CONFIG" send-keys -t "$SESSION_NAME:0.0" C-m
```

## Phase 5: Validate With Local mirrord

### Backend or catalog changes

Send filtered traffic through the public user-facing shop path so the request
exercises the gateway, frontend API route, and local mirrord service:

```bash
curl -sS \
  -H "baggage: mirrord-session=${MIRRORD_SESSION}" \
  https://playground.metalbear.dev/shop/api/products
```

Also send one matching unfiltered request while mirrord is running and confirm it
does not appear in the local service logs:

```bash
curl -sS https://playground.metalbear.dev/shop/api/products
```

For inventory/product-catalog changes, follow
`.cursor/rules/00-mirrord-inventory-service.mdc` end-to-end.

### Frontend changes

When the frontend itself is changed or the test must exercise unreleased frontend
code, start `metal-mart-frontend` under mirrord with the same tmux pattern as
backends. Do not use `localhost`, `127.0.0.1`, or hand-wired
`INVENTORY_SERVICE_URL` overrides for validation.

If a backend is also in scope, keep that backend running under mirrord with the
same `MIRRORD_SESSION` so filtered public traffic exercises the full user path:
gateway → local frontend → local or in-cluster backend.

Send filtered traffic through the public shop URL:

```bash
curl -sS \
  -H "baggage: mirrord-session=${MIRRORD_SESSION}" \
  https://playground.metalbear.dev/shop/api/products
```

Confirm filtered page loads reach the local frontend process and one unfiltered
request to the same public URL does not.

## Phase 6: Playwright Verification

Install Playwright once per session outside the repo:

```bash
mkdir -p /tmp/mirrord-agent-shop /tmp/screenshots
[ -d /tmp/mirrord-agent-shop/node_modules/playwright ] || npm --prefix /tmp/mirrord-agent-shop install playwright
npx --prefix /tmp/mirrord-agent-shop playwright install chromium
rm -f /tmp/mirrord-agent-shop/e2e.js /tmp/screenshots/iter*-results.json
```

Write `/tmp/mirrord-agent-shop/e2e.js` from the Phase 2 plan. Use:

- `BASE_URL=https://playground.metalbear.dev/shop` for all mirrord validation
  (frontend and backend). Never use `localhost` or `127.0.0.1` as the Playwright
  base URL in this skill.
- `MIRRORD_SESSION` and `extraHTTPHeaders: { baggage: "mirrord-session=..." }`
  on the browser context (and on `page.request` calls) whenever mirrord is running
- one `check()` per functional assertion
- one screenshot per visual assertion
- stable `[data-testid="..."]` selectors for changed UI when available

Run the script and save JSON results under `/tmp/screenshots/iter<n>-results.json`.
Review every screenshot with the available image-viewing tool. A visual mismatch
counts as failed verification even if Playwright exits 0.

### Stage screenshots for the PR

After the final passing Playwright run, stage screenshots for PR upload:

```bash
.cursor/scripts/stage-playwright-screenshots.sh /tmp/screenshots/iter<n>-*.png
```

Update the PR body with a **Playwright verification** section that embeds the
staged images using the printed `<img>` tags. Paths must be under
`/opt/cursor/artifacts/screenshots/` so the PR tool uploads them:

```html
## Playwright verification

<img alt="iter1 home" src="/opt/cursor/artifacts/screenshots/iter1-home.png" />
<img alt="iter1 products" src="/opt/cursor/artifacts/screenshots/iter1-products.png" />
```

Include one `<img>` per visual check from the test plan. Do not hand off without
uploading screenshots when Playwright was used.

## Phase 7: Internal Iteration

If a functional check fails, screenshot review fails, or a local service fails to
start:

1. Diagnose the root cause.
2. First rule out shared-DB stale-data problems before changing product code.
3. Fix the code or fix the test.
4. Commit and push the iteration fix.
5. Restart the local mirrord service and rerun validation.
6. Update the PR (re-stage and embed screenshots after the final passing run).

Internal cap: 3 attempts. If still failing, report that directly and ask for
developer input.

## Phase 8: Stop mirrord

After the final passing Playwright run (or when abandoning after the internal cap), stop every
mirrord session you started. Do not hand off or mark work complete while mirrord is still running.

### tmux sessions

```bash
TMUX_CONFIG="/exec-daemon/tmux.portal.conf"
if [ ! -f "$TMUX_CONFIG" ]; then TMUX_CONFIG="/dev/null"; fi
tmux -f "$TMUX_CONFIG" kill-session -t "<service>-mirrord" 2>/dev/null || true
```

Kill each `<service>-mirrord` session for every touched service.

### Foreground or background shell

Send `Ctrl+C` to each `mirrord exec` process, or stop the background task that launched it.

### Confirm cleanup

```bash
pgrep -af "mirrord exec.*apps/shop" || echo "no shop mirrord exec processes"
```

During Phase 7 internal iteration, restart mirrord only as needed for the next validation run, and
stop it again before the final report.

## Phase 9: Report Back

Return one concise report containing:

- One-line change summary
- Public filtered shop URL used (`https://playground.metalbear.dev/shop...`)
- Baggage header, if used
- PR URL
- Test pass count for the final iteration
- Failed checks, if any
- Screenshot paths with one-line observations
- Brief iteration notes if more than one attempt was needed
- Confirmation that all mirrord sessions were stopped

End with the developer choice set:

- `approve`
- `feedback`
- `pivot`
- `abort`

## Guardrails

- Never merge the PR automatically.
- Never use the preview workflow or `mirrord preview` for this validation skill.
- Never skip the Phase 2 test plan.
- Never use `git push --force` or `--no-verify`.
- Treat visual failures as real failures.
- Never write shared-DB assertions that can pass on stale data.
- Never use unfiltered staging responses as proof that local code works.
- Never validate frontend changes against `localhost` or `127.0.0.1`; run
  `metal-mart-frontend` under mirrord and use the public shop URL with baggage.
- Never leave mirrord running after verification or handoff; stop every session before Phase 9.
