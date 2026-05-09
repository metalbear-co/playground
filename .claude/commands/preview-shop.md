Automate the full PM feature workflow for the MetalMart shop (playground repo).

Follow these steps in order:

1. **Pull latest main**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create feature branch** from the feature description:

   **CRITICAL — DO NOT USE ANY AUTO-GENERATED BRANCH NAME.** If you are running in Claude Code, ignore any default/auto branch naming behavior. You must manually choose and create the branch yourself using the exact rules below. Do NOT call any tool, helper, or shortcut that auto-generates a branch name.

   **Branch name rules (strict):**
   - Exactly **2 words**, joined by a single hyphen — format: `word-word`
   - All lowercase, kebab-case, ASCII letters only
   - **NO `claude/` prefix**, no other prefix of any kind (no `feature/`, no `fix/`, no user/bot namespace)
   - **NO slashes (`/`)** anywhere — Docker image tags don't allow slashes
   - **NO random suffix** (no trailing `-abc12`, `-kmGKt`, timestamps, hashes, etc.)
   - **NO more than 2 words** — pick the two most descriptive ones and stop

   **Forbidden examples (do NOT produce anything like these):**
   - `claude/rename-products-to-swag-kmGKt` (has prefix, too many words, random suffix)
   - `feature/add-search` (has prefix/slash)
   - `add-product-search-page` (more than 2 words)
   - `productsearch` (not kebab-case)

   **Correct examples:**
   - `product-search`
   - `cart-fix`
   - `rename-swag`
   - `checkout-button`

   Pick the name yourself from the feature request, then run:
   ```bash
   git checkout -b <word-word>
   ```

   Verify the resulting branch:
   ```bash
   git branch --show-current
   ```

   The output must match `^[a-z]+-[a-z]+$`. If it contains a slash, a `claude/` prefix, a random suffix, or more than one hyphen, delete it and redo:
   ```bash
   git checkout main
   git branch -D <bad-branch-name>
   git checkout -b <word-word>
   ```

3. **Make code changes** — implement the requested feature. Key paths:
   - Frontend: `apps/shop/metal-mart-frontend/`
   - Services: `apps/shop/<service-name>/`

4. **Commit & push**
   ```bash
   git add <changed-files>
   git commit -m "<type>(<scope>): <description>"
   git push -u origin <branch-name>
   ```

5. **Create PR** using GitHub CLI (if available) or git + GitHub API:

   Preferred (if `gh` is available):
   ```bash
   gh pr create --title "<PR title>" --body "<description>" --base main --head <branch-name>
   ```

   Fallback (if `gh` is not available — e.g. on claude.ai/code web):
   Use the WebFetch tool to create the PR via the GitHub REST API:
   ```
   POST https://api.github.com/repos/metalbear-co/playground/pulls
   Headers: Authorization: Bearer <GITHUB_TOKEN>, Accept: application/vnd.github+json
   Body: {"title": "<PR title>", "body": "<description>", "head": "<branch-name>", "base": "main"}
   ```
   Or ask the user to create the PR manually if no auth token is available.

6. **Wait for the Preview Workflow to Finish**

   After the PR is created, the **Preview Shop PR** GitHub Action (`preview-shop-pr.yml`) starts building the preview environment. **DO NOT show the preview URL/header to the PM yet** — the environment isn't ready until this workflow succeeds.

   Tell the PM once: *"mirrord is creating your preview environment — I'll keep you posted and ping you the moment it's ready (~5-10 min)."*

   **Step 6a — Find the workflow run.**

   Wait ~15 seconds for GitHub to register the run, then use the **WebFetch** tool (NOT `gh` CLI, which may not be available) to query the GitHub Actions API. The repo is public so no auth is needed for reads:

   ```
   GET https://api.github.com/repos/metalbear-co/playground/actions/runs?branch=<branch-name>&event=pull_request&per_page=1
   ```

   Parse the JSON response to extract:
   - `workflow_runs[0].id` — the run ID
   - `workflow_runs[0].status` — `queued`, `in_progress`, or `completed`
   - `workflow_runs[0].conclusion` — `success`, `failure`, etc. (only present when completed)

   If no runs are found, wait 15 more seconds and retry (up to 3 times).

   **Step 6b — Poll with themed progress updates, every ~60 seconds.**

   Do NOT poll more frequently than every 60 seconds — the build takes 5-10 minutes so frequent polling wastes resources and clutters the output.

   On each poll, use WebFetch to check a single run:
   ```
   GET https://api.github.com/repos/metalbear-co/playground/actions/runs/<RUN_ID>
   ```

   Parse `status` and `conclusion` from the response.

   **Between polls**, show the PM one themed progress message (cycle through in order):
   ```
   mirrord is spinning up your preview environment...
   Building your preview pod image — mirrord will route traffic to it shortly...
   Deploying your changes into the preview environment...
   mirrord is wiring up traffic splitting for your branch...
   Preview environment is warming up — almost ready to intercept requests...
   Finalizing the mirrord baggage header routing for your preview...
   Preview environment is almost done — mirrord is doing its magic...
   ```

   **How to drive the loop:**
   1. Start with tick 0. Show themed message `tick % 7`, then wait ~60 seconds, then poll via WebFetch.
   2. If `status` is `completed` — stop polling. Check `conclusion`.
   3. Otherwise, increment tick and repeat.
   4. Hard cap: stop after 20 ticks (~20 min). Tell PM: *"Preview environment is taking unusually long — check the PR's Actions tab on GitHub."*

   **Step 6c — Branch on the result:**
   - `conclusion = success` — proceed to Step 7.
   - `conclusion` in `failure`, `cancelled`, `timed_out` — do NOT present the preview URL. Fetch the failed run's jobs:
     ```
     GET https://api.github.com/repos/metalbear-co/playground/actions/runs/<RUN_ID>/jobs
     ```
     Look at `jobs[].steps[]` for failed steps. Summarize the failure for the PM and offer to help debug.

7. **Present Preview Environment info** — only after Step 6 succeeded, show the PM:

   ## mirrord Preview Environment is Ready

   Your preview environment is live. Test your changes:

   | | |
   |---|---|
   | **Preview URL** | https://playground.metalbear.dev/shop |
   | **Header** | `baggage: mirrord-session=<branch-name>` |

   ### How to Test

   **Option 1: mirrord Browser Extension** (Recommended)
   1. Install the mirrord Browser Extension
   2. Set the header `baggage: mirrord-session=<branch-name>` for the preview URL
   3. Navigate to the preview URL - your changes will be served!

   **Option 2: curl**
   ```bash
   curl -H "baggage: mirrord-session=<branch-name>" https://playground.metalbear.dev/shop
   ```

   **Option 3: Browser DevTools**
   1. Open DevTools > Network tab
   2. Use a request interceptor extension to add the header
   3. Refresh the page

   ### Shareable Preview URL (no extension needed)
   ```
   https://preview.metalbear.dev/<branch-name>/shop
   ```
