# mirrord workshop

Self-contained kit to run a hands-on mirrord workshop for **up to 50 attendees**. Everything
lives in this `workshop/` directory — **no existing playground code is modified.** We reuse the
MetalMart `inventory-service` (via its published image) and ship our own UI, Postgres seed,
Helm chart, polyglot local backends, companion CLI, and seat broker.

## The pitch (what attendees do)

After a 5-min slide intro, each attendee (≈45–60 min hands-on):

1. Runs `inventory-service` **locally** under `mirrord` in **steal** mode, targeting their pod.
2. Opens their browser to `https://workshop.metalbear.dev/aNN/` and sees the product grid —
   the page banner flips to **"Served by your laptop."**
3. **Edits a line** (e.g. a product name / price) in their local backend, refreshes, and watches
   the change appear in the cluster-served storefront.
4. Sees env/DNS/outgoing "just work" (Node path connects to the cluster Postgres through mirrord).
5. **Finale:** everyone steals **one shared** inventory pod at once, each filtered by their own
   `baggage` session key — 50 devs sharing a service, each seeing only their traffic (Operator).

The hook is visceral because the change shows up in a real browser, and because the pod runs
**Node while your laptop can run Python/Go/Ruby/…** — mirrord steals at the network layer, so it
doesn't care.

## Architecture (locked)

- **Cluster:** a **separate GKE cluster** in the existing GCP project (blast-radius isolation).
  Attendees never get GCP IAM — they get **namespace-scoped ServiceAccount-token kubeconfigs**.
- **Routing:** **path-based on one host** → `workshop.metalbear.dev/aNN/`. One Google-managed
  cert (GKE managed certs don't support wildcards), one DNS A-record, N HTTPRoute rules on the
  shared Gateway. The static UI uses relative URLs so one file serves every path.
- **Lean topology:**

  | Component | Count | Notes |
  |---|---|---|
  | Static UI (nginx + `ui/index.html`) | ×1 shared | identical for everyone; relative `fetch('products')` self-targets |
  | `inventory-service` (steal target) | ×N | one per `attendee-NN` namespace; published image, pinned digest |
  | Postgres + product seed | ×1 shared | read-only `/products`, safe to share; seeded from `db/seed.sql` |
  | Finale `inventory-service` + Operator policy | ×1 | shared target, `baggage` filtered steal |

- **Per-attendee namespace = OSS-core** steal/edit (distinct targets = low risk).
  **Finale = concurrent steal on one target** with `baggage: mirrord-session=<key>` (Operator;
  the 50-on-1 pattern — load-test it; fallbacks: shard replicas, group the room, or demo it).
- **Local backend (what they steal & edit)** ships polyglot so nobody installs a runtime:
  - **Node** → queries the real cluster Postgres through mirrord (full env + outgoing magic).
  - **Python, Go, Java, Ruby, .NET, PHP** → return canned data identical to the seed (zero deps).
  - All set an **`X-Served-By: <hostname>`** response header so the UI shows the laptop flip.
  - All implement `/health` (+ we also steal with a `/products` path filter) so probes don't break.

## OS support

- **macOS** — primary, first-class.
- **Windows** — **WSL2 only**: mirrord + runtime + edits live inside WSL2; the browser stays on
  the Windows host hitting the public URL. Longest pre-work path — dedicated track in the email,
  tested on a real WSL2 box in the dry run.

## Layout

```
workshop/
  README.md     ← this file (architecture of record + build checklist)
  chart/        Helm chart — renders + lints clean (helm lint, helm template N=60)        [DONE, needs cluster]
    Chart.yaml, values.yaml
    files/      index.html (static UI) + seed.sql (product seed)  — embedded via .Files
    templates/  00-namespaces 10-postgres 20-ui 25-broker 30-attendee 35-frontend 40-rbac 60-gateway
  backends/     polyglot local inventory backends + mirrord.json  [DONE]
    node/ (real DB) python/ go/ java/ ruby/ dotnet/ php/  — same /products contract, X-Served-By, /health
  companion/    Go CLI (stdlib only): start/run/doctor/reset; embeds backends; supervised mirrord  [DONE]
  broker/       Go seat-claim service + projected progress board                                  [DONE]
  run-of-show.md  facilitator script, timeline, failure playbook                                  [DONE]
  prework-email.md  attendee setup email (incl. WSL2 track)                                       [DONE]
  scripts/      bootstrap-cluster.sh (GKE + Operator + Helm + cert) · gen-seats.sh (→ seats.json) [DONE]
```

Render it yourself: `helm template ws workshop/chart --set attendeeCount=2 | less`

## Build checklist

**Phase 1 — cluster-side stack (deployable, dry-runnable)**
- [x] Product seed (`chart/files/seed.sql`)
- [x] Static UI (`chart/files/index.html`)
- [x] Helm chart: shared Postgres (seeded), shared static UI, `range` over N attendee namespaces
      (inventory Deploy/Svc + SA + token + namespace-scoped RBAC + HTTPRoute with path rewrite)
- [x] Finale namespace: shared inventory + `MirrordPolicy` (block steal-without-filter) + RBAC
- [x] Gateway + ManagedCertificate for `workshop.metalbear.dev`
- [x] `helm lint` + `helm template` (N=60) clean
- [ ] Deploy to a test cluster with N=2; verify routing + a real steal end-to-end
- [ ] **Validate on cluster:** attendee RBAC vs pinned Operator version; managed-cert two-step
      (`gateway.tls.preSharedCertName`); pin `images.inventory` digest

**Phase 2 — local experience**
- [x] Polyglot backends (Node+DB; canned: Python/Go/Java/Ruby/.NET/PHP) — shared `/products` contract, `X-Served-By`, `/health`
- [x] mirrord.json: steal `^/products` only (probes stay on the pod) + `port_mapping [[8080,80]]` (no sudo)
- [x] Verified Python/Go/Java/Ruby end-to-end locally; Node DB path starts + serves health
- [ ] Run `dotnet`/`php` on a machine with those runtimes (code-reviewed, not yet executed)
- [ ] On-cluster: confirm a real steal routes browser traffic to the local backend end-to-end

**Phase 3 — companion + broker**
- [x] Broker: idempotent seat claim API + progress board (tested: claim/idempotency/status)
- [x] Companion (Go): preflight, install mirrord, claim, write kubeconfig, detect runtime,
      supervised `mirrord exec` + mtime hot-reload, `doctor`/`reset` (tested: start/run/doctor)
- [x] Backends embedded via build.sh; companion prints the per-language `mirrord exec` command
- [ ] On-cluster: run a real (non-dry) `workshop run` against a deployed seat end-to-end

**Phase 4 — run the room**
- [x] Pre-work email (`prework-email.md`) — install + `workshop doctor`; dedicated WSL2 track
- [x] `run-of-show.md` — timeline + failure playbook + teardown checklist
- [x] `scripts/bootstrap-cluster.sh` + `scripts/gen-seats.sh` (Operator install + RBAC verified vs charts repo)
- [ ] **Needs a cluster + people:** dry run on mac+WSL2+linux; ~50-session load test

## Open parameters (need values before deploy)

- GKE cluster name / region for the new workshop cluster.
- Attendee count `N` (default chart value: provision a buffer, e.g. 60 for 50 attendees).
- Confirm host `workshop.metalbear.dev` (or chosen domain) + who creates the DNS record.
- **Operator:** license seat count covering ~50 concurrent; confirm 50 filtered steals on one
  target; pin Operator + CLI versions. (Owned internally.)
- `inventory-service` image digest to pin.

## Key risks (see also run-of-show)

Operator license/concurrency · conference WiFi + corporate firewalls ·
local install storm (→ pre-work email) · graceful steal-drop UX (handled in UI) · WSL2 setup time.
