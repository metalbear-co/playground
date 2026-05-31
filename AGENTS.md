# Agent context

Use this file and `docs/` for project context when working in this repo.

## Entry points

- **Project overview, layout, deployment:** [docs/AI_ROOT_CONTEXT.md](docs/AI_ROOT_CONTEXT.md)
- **Feature planning and migrations:** Other markdown files in [docs/](docs/). Check for `*-END-STATE.md`, `*-MIGRATION.md`, etc.
- **How we use context in git:** [docs/AGENTIC-CONTEXT-GIT-PATTERN.md](docs/AGENTIC-CONTEXT-GIT-PATTERN.md)

## Conventions

- When starting a feature, look in `docs/` for an existing plan (end-state, migration) and follow it.
- Commit planning or context docs in the **same branch/PR** as the implementation so git history carries the plan.
- Prefer minimal, directive context; avoid long prose.
- Do not call playground/staging shop APIs without mirrord: `.cursor/rules/01-no-staging-api-without-mirrord.mdc`.
- For inventory-service changes, use the mirrord filtered-traffic workflow in `.cursor/rules/00-mirrord-inventory-service.mdc`.

## Playground / staging guardrails

The shared cluster at `https://playground.metalbear.dev` is staging. When verifying or fixing shop work:

- **Do not use `kubectl port-forward`** (or similar) into `shop` or `infra` workloads as a substitute for mirrord or local-only testing. Use `mirrord exec` with the service `mirrord.json` and session-filtered traffic through the public shop URL, or run services locally (see `.cursor/skills/mirrord-run-shop/SKILL.md`).
- **Do not alter the playground/staging database** without explicit human permission. No ad-hoc `kubectl exec` into Postgres, no manual `UPDATE`/`INSERT`/`DELETE` against shared `inventory`, `orders`, or other demo DBs to “fix” or “test” data. Validate through mirrord + public APIs and Playwright; put repairs in service code on your branch if data must be normalized at runtime.

## Build and deploy

- **GKE:** `kubectl apply -k overlays/gke` (or `kustomize build --enable-helm overlays/gke | kubectl apply -f -`). See [docs/AI_ROOT_CONTEXT.md](docs/AI_ROOT_CONTEXT.md) and `overlays/gke/DRY-RUN.md` if present.
- **Apps:** See `apps/*/README.md` and root [README.md](README.md) for local run, SQS, proto.
