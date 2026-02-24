# mirrord Preview Environments in CI

This doc summarizes the preview env CI flow used for the ip-visit demo. It can be reused as a reference for similar setups.

## Flow

1. **On PR open / push:** Workflow builds frontend and counter images, pushes them with tags `preview-pr-<number>-<sha>`, runs `mirrord preview start` twice (one per deployment) with the same key `pr-<number>`, and posts or updates a single PR comment with the preview URL and header (`X-PG-Tenant: pr-<number>`).
2. **Reviewers:** Open the shared link and set the header (e.g. via the [mirrord Browser Extension](https://metalbear.com/mirrord/docs/using-mirrord/browser-extension)). The UI shows "Preview: pr-<number>" when the request hits the preview pods.
3. **On PR merge or close:** Workflow runs `mirrord preview stop -k pr-<number>` to tear down the preview pods.

## References

- [.github/workflows/preview-env-pr.yml](../.github/workflows/preview-env-pr.yml) – workflow definition
- [apps/ip-visit/ip-visit-counter/mirrord-preview.json](../apps/ip-visit/ip-visit-counter/mirrord-preview.json) – counter preview config
- [apps/ip-visit/ip-visit-frontend/mirrord-preview.json](../apps/ip-visit/ip-visit-frontend/mirrord-preview.json) – frontend preview config
- [mirrord Preview Environments](https://metalbear.com/mirrord/docs/using-mirrord/preview-environments)
- [mirrord Browser Extension](https://metalbear.com/mirrord/docs/using-mirrord/browser-extension)
