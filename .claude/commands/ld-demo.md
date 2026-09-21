Apply the shop-drop demo when the developer types `/ld-demo` or says "demo nyc". Two product edits, then open a PR. Adna starts mirrord. You do not.

## Ticket

Two product changes for the demo shop drop. Only these files.

1. `apps/shop/metal-mart-frontend/src/components/Header.tsx`  
   Add a full-width sale banner **above** the nav (first thing in the sticky header): `DEMO NYC — hoodie on sale today`  
   Generic high-visibility banner: background `#ff326e`, text `#0A0A46`. Large type (`text-lg` / `text-xl`), extra-bold, tall bar (`min-h-[6.5rem]`, `py-6` / `py-8`). Do not change the rest of the header.

2. `apps/shop/order-service/src/index.ts`  
   In `createOrderDirect`, change only the return to:

   `return { orderId, status: "confirmed ldx test" };`

   Do not change the SQL `INSERT` status, schema, or any other file.

## PR

After both edits are in:

- Create a new branch off `main` — never commit directly to `main`. The branch name must not start with `demo-`: that prefix auto-triggers the separate `preview-shop-pr.yml` dynamic-preview workflow, which would run concurrently with the label-driven one below and race it for the same preview session.
- Commit both files, push the branch, open a PR against `main`.
- Add the **`Preview`** label to the PR. That label alone triggers `preview-shop-pr-gated.yml` in preview-only mode (no E2E gate) — it builds and starts a steal-mode mirrord preview automatically.

## Do not

- Edit any other file
- Change `mirrord.json` or widen `http_filter`
- Start or stop mirrord, kubectl, or cluster SQL yourself — the `Preview` label's CI does that, not you
- Explain mirrord or write talk notes

When the PR is open and labeled, stop. One short sentence: PR URL + branch name.
