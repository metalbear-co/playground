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

## Phase 5 — Verify the steal works

Hit staging through the public URL with the routing header, confirming the response shows the developer's local code path:

```bash
curl -sS -H "baggage: mirrord-session=$USER" https://playground.metalbear.dev/shop/api/<endpoint> | jq '.[0:5] | .[] | {id, name}'
```

The `curl -sS …` shape (starts with `curl -sS`, hits `https://playground.metalbear.dev/...`) is what the demo allowlist (`Bash(curl -sS * https://playground.metalbear.dev/*)`) matches — keep that exact prefix. For pretty-printing, **only** pipe to `jq` (auto-allowed). Do not pipe to `python3 -c …`, `node -e …`, or any interpreter — those are not allowlisted and will prompt.

Pick an endpoint that actually exercises the change (the developer just told you what they changed — use that route). Show the developer the response in a way that makes the change visible (e.g. for the inventory uppercase example: print the first 5 product names).

If the response shows the **old** behavior, the request didn't get stolen. Most common causes: wrong `USER` value, header name typo, or the steal `http_filter` in `mirrord.json` is more restrictive than expected. Re-read the `header_filter` from `mirrord.json` and adapt the curl command.

## Phase 6 — Hand off to the developer

Print exactly this block, with values filled in:

```
✓ <service> is running locally under mirrord against staging.

Local log:   /tmp/mirrord-run/<service>.log
Routing:     baggage: mirrord-session=<USER>
Quick check: curl -H "baggage: mirrord-session=<USER>" https://playground.metalbear.dev/shop/api/<endpoint>

To see it in the browser, install the mirrord Browser Extension and set
the same baggage header — only your requests will hit the local process.

Tell me when to stop it, or just give feedback and I'll iterate.
```

## Stop / cleanup

When the developer says they're done, or asks you to stop:

1. `TaskStop` the background Bash task.
2. Optional: `rm /tmp/mirrord-run/<service>.log`.

Do **not** auto-stop on your own — leave it running across follow-up edits unless the developer signals done. `tsx watch` and `next dev` will pick up source edits automatically without restarting mirrord.

## Guardrails

- Never run against a non-playground kube context.
- Never edit `mirrord.json` to "make the steal more permissive" — if traffic isn't being stolen, diagnose; don't widen the filter.
- Never commit, push, or open a PR from this command. That's `/mirrord-agent-shop` or `/commit-push-pr`.
- Never use `npm start` or the built `dist/` output — always run the source so edits are live.
