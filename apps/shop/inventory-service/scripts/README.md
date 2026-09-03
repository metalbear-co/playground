# Demo catalog + DB branching walkthrough

Reskinned storefront demo (branch `earth-tones`). The catalog only ever lives in a
mirrord DB branch — nothing is written to the shared staging database.

## 1. Seed the demo catalog into a DB branch

```bash
cd apps/shop/inventory-service
mirrord exec --config-file mirrord-db-preview.json -- npm run seed:demo
```

This wraps the seed script with a `db_branches` (copy.mode: "all") session, so
`DATABASE_URL` gets rewritten to a fresh full-clone branch before the script runs,
then wipes and reloads `products` there. Requests carrying
`baggage: mirrord-session=<your $USER>` get routed to your local session, so the
preview URL will start rendering the demo catalog for that header.

## 2. Keep the session open for the pitch

Run `mirrord exec` against `inventory-service` for real (not just the one-off
seed script) for the whole call, so the branch stays alive and traffic keeps
routing to it:

```bash
mirrord exec --config-file mirrord-db-preview.json -- npm run dev
```

Same branch, same connection — the seed data persists as long as this session
is up.

**Before recording:** confirm `operator.pgBranching=true` on the target cluster.
Also note `mirrord-db-preview.json`'s `ttl_secs: 30` — that's an idle-branch
expiry, not a hard session cap, but bump it if the branch needs to survive any
gap between connecting and starting the walkthrough.

## 3. Live branching beat

With the session above still running:

1. Pick one demo product, change its stock or price on the branch (e.g. via
   `PATCH /products/:id/stock`, sent with the `mirrord-session` baggage header).
2. Load the plain staging URL (no header) and confirm the number is unchanged —
   that's the isolation story.

## Not built here (narrated only)

- Local CLI / IDE session reuse — same connection, nothing persisted, no
  separate demo needed.
- Idle preview scale-to-zero — no environment staged for this; mention it
  verbally if it comes up.
