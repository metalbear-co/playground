# Software Factory runs

Read this file only when the board lookup in `SKILL.md` Step 1.0 returned
`"source":"software-factory"`. Runs from the Cloud Agents dashboard, and scheduled runs,
never use it.

The Software Factory board (`https://playground.metalbear.dev/shop/software-factory`)
shows each run as a card that moves through the stations Plan, Code, Verify, Review and
Pull request. A run it started does everything in `SKILL.md` Steps 0 to 7, plus the
following.

1. **Every report** to the callback (`SKILL.md` Step 6b, including the first one in
   Step 1.2) adds `"source":"software-factory"` and the current `"stage"`: `plan`,
   `code`, `verify`, `review` or `pr`. The board moves the card to that column. A
   `failed` report keeps the stage where the run stopped. From Step 1.3 on, every report
   also adds `"key":"$KEY"`, the current mirrord session key, so the card shows which key
   reaches this run's code. After a retry with a new key (Step 3.2), send the new one.
   Read the record back with
   `curl -sS "$CALLBACK_URL?source=software-factory&ticket=$TICKET"`.
2. **What each station shows.** The card's panel has one tab per station, and each tab
   shows only that station's work. Send each piece with the report of its own stage:

   | Station | Shows | Sent as |
   |---|---|---|
   | Plan | the scope items: service, file, real-traffic check | `log` lines |
   | Code | the code change | `diff` |
   | Verify | the `mirrord-up-<id>.yaml` file, the `mirrord up` services, the requests through mirrord with and without the key, the Playwright screenshots, the redacted log | `mirrord_up`, `log`, `checks`, `evidence` |
   | Review | the static checks, the scope, evidence and secrets checks | `log` lines |
   | Pull request | the PR and the preview environment | `log` lines, then `pr_url` and `url` |

   `log` is 1 to 10 lines, each under 200 characters, shown under the report's message.
   `diff` is `git diff` text, up to 10,000 characters. `mirrord_up` is the text of the
   `mirrord-up-<id>.yaml` file, up to 6,000 characters. Never put a token, a JWT, a
   kubeconfig or an environment dump in any of them: the board shows them to everyone.
   Define this helper once, after Step 1.3, and use it for every running report:
   ```bash
   # report <stage> <message> [log line ...]
   # DIFF_FILE=<file> adds the diff, MIRRORD_UP_FILE=<file> adds the mirrord up file.
   report() {
     local stage=$1 msg=$2; shift 2
     jq -n --arg run "$RUN_ID" --arg t "$TICKET" --arg s "$stage" --arg m "$msg" --arg k "${KEY:-}" \
       --rawfile diff "${DIFF_FILE:-/dev/null}" --rawfile mup "${MIRRORD_UP_FILE:-/dev/null}" \
       '{run_id:$run, ticket:$t, status:"running", source:"software-factory", stage:$s, message:$m}
        + (if $k != "" then {key:$k} else {} end)
        + (if $diff != "" then {diff:$diff} else {} end)
        + (if $mup != "" then {mirrord_up:$mup} else {} end)
        + (if ($ARGS.positional | length) > 0 then {log:$ARGS.positional[:10]} else {} end)' \
       --args "$@" |
     curl -sS -X POST "$CALLBACK_URL" -H "Authorization: Bearer $CLOUD_AGENTS_CALLBACK_TOKEN" \
       -H "Content-Type: application/json" --data-binary @-
   }
   ```
   The final `done` or `failed` report (Step 6b) can carry `log` lines too.
3. **Plan** (after Step 1.3). For each scope item, write down the service and file it
   touches and the real-traffic check that proves it (Step 3.3). Print the plan in the
   session and report it with one log line per scope item:
   ```bash
   report plan "Plan: inventory, frontend" \
     "inventory: src/index.ts · check: GET /shop/api/products → names in capitals" \
     "frontend: no change · check: GET /shop (Playwright) → names in capitals"
   ```
4. **Code** (Step 2). At the start, `report code "Writing code on claude/<issue-identifier>"`.
   After the commit is pushed, send the change itself, without the run's evidence files
   and build output:
   ```bash
   git diff origin/main...HEAD -- . ':(exclude).github/pr-screenshots' \
     ':(exclude)**/mirrord-up-*.yaml' ':(exclude)**/*.tsbuildinfo' > /tmp/run.diff
   DIFF_FILE=/tmp/run.diff report code "Code pushed: $(git diff --name-only origin/main...HEAD | wc -l | tr -d ' ') files, $(git rev-parse --short HEAD)"
   ```
   Keep the static-check results for the Review report. The report in Step 2.4 uses
   `stage: "verify"`.
5. **Verify** (Step 3). When the `mirrord up` sessions are ready, report the file you
   started it with and one log line per service:
   ```bash
   MIRRORD_UP_FILE=mirrord-up-<id>.yaml report verify "mirrord up running" \
     "inventory → deployment/inventory-service, steal, filter on the session key"
   ```
   After a retry with a new file, send the new file the same way.
   When a check is red and the cause is in your change (not the cluster, the network or
   a missing secret), fix it **once** instead of stopping (Step 3.5):
   - `report code "Check failed: <what failed, one line>. Fixing."`
   - Fix the code, run the static checks, commit and push, and send the new diff as in
     item 4.
   - `report verify "mirrord up · attempt 2"`, then repeat Steps 3.2 to 3.4 with a
     **new** key, following the retry rules in Step 3.2.

   If a check is still red after the fix, or the cause is outside your change, report
   `failed` and stop with no PR, as Step 3.5 says. Add `checks` to that report (below),
   so the board shows which check failed.

   When every check is green and Step 3.6 wrote the redacted log, push the evidence now,
   so the board can show it before the PR exists: `git add .github/pr-screenshots`,
   commit, push the run's branch, and `SHA=$(git rev-parse HEAD)`. Then report
   `stage: "verify"`, message `mirrord up · key <KEY> · <passed>/<total> checks passed`,
   with two more fields (build the body with `jq -n`):
   - `checks`: one item per real-traffic request of Step 3.3, up to 8:
     `{"service":"inventory","request":"GET /api/products","without":"\"name\":\"Mug\"","with":"\"name\":\"MUG\"","ok":true}`.
     `without` is the baseline response and `with` the response with the session key,
     each one short line (the field or text that proves the change).
   - `evidence`: up to 6 file URLs of this commit, every Playwright screenshot first and
     then the redacted log:
     `https://raw.githubusercontent.com/metalbear-co/playground/$SHA/.github/pr-screenshots/<file>`.
     The callback refuses URLs outside `metalbear-co/playground`.

   The board shows the requests, the screenshots and the log in the card's Verify tab.
   Keep the body under 20 KB.
6. **Review** (after Step 3, before Step 5). `report review "Reviewing the diff and the evidence"`.
   Then check, and print each result:
   - **Scope.** `git diff --stat origin/main...HEAD`. Every changed file belongs to a
     scope item of the issue, or is this run's `mirrord-up-<id>.yaml`, screenshot or
     redacted log. Restore files that the change did not need, for example a
     `tsconfig.tsbuildinfo` that `tsc` rewrote: `git checkout origin/main -- <file>`.
   - **Evidence.** Every scope item has a passing real-traffic check from Step 3. A
     scope item without one goes back to Step 3.
   - **Secrets.** The committed log has no unredacted token or JWT:
     `grep -nE 'token=[0-9a-f]{64}|x-auth-token: [0-9a-f]{64}|eyJ[A-Za-z0-9._-]{20,}' .github/pr-screenshots/*.log || echo "secrets: clean"`.

   Commit and push any fix. Report the result with one log line per static check from
   Step 2 and per review check, and list the findings in the PR body under
   "Self-review":
   ```bash
   report review "Self-review: scope matches, removed a build file" \
     "inventory-service: npm run build → pass" "inventory-service: tsc --noEmit → pass" \
     "scope: 1 file, inventory-service only" "fixed: restored tsconfig.tsbuildinfo" \
     "evidence: 2/2 checks passed with real traffic" "secrets: clean"
   ```
7. **Pull request** (Step 5.3, after the label):
   `report pr "PR opened, preview building" "PR #<number>: <PR title>" "preview workflow: <run URL>"`.
   The final report (Step 6b) has `stage: "pr"`.
