# aws-playground

Serverless mirrord demos on Amazon ECS (cluster `s8s`). Infrastructure lives in
`metalbear-co/infra` (`environments/s8s-aws`). These apps are **not** deployed
through `manifests/` or GKE Argo.

| Path | What it is | Live? |
| --- | --- | --- |
| [`demo-service/`](demo-service/) | Which process answered + ECS metadata | Yes: `s8s-demo`, [aws-playground.metalbear.dev](https://aws-playground.metalbear.dev). CI: `.github/workflows/build-aws-playground-demo.yaml` |
| [`ask-otto/`](ask-otto/) | Ask Otto product loop (UI, private DB, shipped bug) | Yes: [aws-playground.metalbear.dev/ask-otto/](https://aws-playground.metalbear.dev/ask-otto/). **No CI** — merging this folder does not deploy. See [`ask-otto/README.md`](ask-otto/README.md). |

Do not point the existing workflow at `apps/aws-playground/**`. That would
rebuild `s8s-demo` from the wrong app. Otto, if it gets CI later, needs its own
service name and its own workflow path filter.
