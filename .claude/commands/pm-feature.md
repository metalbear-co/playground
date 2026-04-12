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

5. **Create PR** using GitHub CLI:
   ```bash
   gh pr create --title "<PR title>" --body "<description>" --base main --head <branch-name>
   ```

6. **Wait for the Preview Workflow to Finish**

   After the PR is created, the **Preview Shop PR** GitHub Action (`preview-shop-pr.yml`) starts building the preview environment. **DO NOT show the preview URL/header to the PM yet** — the environment isn't ready until this workflow succeeds.

   Tell the PM once: *"mirrord is creating your preview environment — I'll keep you posted and ping you the moment it's ready (~5-10 min)."* Then poll the workflow and surface themed progress messages.

   **Step 6a — Find the run:**
   ```bash
   sleep 10
   RUN_ID=$(gh run list \
     --branch "<branch-name>" \
     --workflow "Preview Shop PR" \
     --limit 1 \
     --json databaseId \
     --jq '.[0].databaseId')
   echo "Watching run $RUN_ID"
   ```

   If `RUN_ID` is empty, wait another 10 seconds and retry (up to 3 times).

   **Step 6b — Poll with themed progress updates, ONE iteration at a time.**

   Critical UX requirement: the PM must see messages appear live, every 20 seconds. Do NOT run the polling loop as a single long-running bash script. Instead, run one short bash command per tick: check status, print ONE themed message, sleep 20, return. Then repeat as a new bash call.

   **The themed message pool** (cycle through in order, one per tick):
   ```
   mirrord is spinning up your preview environment...
   Building your preview pod image — mirrord will route traffic to it shortly...
   Deploying your changes into the preview environment...
   mirrord is wiring up traffic splitting for your branch...
   Preview environment is warming up — almost ready to intercept requests...
   Finalizing the mirrord baggage header routing for your preview...
   Preview environment is almost done — mirrord is doing its magic...
   ```

   **Per-tick command:**
   ```bash
   TICK=<TICK>
   MESSAGES=(
     "mirrord is spinning up your preview environment..."
     "Building your preview pod image — mirrord will route traffic to it shortly..."
     "Deploying your changes into the preview environment..."
     "mirrord is wiring up traffic splitting for your branch..."
     "Preview environment is warming up — almost ready to intercept requests..."
     "Finalizing the mirrord baggage header routing for your preview..."
     "Preview environment is almost done — mirrord is doing its magic..."
   )
   STATUS=$(gh run view "$RUN_ID" --json status,conclusion --jq '.status + "|" + (.conclusion // "")')
   RUN_STATUS="${STATUS%|*}"
   RUN_CONCLUSION="${STATUS#*|}"
   if [ "$RUN_STATUS" = "completed" ]; then
     echo "DONE|$RUN_CONCLUSION"
   else
     echo "${MESSAGES[$((TICK % 7))]}"
     sleep 20
     echo "WAITING"
   fi
   ```

   **How to drive the loop:**
   1. Start with `TICK=0`. Run the per-tick command.
   2. If output starts with `DONE|` — stop polling. Jump to Step 6c.
   3. Otherwise, surface the themed message to the PM, then run again with `TICK=1`, `TICK=2`, etc.
   4. Hard cap: stop after 90 ticks (~30 min). Tell PM: *"Preview environment is taking unusually long — you can check directly with `gh run view $RUN_ID`."*

   **Step 6c — Branch on the result:**
   - `conclusion = success` — proceed to Step 7.
   - `conclusion` in `failure`, `cancelled`, `timed_out`, `startup_failure` — do NOT present the preview URL. Fetch failed logs:
     ```bash
     gh run view "$RUN_ID" --log-failed
     ```
     Summarize the failure for the PM and offer to help debug or re-run.

7. **Present Preview Environment info** — only after Step 6 succeeded, show the PM:

   ## mirrord Preview Environment is Ready

   Your preview environment is live. Test your changes:

   | | |
   |---|---|
   | **Preview URL** | https://playground.metalbear.dev/shop |
   | **Header** | `baggage: mirrord=<branch-name>` |

   ### How to Test

   **Option 1: mirrord Browser Extension** (Recommended)
   1. Install the mirrord Browser Extension
   2. Set the header `baggage: mirrord=<branch-name>` for the preview URL
   3. Navigate to the preview URL - your changes will be served!

   **Option 2: curl**
   ```bash
   curl -H "baggage: mirrord=<branch-name>" https://playground.metalbear.dev/shop
   ```

   **Option 3: Browser DevTools**
   1. Open DevTools > Network tab
   2. Use a request interceptor extension to add the header
   3. Refresh the page

   ### Shareable Preview URL (no extension needed)
   ```
   https://preview.metalbear.dev/<branch-name>/shop
   ```
