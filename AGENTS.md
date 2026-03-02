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

## Build and deploy

- **GKE:** `kubectl apply -k overlays/gke` (or `kustomize build --enable-helm overlays/gke | kubectl apply -f -`). See [docs/AI_ROOT_CONTEXT.md](docs/AI_ROOT_CONTEXT.md) and `overlays/gke/DRY-RUN.md` if present.
- **Apps:** See `apps/*/README.md` and root [README.md](README.md) for local run, SQS, proto.
