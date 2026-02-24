# IP visit counter

This microservice counts the number of visits to a given IP address by using Redis and writes the IP to Kafka.
This is part of MetalBear's playground.

## mirrord Preview Environment (CI)

On pull requests that touch ip-visit-counter or ip-visit-frontend, CI builds both images, starts two preview pods (frontend + counter) with the same key (e.g. `pr-<number>`), and posts a comment with the shared playground link and the header to use. On PR merge or close, the preview is stopped.

- **Workflow:** [.github/workflows/preview-env-pr.yml](../../.github/workflows/preview-env-pr.yml)
- **Preview configs:** [mirrord-preview.json](./mirrord-preview.json) (counter), [../ip-visit-frontend/mirrord-preview.json](../ip-visit-frontend/mirrord-preview.json) (frontend)

Cluster access is obtained via Workload Identity Federation (GitHub OIDC → GCP) using the `GCP_WIF_PROVIDER` and `GCP_SERVICE_ACCOUNT` secrets; no kubeconfig is stored in GitHub.