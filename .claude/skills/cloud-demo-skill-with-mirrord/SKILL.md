---
name: cloud-demo-skill-with-mirrord
description: Implement a Linear issue (label "claude-agent-demo", status Backlog) for the MetalMart shop, verify the change ONLY with a mirrord preview environment running in the real playground cluster and hit with real traffic, then open a PR labelled "preview" and move the issue to SE Action. Use for the scheduled "claude-agent-demo" run, or whenever a task says to verify shop changes with mirrord preview / real cluster traffic. Never runs a local mirrord session.
metadata:
  author: MetalBear
  version: "1.0"
---

# Cloud Demo Skill with mirrord

Implement the change, deploy it as a **mirrord preview environment** in the real
playground cluster, exercise it with **real traffic through the cluster's public
entrypoint**, and only then open the PR. The PR is the only place the person will see
the results, so it carries the evidence.

## Hard rules

- **No local runs.** Never run `mirrord exec`, `mirrord up`, `npm run dev`, `next dev`,
  `tsx watch`, or `curl localhost:*` to verify. A request to `localhost` hits your own
  process and proves nothing about the cluster. No tmux sessions for services.
- Every verification request goes to `https://playground.metalbear.dev/shop` (the real
  entrypoint) and carries `baggage: mirrord-session=<preview key>`. Without the header
  the request reaches the normal, unchanged service.
- Only check **your own change** (what the issue scope asks for), nothing else.
- Never push to a branch other than the one you were assigned in the session. Never
  skip the preview, never mark a check green that was not observed in the preview.
- Do not `mirrord preview stop` as cleanup; the PR close (or the 120 min TTL) tears the
  preview down.

## Step 0 — Make sure the mirrord skills are installed

The skills live in https://github.com/metalbear-co/skills. In this cloud session use
the `mirrord-prev-env` skill (preview environments), `mirrord-header-propagation`
(if a header is not reaching a service) and `mirrord-config` (if you write a config).

```bash
[ -d ~/.claude/skills/mirrord-prev-env ] || {
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/metalbear-co/skills /tmp/mirrord-skills-src
  sh /tmp/mirrord-skills-src/install.sh --agent claude
}
```

Read `mirrord-prev-env/SKILL.md` before the verification step (section "How preview
environments work" and "CI mode"). Newly installed skills may need the session to be
restarted to appear in the skill list; read their `SKILL.md` files directly if so.

## Step 1 — Find the work

1. Linear `list_issues` with label `claude-agent-demo`, state `Backlog`.
2. For each issue: `get_issue` and `list_comments` (title, description, comments).
3. Make one timestamp for the run: `TS=$(date +%Y%m%d-%H%M%S)`.

## Step 2 — Implement

1. Create the branch `claude/<issue-identifier>` (e.g. `claude/SOL-171`).
2. Make the change in the service(s) the issue names (`apps/shop/<service>/`). Follow
   `CLAUDE.md` for the layout (order-service, chat-service, metal-mart-frontend, ...).
3. Run the services' normal static checks (`npm ci`, then `npx tsc --noEmit` or the
   repo's lint/build script where present). Do not start the services.
4. Commit and push the branch (`git push -u origin claude/<id>`). The preview build
   needs the commit on GitHub. Do **not** open the PR yet.

## Step 3 — Deploy the preview in the real cluster

The repo's workflow `.github/workflows/preview-shop-pr.yml` detects the changed shop
services, builds their images and starts a mirrord preview per service with the
`metalbear-co/mirrord-preview` action (steal mode, header filter
`baggage: ... mirrord-session=<key>`, 120 min TTL). Trigger it with
`workflow_dispatch` through the GitHub MCP tool `actions_run_trigger`
(`workflow_id: preview-shop-pr.yml`, `ref: main`):

| input | value |
|---|---|
| `action` | `start` |
| `branch` | `claude/<id>` |
| `base_ref` | `main` |
| `preview_key` | `<id>-<TS>` lower-case, e.g. `sol-171-20261022-143826` (this is the key) |

Then poll `actions_list` / `actions_get` (list runs of `preview-shop-pr.yml`, event
`workflow_dispatch`, newest first, match the run-name that contains the preview key)
until it concludes. Poll with sensible gaps; building images takes several minutes.
If the run fails, read `get_job_logs`, fix the cause if it is in your change, push and
dispatch again with `--force` semantics (same key replaces the preview). If it fails
for a reason outside your change (secrets, cluster, operator license), stop and send a
PushNotification with the failing job and log excerpt. Do not fall back to a local
session.

If a header is not honoured by a hop (the response still shows old behaviour), use
the `mirrord-header-propagation` skill to find which service drops `baggage`.

## Step 4 — Verify with real traffic

Learned in practice: the run's own `status` can read `completed` while its build jobs
are still going, so poll the **jobs** (`gh api repos/<o>/<r>/actions/runs/<id>/jobs`;
`gh api` works in cloud sessions) until every `Build & Preview (...)` job concludes.
Always pass `per_page: 3` when listing runs (the payload is huge). A PR-opened run for
the same branch may also be queued; the dispatched run with your key is the one that
counts. Preview pods are visible with `kubectl -n shop get pods | grep <key>`.

Base URL `https://playground.metalbear.dev/shop`, header
`baggage: mirrord-session=<key>` on every request. Use `curl` for APIs and Playwright
(`extraHTTPHeaders`) for UI. If Playwright's own browser download is missing, launch
with `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`; never
`playwright install`. Create the evidence directory `.github/pr-screenshots/`.

Sanity-check first that the preview is selected and the baseline is not: the same
request **without** the header must still show the old behaviour. Record both.

Per change type:

- **Order service**: `POST $BASE/api/orders` with
  `{"items":[{"productId":1,"quantity":1}],"total_cents":499,"customer_email":"preview-verification-bot@metalbear.dev"}`
  and the header. Confirm the changed field in the JSON.
- **Chat service**: `POST $BASE/api/chat/messages` with
  `{"conversationId":"<id>-<TS>","sender":"customer","text":"hello","customerName":"agent"}`
  and the header, wait a few seconds, then `GET $BASE/api/chat/conversations/<id>-<TS>/messages`
  (header again). **The frontend's GET does not forward `baggage`**, so it is served
  by the normal chat-service and returns `[]`; that is not a failure. Prove the reply
  instead from the preview chat pod log (`kubectl -n shop logs <chat preview pod>`:
  `customer message in ...` then `bot message in ...`). `pods/exec` is forbidden, so
  the reply text itself may not be observable; say so in the PR rather than guessing. Chat goes through Kafka queue
  splitting, so the message must carry the baggage header to reach the preview.
- **Frontend**: Playwright with `extraHTTPHeaders: { baggage: 'mirrord-session=<key>' }`,
  open `$BASE/`, wait for network idle, take a full-page screenshot to
  `.github/pr-screenshots/frontend-<TS>.png`, and read the image to confirm the change
  is visible.

Prove each hit landed on the preview pod, not just that the response looks right:

```bash
mirrord preview status          # the key is listed with its pods (needs cluster access)
kubectl -n shop get pods | grep <key-or-service>
kubectl -n shop logs <preview-pod> | tail   # request line for your call (namespace-scoped RBAC)
```

Use whichever of these the service account is permitted to run; note any that are
forbidden instead of guessing. If a check fails, report it honestly (❌ plus the
response). Do not open a green PR for a red result: stop, send a PushNotification.

## Step 5 — PR with the `preview` label

1. Commit the screenshot(s) and push the branch again (`git add .github/pr-screenshots`).
2. Open the PR with the GitHub MCP `create_pull_request` (head `claude/<id>`, base
   `main`). `gh pr` is blocked in cloud sessions. Body:

```markdown
## Summary
- <change per service>

## Verification — mirrord preview, real cluster traffic
Preview key: `<key>` · entrypoint: `https://playground.metalbear.dev/shop` · header: `baggage: mirrord-session=<key>`
Preview workflow run: <actions run URL>
No local mirrord session was used.

| Service | Request | Without header (baseline) | With header (preview) | Preview pod log |
|---|---|---|---|---|
| order | `POST /api/orders` | `"status":"confirmed"` | `"status":"confirmed test-agent-…"` ✅ | <line or "forbidden"> |
| chat | `POST /api/chat/messages` | … | … ✅ | … |
| frontend | `GET /` | no banner | banner ✅ screenshot below | … |

### Frontend screenshot
![Frontend change](https://raw.githubusercontent.com/<owner>/<repo>/<branch>/.github/pr-screenshots/frontend-<TS>.png)
```

   End the body with the attribution lines from the session's system reminder.
3. Add the label (the label triggers the repo's preview automation):
   `gh api repos/<owner>/<repo>/issues/<number>/labels -f "labels[]=preview"`
   (the `gh api` form works in cloud sessions; `gh pr` does not).
4. Closing the PR dispatches the preview stop, so do not stop it yourself.

## Step 6 — Linear

`save_issue` with `state: "SE Action"` and `labels: []` (removes `claude-agent-demo`;
if the issue has other labels, pass them without `claude-agent-demo`). The PR is
attached automatically when the branch name contains the identifier.

## Step 7 — Notify

Send one PushNotification (`<routine_summary>`): PR URL, preview key, result per
service, anything that was skipped or forbidden. If the run could not complete
(workflow failed, cluster unreachable, check failed) notify with that instead.

## Known side effects to mention in the PR when they apply

- `.github/workflows/preview-verification.yml` asserts the order `status` equals
  exactly `"confirmed"`; a demo change to that string makes the weekly verification
  fail. Say so in the PR instead of editing the workflow.
- Verification orders are written to the real cluster DB; use the bot email above so
  they are recognisable.
