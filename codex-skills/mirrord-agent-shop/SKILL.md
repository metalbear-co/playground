---
name: mirrord-agent-shop
description: Use when a developer asks for a MetalMart shop change that must be implemented and verified end-to-end in a mirrord preview environment with Playwright before handoff.
---

# Mirrord Agent Shop

Use this skill when the agent must own both implementation and preview verification for the MetalMart shop.

Read `docs/AI_ROOT_CONTEXT.md` first. Read `.github/preview-services.json` during intake.

`preview-shop` stops after preview handoff. This skill continues through agent-written tests, screenshot review, and private fix iterations before reporting back.

## Phase 1: Intake

- Restate the requested change in one sentence.
- Identify which of these services are affected:
  - `metal-mart-frontend`
  - `order-service`
  - `inventory-service`
  - `payment-service`
  - `delivery-service`
  - `receipt-service`
- For each touched service, classify preview state from `.github/preview-services.json`:
  - `<service> (branched)` if `db_branches` is configured
  - `<service> (shared DB)` if the service uses a shared database
  - `<service> (no DB)` if there is no database
- If the change introduces DDL for a service without `db_branches`, stop and ask for explicit confirmation before proceeding.
- Ask at most one clarifying question, and only if the scope is genuinely ambiguous.

## Phase 2: Write the Test Plan Before Code

Write a short numbered plan with three sections:

1. Functional checks
2. Visual checks
3. Regression guards

For any `(shared DB)` service, every data assertion must tolerate stale rows. Use one of:

- Most-recent-row semantics
- A unique per-run marker
- `created_at >= runStart`

Echo the plan briefly, do not ask for approval, and proceed unless the developer objects.

## Phase 3: Branch, Edit, Commit, Push, PR

Branch naming must match `^[a-z]+-[a-z]+$` with exactly two lowercase ASCII words.

- No `claude/` prefix
- No slashes
- No random suffixes
- No `demo-` prefix

Edit only the touched app or service paths.

When tests depend on changed UI, add stable `data-testid="..."` attributes in the same commit as the UI change.

Preferred PR creation:

```bash
gh pr create --base main --head <branch>
```

If `gh` PR creation fails because of the active token, retry with a different authenticated path instead of abandoning the flow.

Capture:

```text
BRANCH=<branch>
PR_NUMBER=<n>
PR_URL=<url>
PREVIEW_KEY=<branch>
```

## Phase 3a: Dispatch Preview and Wait

Always dispatch `preview-shop-pr.yml` explicitly instead of relying on implicit preview triggers.

Start preview with `action=start`, then locate the workflow run by a unique caller ID. Poll every 60 seconds for up to 20 ticks. Emit one short progress line per tick.

If the run finishes unsuccessfully:

- Fetch failed logs or failed job details
- Summarize the issue in one or two lines
- Treat it as a failed verification and continue to the internal-fix loop

## Phase 4: Execute the Plan Against the Preview

Install Playwright once per session in `/tmp/mirrord-agent-shop/`. Clean stale screenshots and stale `e2e.js` first.

Write `/tmp/mirrord-agent-shop/e2e.js` from the Phase 2 plan. Use:

- `PREVIEW_KEY`
- `ITER`
- `baggage: mirrord=<branch>`
- one `check()` per functional assertion
- one `shoot()` per visual assertion

Prefer `[data-testid="..."]` selectors for changed UI.

Run the test script and save the JSON results under `/tmp/screenshots/iter<n>-results.json`.

Then review every screenshot with the available image-viewing tool in the session. A visual mismatch counts as a failed check even if Playwright passed.

## Phase 5: Internal Iteration

If any functional check fails, any screenshot review fails, or the preview build fails:

1. Diagnose the root cause.
2. First rule out shared-DB stale-data problems before changing product code.
3. Fix the code or fix the test.
4. Commit the iteration fix, push, rebuild the preview, and rerun tests.

Internal cap: 3 attempts. If still failing, report that directly and ask for user input.

## Phase 6: Report Back

Return one concise report containing:

- One-line change summary
- Preview URL
- Baggage header
- PR URL
- Test pass count for the final iteration
- Failed checks, if any
- Screenshot paths with one-line observations
- Brief iteration notes if the agent needed more than one attempt

End with the developer choice set:

- `approve`
- `feedback`
- `pivot`
- `abort`

If the internal cap was hit, prepend a clear warning that not all checks passed.

## Phase 7: Developer Feedback Loop

- `approve`: stop preview and leave the PR open
- `feedback`: restate feedback, update the plan if needed, implement, retest, and report again
- `pivot`: ask one or two clarifying questions, rewrite the relevant plan, then continue
- `abort`: close the PR if requested and stop the preview

Pause after five feedback iterations and ask whether to continue or rescope.

## Phase 8: Exit

On approval:

- stop the preview
- keep the PR open
- never merge it automatically

On abort:

- close the PR if requested
- stop the preview

## Guardrails

- Never merge the PR automatically.
- Never present preview details before preview verification succeeds, except when explicitly reporting that the three-attempt cap was hit.
- Never skip the Phase 2 test plan.
- Never poll faster than every 60 seconds.
- Never use `git push --force` or `--no-verify`.
- Treat visual failures as real failures.
- Never write shared-DB assertions that can pass on stale data.
