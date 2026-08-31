# aws-playground demo-service

The public service behind `https://aws-playground.metalbear.dev`. It answers one
question — which process handled this request, and what does the ECS task
metadata service say about it — and that is the whole demo: hit it and you get
the AWS task, run it locally under mirrord and the same URL is answered by your
laptop while still reading the remote metadata service.

TypeScript on Express, matching the other services in this repo.

| Route | Returns |
|---|---|
| `GET /` | A page that renders `/api/metadata` |
| `GET /api/metadata` | PID and a narrow projection of ECS task metadata |
| `GET /healthz` | `ok`, used by the load balancer |

Because it is internet-facing it deliberately has no environment dump, no
caller-controlled outbound requests, and no filesystem access. The one outbound
call it makes is to `ECS_CONTAINER_METADATA_URI_V4`, and it refuses that unless
the host parses as a literal link-local address — a name like
`169.254.169.254.example.com` is a DNS record its owner points wherever they
like, so prefix-matching the string is not enough. The cluster ARN is trimmed to
its name before publishing, because the ARN carries the AWS account ID. The
task role holds no permissions, so credentials lifted out of the task are worth
nothing.

## Run locally

```bash
npm install
npm run dev
# http://localhost:8080
```

`ECS_CONTAINER_METADATA_URI_V4` is unset outside ECS, so `/api/metadata` reports
`"source": "unavailable"`. That is the expected local result.

## Deployment

Merging a change under this directory to `main` runs
`.github/workflows/build-aws-playground-demo.yaml`, which builds the image,
pushes it to ECR, registers a new ECS task definition revision, and rolls the
service. It authenticates by assuming `s8s-github-deploy` through GitHub OIDC —
no long-lived AWS keys. The infrastructure lives in `metalbear-co/infra` under
`environments/s8s-aws`.

The deployed task preloads mirrord's remote bootstrap library from an init
container. That library is built against glibc and needs a dynamic loader, which
is why the runtime image is `bookworm-slim` rather than Alpine — on musl the
`LD_PRELOAD` would be ignored silently.
