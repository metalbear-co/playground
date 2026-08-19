---
name: preview-shop
description: Use when a PM or developer wants a MetalMart shop change implemented, pushed to a PR, and exposed through the mirrord preview workflow for human review after the preview build succeeds.
---

# Preview Shop

Use this skill for the MetalMart preview flow in this repo when the human will do the final verification.

Read `docs/AI_ROOT_CONTEXT.md` first for repo and deployment context.

## Workflow

1. Pull the latest `main`.
2. Create a branch whose final path segment is a two-word preview-safe key.
3. Implement the requested change in `apps/shop/metal-mart-frontend/` or `apps/shop/<service>/`.
4. Commit and push the branch.
5. Create a PR against `main`.
6. Wait for the `preview-shop-pr.yml` workflow to finish before presenting any preview URL or header.
7. Present the preview URL, baggage header, and shareable preview URL only after the workflow succeeds.

## Branch And Preview Key Rule

The workflow checks out the full branch ref, but the preview key and mirrord routing value are the
branch's final path segment after `/`.

- Preview key format must be exactly `^[a-z]+-[a-z]+$`
- The preview key is the full branch if there is no slash, or the part after the final slash
- No random suffixes
- No `demo-` prefix on the preview key

Examples:
- `product-search`
- `feature/product-search`
- `cart-fix`
- `aviram/cart-fix`
- `rename-swag`

## PR and Preview Flow

Preferred PR creation:

```bash
gh pr create --title "<title>" --body "<body>" --base main --head <branch>
```

Fallback if `gh` is unavailable:

- Use any available authenticated GitHub API path to create the PR.
- If auth is missing, stop and report that exact blocker.

After the PR is open:

1. Tell the human once that mirrord is building the preview.
2. Poll the GitHub Actions run for `preview-shop-pr.yml` no faster than every 60 seconds.
3. Stop polling after success, failure, or 20 minutes.
4. On failure, summarize the failed job or step and do not present a preview URL.

## Success Output

When the preview succeeds, provide:

- Preview URL: `https://playground.metalbear.dev/shop`
- Header: `baggage: mirrord-session=<preview-key>`
- Shareable URL: `https://preview.metalbear.dev/<preview-key>/shop`

Also include short testing instructions for the browser extension, `curl`, or request-header tools.
