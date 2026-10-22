# gcp-playground demo-service

The public service behind `https://gcp-playground.metalbear.dev`. It answers one
question — which process handled this request, and what does the Cloud Run
container instance metadata server say about it — and that is the whole demo:
hit it and you get the Cloud Run instance, run it locally under mirrord and the
same URL is answered by your laptop while still reading the remote metadata
server.

TypeScript on Express, matching the other services in this repo. It is the
Cloud Run counterpart of `apps/aws-playground/demo-service`, which runs the same
demo on ECS Fargate.

| Route | Returns |
|---|---|
| `GET /` | A page that renders `/api/metadata` |
| `GET /api/metadata` | PID and a narrow projection of Cloud Run instance metadata |
| `GET /healthz` | `ok`, used by the load balancer |

Because it is internet-facing it deliberately has no environment dump, no
caller-controlled outbound requests, and no filesystem access. The one outbound
call it makes is to the metadata server, and it refuses that unless the host
parses as a literal link-local address — a name like `169.254.169.254.example.com`
is a DNS record its owner points wherever they like, so prefix-matching the
string is not enough. This is why `GCE_METADATA_HOST` defaults to the address
rather than to `metadata.google.internal`, which Google's own libraries use and
which this check rejects. The region is trimmed to its trailing name before
publishing, because the metadata server reports it as
`projects/<project number>/regions/<name>`.

## Run locally

```bash
npm install
npm run dev
# http://localhost:8080
```

`K_SERVICE` is unset outside Cloud Run, so `/api/metadata` reports
`"source": "unavailable"`. That is the expected local result. Under mirrord the
variable arrives with the rest of the remote environment, which is what lets a
local process go on to read the remote metadata server.

## Deployment

Merging a change under `apps/gcp-playground/` to `main` runs
`.github/workflows/build-gcp-playground-demo.yaml`, which builds this image and
the bootstrap sidecar, pushes both to Artifact Registry, and updates the two
containers on the Cloud Run service. It authenticates by impersonating a service
account through GitHub OIDC and Workload Identity Federation — no long-lived GCP
keys. The infrastructure lives in `metalbear-co/infra` under
`environments/s8s-gcp`.

The workflow reads four repository secrets, which hold the GCP project and so
are kept out of this public repository:

| Secret | Holds |
|---|---|
| `GCP_S8S_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Provider, used via OIDC |
| `GCP_S8S_DEPLOY_SERVICE_ACCOUNT` | Service account the workflow impersonates |
| `GCP_S8S_ARTIFACT_REGISTRY` | `<region>-docker.pkg.dev/<project>` prefix |
| `GCP_S8S_BOOTSTRAP_IMAGE` | Bootstrap library image the sidecar builds on |

The first three are Terraform outputs of `environments/s8s-gcp`; the fourth is
chosen when that image is published. They exist only once that environment has
been applied, so until then the workflow skips its deploy job rather than failing.

Actions are pinned to a commit rather than a tag: a tag can be repointed at new
code, and these run with a token that can reach GCP.

Cloud Run runs `linux/amd64` only, so this image and the bootstrap library it
preloads are both built for amd64. The ECS demo's ARM64 build of that library is
not interchangeable.

The deployed service preloads mirrord's remote bootstrap library from a volume a
sidecar publishes it onto — see `../mirrord-bootstrap-sidecar`. That library is
built against glibc and needs a dynamic loader, which is why the runtime image is
`bookworm-slim` rather than Alpine — on musl the `LD_PRELOAD` would be ignored
silently.
