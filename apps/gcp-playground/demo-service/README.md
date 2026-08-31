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

Cloud Run runs `linux/amd64` only, so this image and the bootstrap library it
preloads are both built for amd64. The ECS demo's ARM64 build of that library is
not interchangeable.

The deployed service preloads mirrord's remote bootstrap library from a volume a
sidecar publishes it onto — see `../mirrord-bootstrap-sidecar`. That library is
built against glibc and needs a dynamic loader, which is why the runtime image is
`bookworm-slim` rather than Alpine — on musl the `LD_PRELOAD` would be ignored
silently.
