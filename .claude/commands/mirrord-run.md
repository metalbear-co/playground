Run one of the MetalMart shop services locally with mirrord so requests carrying the developer's routing header get stolen from the staging deployment to their laptop. Use this when the developer says something like *"run X with mirrord"*, *"start the inventory-service locally against staging"*, or *"I want to see this change running through mirrord"* — i.e. they want a fast inner loop, NOT a preview-build pipeline. For the full preview-PR-Playwright loop, use `/mirrord-agent-shop` instead.

This command does **not** branch, commit, push, or open a PR. It runs a local process and tells the developer how to route traffic to it.

---

## Inputs

The developer names a service. Map shorthands to paths:

| Shorthand | Path |
|---|---|
| `inventory`, `inventory-service` | `apps/shop/inventory-service` |
| `order`, `order-service` | `apps/shop/order-service` |
| `payment`, `payment-service` | `apps/shop/payment-service` |
| `delivery`, `delivery-service` | `apps/shop/delivery-service` |
| `receipt`, `receipt-service` | `apps/shop/receipt-service` |
| `frontend`, `shop`, `metal-mart-frontend` | `apps/shop/metal-mart-frontend` |

If the request is ambiguous (e.g. the developer is editing a file in `apps/shop/<svc>/` right now), prefer that service without asking. Otherwise ask one short clarifying question.

## Phase 1 — Sanity checks (run in parallel)

Issue each as its **own** Bash call (do not chain with `&&`) so the project allowlist in `.claude/settings.json` matches each pattern cleanly and no popups fire during a demo:

```bash
mirrord --version
kubectl config current-context              # must be the staging/playground cluster
kubectl -n shop get deploy <service>        # the deployment must exist
echo "USER=$USER"                           # the routing key
ls apps/shop/<service>/mirrord.json         # the config we'll pass to mirrord exec
```

## Phase 2 — Run the dev command

run `npm run dev`.

## Phase 3 — Start the service under mirrord (background)

Issue these as **separate** Bash calls (the second with `run_in_background: true`) and **use absolute paths only** — no `cd ... &&` prefix, no relative paths. The leading token must be `mirrord` so it matches `Bash(mirrord exec -f *)` in `.claude/settings.json`. Use `npm --prefix` to point npm at the service directory:

```bash
mkdir -p /tmp/mirrord-run
mirrord exec -f /Users/danbaker/workspace/playground/apps/shop/<service>/mirrord.json \
  -- npm --prefix /Users/danbaker/workspace/playground/apps/shop/<service> run dev \
  > /tmp/mirrord-run/<service>.log 2>&1
```

For `metal-mart-frontend`, the dev script is still `npm run dev` (Next.js). For services without a `dev` script, replace the `npm --prefix … run dev` part with `node --prefix …` is not a thing; instead build first or use `npx tsx /absolute/path/to/src/index.ts`. Keep the leading `mirrord exec -f /absolute/path …` shape.

Run this via Bash with `run_in_background: true` and capture the task ID so you can stop it later.

## Phase 4 — Wait for readiness (don't poll-sleep)

Use a single blocking `until` so the harness notifies you once:

```bash
until grep -qE "(listening on port|Local:|ready in|Failed to start|Error:|error connecting)" /tmp/mirrord-run/<service>.log; do
  sleep 2
done
tail -n 40 /tmp/mirrord-run/<service>.log
```

If readiness regex never matches within ~3 minutes, surface the last 60 lines of the log and stop — most failures are: wrong kube context, target deployment missing, mirrord operator not authorized, or a `DATABASE_URL` mismatch.

## Phase 5 — Verify the steal works (curl)

Hit staging through the public URL with the routing header, confirming the response shows the developer's local code path:

```bash
curl -sS -H "baggage: mirrord-session=$USER" https://playground.metalbear.dev/shop/api/<endpoint> | jq '.[0:5] | .[] | {id, name}'
```

The `curl -sS …` shape (starts with `curl -sS`, hits `https://playground.metalbear.dev/...`) is what the demo allowlist (`Bash(curl -sS * https://playground.metalbear.dev/*)`) matches — keep that exact prefix. For pretty-printing, **only** pipe to `jq` (auto-allowed). Do not pipe to `python3 -c …`, `node -e …`, or any interpreter — those are not allowlisted and will prompt.

Pick an endpoint that actually exercises the change (the developer just told you what they changed — use that route). Show the developer the response in a way that makes the change visible (e.g. for the inventory uppercase example: print the first 5 product names).

If the response shows the **old** behavior, the request didn't get stolen. Most common causes: wrong `USER` value, header name typo, or the steal `http_filter` in `mirrord.json` is more restrictive than expected. Re-read the `header_filter` from `mirrord.json` and adapt the curl command.

## Phase 5b — Verify the shop UI (Playwright) — required for catalog / image changes

`curl` is not sufficient when the change affects product data the UI renders (e.g. `image_urls`, catalogue fields). Follow `.cursor/skills/mirrord-run-shop/SKILL.md`:

1. Install Playwright under `/tmp/mirrord-run-shop/` (once per session).
2. Write and run `e2e.js` with `extraHTTPHeaders: { baggage: 'mirrord-session=' + $USER }`.
3. Assert API rows have no empty `image_urls[0]`, and that `/shop/products` and affected detail pages show loaded images (`naturalWidth > 0`, no `No image` tiles).
4. Review screenshots in `/tmp/screenshots/mirrord-run-*.png`.
5. If opening or updating a PR, run `.cursor/scripts/stage-playwright-screenshots.sh` and embed the printed `<img>` tags in the PR body under a **Playwright verification** section.

**Never** run ad-hoc `kubectl exec` SQL against the shared playground database to fix or test data. Validate only through mirrord + public shop URLs.

## Phase 6 — Stop mirrord and hand off

Stop mirrord first (see **Stop / cleanup** below), then print exactly this block with values filled in:

```
✓ <service> verified locally under mirrord against staging; mirrord stopped.

Local log:   /tmp/mirrord-run/<service>.log
Routing:     baggage: mirrord-session=<USER>
Quick check: curl -H "baggage: mirrord-session=<USER>" https://playground.metalbear.dev/shop/api/<endpoint>
Playwright:  /tmp/screenshots/mirrord-run-results.json (see mirrord-run-shop skill)

To see it in the browser, install the mirrord Browser Extension and set
the same baggage header — only your requests will hit the local process.

If you need another validation pass, restart mirrord for that pass and stop it again when done.
```

## Stop / cleanup

Stop mirrord when verification is finished or when the developer asks you to stop. Do **not** leave
mirrord running after handoff — it keeps stealing filtered traffic on the shared playground cluster.

When finishing work:

1. `TaskStop` the background Bash task, or send `Ctrl+C` to the foreground `mirrord exec` process.
2. If you used tmux, kill the session: `tmux kill-session -t <service>-mirrord` (use the same `-f` config as start).
3. Confirm cleanup: `pgrep -af "mirrord exec.*apps/shop/<service>" || echo "stopped"`.
4. Optional: `rm /tmp/mirrord-run/<service>.log`.

During an active iteration loop, `tsx watch` and `next dev` pick up source edits without restarting
mirrord — but stop mirrord before marking the task complete or handing off.

## Guardrails

- Never run against a non-playground kube context.
- Never edit `mirrord.json` to "make the steal more permissive" — if traffic isn't being stolen, diagnose; don't widen the filter.
- Never commit, push, or open a PR from this command. That's `/mirrord-agent-shop` or `/commit-push-pr`.
- Never use `npm start` or the built `dist/` output — always run the source so edits are live.
