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
2. **Plan** (after Step 1.3). For each scope item, write down the service and file it
   touches and the real-traffic check that proves it (Step 3.3). Print the plan in the
   session and report it: `stage: "plan"`, message `Plan: <services, comma-separated>`,
   e.g. `Plan: frontend, inventory, chat, order`.
3. **Code** (start of Step 2): report `stage: "code"`, message
   `Writing code on claude/<issue-identifier>`. The report in Step 2.4 uses
   `stage: "verify"`.
4. **Verify** (Step 3.5). When a check is red and the cause is in your change (not the
   cluster, the network or a missing secret), fix it **once** instead of stopping:
   - Report `stage: "code"`, message `Check failed: <what failed, one line>. Fixing.`
   - Fix the code, run the static checks, commit and push.
   - Report `stage: "verify"`, message `mirrord up · attempt 2`, then repeat Steps 3.2
     to 3.4 with a **new** key, following the retry rules in Step 3.2.

   If a check is still red after the fix, or the cause is outside your change, report
   `failed` and stop with no PR, as Step 3.5 says. When every check is green, report
   `stage: "verify"`, message `mirrord up · key <KEY> · <passed>/<total> checks passed`.
5. **Review** (after Step 3, before Step 5). Report `stage: "review"`, message
   `Reviewing the diff and the evidence`. Then check, and print each result:
   - **Scope.** `git diff --stat origin/main...HEAD`. Every changed file belongs to a
     scope item of the issue, or is this run's `mirrord-up-<id>.yaml`, screenshot or
     redacted log. Restore files that the change did not need, for example a
     `tsconfig.tsbuildinfo` that `tsc` rewrote: `git checkout origin/main -- <file>`.
   - **Evidence.** Every scope item has a passing real-traffic check from Step 3. A
     scope item without one goes back to Step 3.
   - **Secrets.** The committed log has no unredacted token or JWT:
     `grep -nE 'token=[0-9a-f]{64}|x-auth-token: [0-9a-f]{64}|eyJ[A-Za-z0-9._-]{20,}' .github/pr-screenshots/*.log || echo "secrets: clean"`.

   Commit and push any fix. Report `stage: "review"`, message
   `Self-review: <one line, e.g. scope matches, removed a build file>`, and list the
   findings in the PR body under "Self-review".
6. **Pull request** (Step 5.3, after the label): report `stage: "pr"`, message
   `PR opened, preview building`. The final report (Step 6b) has `stage: "pr"`.
