Automate the full PM feature workflow for the MetalMart shop (playground repo).

Follow these steps in order:

1. **Pull latest main**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create feature branch** from the feature description:
   - Prefix: `feature/`, `fix/`, `update/`, or `chore/`
   - Name: kebab-case, max 50 chars, descriptive
   ```bash
   git checkout -b <branch-name>
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

6. **Present Preview Environment info** — after the PR is created, show the PM:

   ## Preview Environment

   Your preview environment is being created! Once the GitHub Action completes (~5-10 minutes), you can test your changes:

   | | |
   |---|---|
   | **Preview URL** | https://playground.metalbear.dev/shop |
   | **Header** | `baggage: mirrord=<branch-name>` |

   ### How to Test

   **Option 1: mirrord Browser Extension** (Recommended)
   1. Install the mirrord Browser Extension
   2. Set the header `baggage: mirrord=<branch-name>` for the preview URL
   3. Navigate to the preview URL

   **Option 2: curl**
   ```bash
   curl -H "baggage: mirrord=<branch-name>" https://playground.metalbear.dev/shop
   ```

   ### Shareable Preview URL (no extension needed)
   ```
   https://preview.metalbear.dev/<branch-name>/shop
   ```
