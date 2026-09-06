# mirrord Operator on GKE: GitOps runbook

The mirrord Operator on the playground GKE cluster is managed by ArgoCD from
`overlays/gke/mirrord-operator-application.yaml`. That file is the single source
of truth for the chart version and the Helm values. Nothing about the operator
is changed with `helm` or `kubectl` directly.

## Upgrade

1. Pick the target version from https://github.com/metalbear-co/charts/releases
   and read the changelog entries between the current and target versions.
2. Change `spec.source.targetRevision` in the Application file. One version bump
   per PR; avoid skipping many minors at once.
3. Open a PR. Once merged, ArgoCD renders the pinned chart and rolls the
   Deployment. The operator runs a leader plus a standby replica, so the roll
   does not interrupt sessions.
4. Verify:

   ```bash
   kubectl -n mirrord rollout status deploy/mirrord-operator
   mirrord operator status
   ```

   The Application should show Synced and Healthy in ArgoCD.

## Rollback

Revert the PR. ArgoCD rolls the operator back to the previous chart version.

## Changing values

Edit `valuesObject` in the Application file and open a PR. The chart's full
values reference is at
https://github.com/metalbear-co/charts/blob/main/mirrord-operator/values.yaml.

Secrets never go into the file. The chart references Secrets that already exist
in the `mirrord` namespace:

| Secret | Data key | Used by |
|---|---|---|
| `mirrord-operator-cloud-api-key` | `apiKey` | `cloud.apiKey.keyRef` (operator authentication) |
| `aws-credentials` | `aws-access-key-id`, `aws-secret-access-key` | `operator.extraEnv` (SQS splitting) |

To rotate the cloud API key, create a new key in the mirrord dashboard, replace
the Secret's `apiKey` value, and let the operator pick it up. Write the key with
`printf '%s'` and `--from-file`; a trailing newline becomes part of the key.

## Things that must stay as they are

- `metadata.name` and `helm.releaseName` are both `mirrord-operator`. The chart
  stamps the release name into labels on every object.
- `createNamespace: false`. The `mirrord` namespace is shared and is not owned
  by this Application.
- No `resources-finalizer` on the Application. Deleting the Application leaves
  the operator running instead of cascading.
- `cloud.apiKey` and `license.licenseServer` are never set together. With a
  cloud key, the operator sends its token exchange to the license server URL if
  one is configured, which fails and leaves the operator unlicensed.
