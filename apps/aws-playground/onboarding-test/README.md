# aws-playground onboarding-test

A minimal service for trying mirrord against an ECS task, served at
`https://onboarding-test.aws-playground.metalbear.dev`. It uses only Node's
standard library, so there is nothing to install.

| Route | Returns |
|---|---|
| `GET /healthz` | `ok`, used by the load balancer |
| any other path | JSON with `app`, `platform`, `pid` and `message` |

`platform` is `linux` when the ECS task answers and `darwin` (or your OS) when
your local process does. `message` is set on the task, so under mirrord the
local process shows the task's value too.

## Run locally

```bash
npm start
# http://localhost:8080
```

## Run against the ECS task

`mirrord.json` targets `serverless/onboarding-test` in `demo-env` and steals
only requests that carry `mirrord-session=onboarding-test`, so regular traffic
keeps going to the task.

You need mirrord 3.282.0 or later, and the sessions-manager URL and shared
secret in your environment:

```bash
export MIRRORD_SESSIONS_MANAGER_URL=https://session-manager.aws-playground.metalbear.dev/sm
export MIRRORD_SESSIONS_MANAGER_AUTH_TOKEN="$(aws secretsmanager get-secret-value \
  --secret-id s8s/sessions-manager-auth-header --query SecretString --output text | jq -r .value)"

npm run mirrord
```

Then, from another terminal:

```bash
# Answered by your local process
curl -H "baggage: mirrord-session=onboarding-test" https://onboarding-test.aws-playground.metalbear.dev/

# Answered by the ECS task
curl https://onboarding-test.aws-playground.metalbear.dev/
```

## Deployment

Merging a change under this directory to `main` runs
`.github/workflows/build-aws-playground-onboarding-test.yaml`, which builds the
image, pushes it to ECR, registers a new ECS task definition revision, and rolls
the service. It authenticates by assuming `s8s-github-deploy` through GitHub
OIDC. The infrastructure lives in `metalbear-co/infra` under
`environments/s8s-aws/ecs-onboarding-test.tf`.
