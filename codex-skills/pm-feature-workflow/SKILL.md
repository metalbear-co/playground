---
name: pm-feature-workflow
description: Use when a product manager asks for a MetalMart playground feature or code change and wants the full implementation workflow run through branch, PR, preview build, and preview handoff.
---

# PM Feature Workflow

This skill automates the end-to-end workflow for PM-driven MetalMart changes in this repo.

Read `docs/AI_ROOT_CONTEXT.md` first.

> The full branch is used for checkout and Docker tag input. The preview key and `baggage` routing
> value are the branch's final path segment after `/`.

## Workflow Overview

1. Pull latest `main`.
2. Create a branch whose final path segment is preview-safe.
3. Implement the requested change.
4. Commit and push.
5. Create a PR.
6. Wait for the preview workflow to succeed.
7. Hand the PM the preview details.

## Branch And Preview Key Rule

The preview key is the full branch if there is no slash, or the part after the final slash. The
preview key must match `^[a-z]+-[a-z]+$`.

- Exactly two lowercase ASCII words joined by one hyphen in the preview key
- No random suffixes
- Namespace prefixes such as `feature/` are allowed because they are not part of the preview key

Examples:
- `product-search`
- `feature/product-search`
- `cart-fix`
- `aviram/cart-fix`
- `checkout-button`

If the preview key does not match the rule, delete the branch and recreate it correctly before continuing.

## Implementation Scope

Typical paths:

- Frontend: `apps/shop/metal-mart-frontend/`
- Services: `apps/shop/<service-name>/`

Use a standard commit message such as:

- `feat(frontend): add product search functionality`
- `fix(order-service): correct total calculation`
- `style(checkout): update button colors`

## PR Creation

Preferred:

```bash
gh pr create --title "<title>" --body "<body>" --base main --head <branch>
```

Fallback:

- Use any available authenticated GitHub API path if `gh` is unavailable.
- If no authenticated path exists, report that blocker directly.

## Preview Wait Loop

After the PR is opened, do not present the preview until the preview build succeeds.

1. Wait briefly for GitHub to register the run.
2. Poll the `preview-shop-pr.yml` run for the branch or PR.
3. Poll no faster than every 60 seconds.
4. Hard stop after 20 ticks and report that the build is taking unusually long.

Between polls, give the PM one short status update. Reuse a rotating set of messages such as:

- `mirrord is spinning up your preview environment...`
- `Building your preview pod image...`
- `Deploying your changes into the preview environment...`
- `mirrord is wiring up traffic splitting for your branch...`
- `Preview environment is warming up...`

If the workflow fails:

- Fetch the failed job or step details.
- Summarize the failure in plain language.
- Do not fabricate a preview URL.

## Success Output

When the preview succeeds, return:

- Preview URL: `https://playground.metalbear.dev/shop`
- Header: `baggage: mirrord-session=<preview-key>`
- Shareable URL: `https://preview.metalbear.dev/<preview-key>/shop`

Also provide concise testing instructions using either the mirrord browser extension, `curl`, or a request-header tool.
