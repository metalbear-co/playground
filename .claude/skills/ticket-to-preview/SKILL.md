---
name: ticket-to-preview
description: |
  Turn a Linear ticket (SOL-xxx or any other key) into a verified MetalMart pull request: implement the change
  on a `claude/<TICKET>` branch, prove it against the live playground cluster with `mirrord up`
  (requests with and without the session header, a Playwright screenshot, a saved log), open the PR with
  the evidence table, and add the `preview` label so CI starts the preview environment.
  Use when the developer pastes or names a Linear ticket and says "implement this ticket", "ticket to PR",
  "ticket to preview", "do SOL-123", or starts a Claude Code session from a Linear issue for the playground repo.
  Also use for every Linear issue carrying the `claude-agent-demo` label (for example when a scheduled agent
  picks those issues up).
---

# Ticket to preview

One ticket in, one PR out: code changed, verified against real cluster traffic with `mirrord up`, evidence
in the PR description, and the `preview` label on so CI starts the preview environment.

Work end to end without asking for approval. Ask only if the ticket cannot be read or is genuinely ambiguous.

## Inputs

- **Ticket key**, for example `SOL-196`. Write it in upper case as `TICKET` below.
- **Ticket text.** Read it with the Linear tools if they are available (`get_issue`). Otherwise use the text
  the developer pasted. Keep the Linear URL for the PR description.

Derived values:

| Name | Value | Example |
|---|---|---|
| `BRANCH` | `claude/<TICKET>` | `claude/SOL-196` |
| `TS` | `date -u +%Y%m%d-%H%M%S` | `20261117-101753` |
| `KEY` | `<ticket lower case>-<TS>` | `sol-196-20261117-101753` |
| `UP_FILE` | `mirrord-up-<TICKET>.yaml` at the repo root | `mirrord-up-SOL-196.yaml` |

`KEY` is unique per run, so the local verification never collides with the preview environment, whose key
is the last segment of the branch name (`SOL-196`).

## Services

Only touch services the ticket needs. Everything comes from `.github/preview-services.json`.

| Service | Path | Local port | Kafka split |
|---|---|---|---|
| order-service | `apps/shop/order-service` | 80 | – |
| inventory-service | `apps/shop/inventory-service` | 8081 | – |
| payment-service | `apps/shop/payment-service` | 8082 | – |
| chat-service | `apps/shop/chat-service` | 8083 | `support-chat` |
| delivery-service | `apps/shop/delivery-service` | 8084 | `orders` |
| receipt-service | `apps/shop/receipt-service` | 8085 | – |
| metal-mart-frontend | `apps/shop/metal-mart-frontend` | 3000 | – |

All backends read `PORT` and default to 80. When order-service is not in the run, the first backend may keep
port 80; every other backend gets `PORT` plus a matching `port_mapping` so two processes never bind the same
local port.

## Phase 1: Preflight

Run these as separate commands, in parallel:

```bash
mirrord --version
kubectl config current-context        # must be the playground GKE cluster
kubectl -n shop get deploy            # every touched deployment must exist
git status --short                    # must be clean
```

In a Claude Code web session the environment must provide cluster credentials and a mirrord CI API key
(`MIRRORD_CI_API_KEY`). If `kubectl` cannot reach the cluster, stop and say so; do not fake verification.

## Phase 2: Branch and implement

```bash
git fetch origin main
git checkout -B claude/<TICKET> origin/main
```

- Do not rename the branch. The preview workflow derives the preview key from its last segment, and
  `.claude/settings.json` allows pushing only `claude/*`.
- If `origin/claude/<TICKET>` already exists (an earlier run), never overwrite it. Use
  `claude/<TICKET>-<n>` with the next free number; the preview key then becomes `<TICKET>-<n>`.
- If the working tree is not clean, do the whole run in a separate worktree
  (`git worktree add -b claude/<TICKET> ../playground-<TICKET> origin/main`) instead of touching the developer's changes.
- Do not use a `demo-` prefix (it triggers `preview-shop-pr.yml` and races the label-driven preview).
- Edit only the files the ticket needs. Keep `status: "confirmed"` in order-service responses, because
  `.github/workflows/preview-verification.yml` asserts on it.
- Run `npm install` in each touched service directory, then `npm run build` where a build script exists, to
  catch type errors before starting mirrord.

## Phase 3: Write `UP_FILE`

One entry per touched service. Header comment first, then `services:`. Template:

```yaml
# <TICKET> <ticket title> — local verification against the playground cluster.
# Run from the repo root:  mirrord up -f mirrord-up-<TICKET>.yaml --key <key>
# split mode everywhere: only requests/messages carrying `baggage: mirrord-session=<key>`
# reach the local processes; everyone else keeps hitting the deployed services.
services:
  order-service:
    target: { path: deployment/order-service, namespace: shop }
    http_filter:
      header_filter: 'baggage:\s*[^\n]*\bmirrord-session={{ key }}\b'
    run:
      command: ["npm", "--prefix", "apps/shop/order-service", "run", "dev"]   # local port 80

  inventory-service:
    target: { path: deployment/inventory-service, namespace: shop }
    http_filter:
      header_filter: 'baggage:\s*[^\n]*\bmirrord-session={{ key }}\b'
    env:
      override:
        PORT: "8081"
    config_patch:
      feature:
        network:
          incoming:
            port_mapping: [[8081, 80]]   # [local, remote]
    run:
      command: ["npm", "--prefix", "apps/shop/inventory-service", "run", "dev"]

  chat-service:                          # Kafka consumer: add split_queues
    target: { path: deployment/chat-service, namespace: shop }
    http_filter:
      header_filter: 'baggage:\s*[^\n]*\bmirrord-session={{ key }}\b'
    env:
      override:
        PORT: "8083"
    config_patch:
      feature:
        network:
          incoming:
            port_mapping: [[8083, 80]]
        split_queues:
          "*":
            queue_type: Kafka
            message_filter:
              baggage: '.*mirrord-session={{ key }}.*'
    run:
      command: ["npm", "--prefix", "apps/shop/chat-service", "run", "dev"]

  metal-mart-frontend:
    target: { path: deployment/metal-mart-frontend, namespace: shop }
    http_filter:
      header_filter: 'baggage:\s*[^\n]*\bmirrord-session={{ key }}\b'
    env:
      override:
        NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: dxas4fpir   # build-time var; the remote value is not used by next dev
    run:
      command: ["npm", "--prefix", "apps/shop/metal-mart-frontend", "run", "dev", "--", "-p", "3000"]
```

Check it parses before starting: `mirrord up -f <UP_FILE> list`.

## Phase 4: Start and pass the startup gate

```bash
mkdir -p .github/pr-screenshots
mirrord up -f <UP_FILE> --key <KEY> > /tmp/mirrord-up-<TICKET>-<TS>.log 2>&1   # run in background
```

Startup gate: wait (one blocking `until grep` loop, no repeated sleeps) until every service has logged that
it is listening (`listening on port`, `Ready in`, `Local:`), or any service logged `Error`, `Failed to start`,
or exited.

- If a service fails, read its log lines, fix the cause, stop `mirrord up`, and restart. Count attempts and
  report them honestly in the PR ("clean on the first attempt" only if true).
- Exit code 139 from a `tsx` dev script is the known Node 26 + tsx crash under mirrord. Switch that service's
  `run.command` to a build then `node dist/index.js` and note it in the PR.
- `no MirrordSplitConfig defines dbBranches ... running against the source DB` is informational, not a failure.
- `mirrord operator API failed ... client error (Connect)` is usually transient. Check `mirrord operator status`;
  if it answers, kill leftover processes on the local ports and restart once.
- chat-service logs a kafkajs `CreateTopics ... Topic creation errors` line on start because the topic exists. Ignore it.

## Phase 5: Verify each touched service

Entrypoint: `https://playground.metalbear.dev/shop`. For every touched service, send the same request twice
with `curl -sS -D -`: once without a header (baseline) and once with `baggage: mirrord-session=<KEY>`.

| Service | Request |
|---|---|
| order | `POST /shop/api/orders` with one item and `customer_email: preview-verification-bot@metalbear.dev` |
| inventory | `GET /shop/api/products/1` (and `GET /shop/api/products` for list-wide changes) |
| chat | `POST /shop/api/chat/messages` with `{conversationId, sender: "customer", text, customerName}`, wait ~20 s (the split consumer may be rebalancing), then read the bot reply from the local process: `curl localhost:8083/conversations/<id>/messages`. Do not read it through `/shop/api/chat/conversations/...`: that frontend route does not forward `baggage`, so the read lands on the deployed chat-service. The local log line `bot message in <id>` is the routing proof. |
| frontend | Playwright, below |
| others | the endpoint the ticket changes |

Pass criteria for each service:
1. The response with the header shows the ticket's change; the baseline does not.
2. The response with the header carries `mirrord-agent: forwarded-to-client` and `mirrord-key: <KEY>`; the
   baseline carries `mirrord-agent: passed-through`.
3. The local log for that service shows the request with `mirrord-session=<KEY>`.

Frontend: run Playwright (Chromium, headless; run `npx playwright install chromium-headless-shell` first if the
browser is missing) from a scratch directory, not the repo, with
`extraHTTPHeaders: { baggage: "mirrord-session=<KEY>" }`. Open `https://playground.metalbear.dev/shop` (no trailing
slash: `/shop/` answers 308), wait for network idle, and save a full-page screenshot to
`.github/pr-screenshots/frontend-<TS>.png`. Look at the screenshot and confirm the change is visible.

If a check fails, fix the code, restart `mirrord up`, and re-run all checks. Do not open the PR with a red check.

## Phase 6: Stop, save evidence, commit

1. Stop `mirrord up` and confirm no `mirrord` processes for this key remain.
2. Copy the log to `.github/pr-screenshots/mirrord-up-<TICKET>-<TS>.log`. Redact the Web UI `token=`
   value, the `x-auth-token`, and any JWT (`eyJ...`) as `<redacted>`.
3. `npm install` may rewrite `package-lock.json` files. Restore any the ticket did not ask for
   (`git checkout origin/main -- <lockfile>`) so they stay out of the commit.
4. Commit the code changes, `UP_FILE`, the log, and the screenshot:

```bash
git add <changed files> <UP_FILE> .github/pr-screenshots/
git commit -m "<TICKET>: <short summary>"
git push -u origin claude/<TICKET>
```

## Phase 7: Open the PR and label it

Title: `<TICKET>: <ticket title> (<comma-separated list of changes>)`.

Body:

```markdown
## Summary
Implements Linear [<TICKET> — <title>](<linear url>):
- **<service>**: <what changed and where>
- ...

## Verification — mirrord up, real cluster traffic
Session key: `<KEY>` · entrypoint: `https://playground.metalbear.dev/shop` · header: `baggage: mirrord-session=<KEY>`
Verified with `mirrord up -f <UP_FILE> --key <KEY>` (<services>, split mode, HTTP filter on the session key<, Kafka split for X>). The startup gate was <clean on the first attempt | clean after N attempts: reason>. The preview environment is started by the `preview` label; its link lands in the workflow's PR comment.

| Service | Request | Without header (baseline) | With header (mirrord up) | Local log line |
|---|---|---|---|---|
| ... | ... | ... | ... ✅ | ... |

Responses with the header carried `mirrord-agent: forwarded-to-client` and `mirrord-key: <KEY>`; the baselines carried `mirrord-agent: passed-through`.

### mirrord up log
[`mirrord-up-<TICKET>-<TS>.log`](https://raw.githubusercontent.com/metalbear-co/playground/claude/<TICKET>/.github/pr-screenshots/mirrord-up-<TICKET>-<TS>.log) (tokens and JWTs redacted)

### Frontend screenshot
![Frontend change](https://raw.githubusercontent.com/metalbear-co/playground/claude/<TICKET>/.github/pr-screenshots/frontend-<TS>.png)
```

Then:

```bash
gh pr create --base main --head claude/<TICKET> --title "..." --body-file <file>
gh pr edit <number> --add-label preview
```

The `preview` label triggers `preview-shop-pr-gated.yml`: it builds only the changed services, starts a
steal-mode preview with key `<TICKET>`, and posts the share link, extension link, header, and curl in a
PR comment.

## Phase 8: Check the preview too

Wait for the `preview-shop-pr-gated.yml` run on the PR to finish (`gh run watch`), then read the bot's PR
comment for the share link and per-service preview URLs. Re-run every Phase 5 check against
`https://playground.metalbear.dev/shop` with `baggage: mirrord-session=<TICKET>` (the preview key, not
`<KEY>`). Each check now has two results: mirrord up and preview. For chat, read the bot reply from the
chat-service preview URL in the comment (`<url>/conversations/<id>/messages`). order-service previews run on
their own database branch, so order ids restart at 1 there; that is expected.

If the workflow fails, report it in the PR and in Linear as a failure; do not retry by relabelling.

## Phase 9: Report back in Linear

Only if the Linear tools are available:

1. Comment on the issue:

```markdown
🐻 **mirrord preview environment is up** for this change — PR <PR link>

**Open it:** <share link>/shop (share link, no setup; the session header is injected for you)

Same change on the real URL: open https://playground.metalbear.dev/shop with the header
`baggage: mirrord-session=<TICKET>` (mirrord Browser Extension or any header tool).

Previewed services:
- <service> → <preview URL>
- metal-mart-frontend → via the share link above

Verified with `mirrord up` (key `<KEY>`) and the preview env:
- <service>: <what changed> ✅ / ✅
- ...

The preview stops when the PR is merged or closed.
```

2. Move the issue to **SE Action**.
3. Remove the `claude-agent-demo` label so the issue is not picked up again.

## Rules

- Never commit to `main`. Never start or stop the preview environment yourself; the label and CI do that.
- No customer names, internal metrics, or credentials in code, commits, or the PR.
- Report failures as failures. If the cluster is unreachable or a check stays red, say so and stop.

When done, reply with one line: PR URL, branch, session key, and whether all checks were green.
