# kafka-demo — mirrord Kafka queue-splitting demo

A deliberately minimal, **Kafka → Kafka → Kafka** app for demoing mirrord against a
shared cluster. There is almost no HTTP: one button produces a single Kafka
message, and it flows through three services, each hop queue-to-queue.

```
[ button ] --HTTP--> gateway --produce--> kafka-demo.a
                                              │
                                        service-a  (consume a → produce b)
                                              │
                                        kafka-demo.b
                                              │
                                        service-b  (consume b → produce c)
                                              │
                                        kafka-demo.c
                                              │
                                        service-c  (consume c → done)

Every service also emits a small event to  kafka-demo.trace,
which the gateway consumes to light up A → B → C live in the UI.
```

All four binaries are Go (`segmentio/kafka-go`). They reuse the **cluster's
existing Kafka** at `kafka.infra.svc.cluster.local:9092` (topics auto-create), and
run in their own **`kafka-demo`** namespace. Deploy is **manual** (not ArgoCD).

## Layout

| Path | What |
|---|---|
| `gateway/` | HTTP entry: serves the button UI (embedded `index.html`), `POST /produce`, `GET /trace/:id`. Produces to `kafka-demo.a`, consumes `kafka-demo.trace`. |
| `service-a/` | consume `kafka-demo.a` → produce `kafka-demo.b` |
| `service-b/` | consume `kafka-demo.b` → produce `kafka-demo.c` |
| `service-c/` | consume `kafka-demo.c` (terminal) |
| `scripts/deploy.sh` | Build images into minikube + `kubectl apply -k`. |

Manifests live in `manifests/kafka-demo/` (deployments, svc, `MirrordSplitConfig`
per service, one shared `MirrordPropertyList`).

## Deploy

Runs on the same cluster as shop (uses that cluster's Kafka), in its own
`kafka-demo` namespace. Images are pushed to GHCR (public, like the shop images)
and pulled by the cluster — so authenticate to GHCR first.

The gateway persists the button click counter in Postgres via a Secret
(`kafka-demo-db`), so the connection string is **never committed** — pass it as
`DATABASE_URL` and `deploy.sh` creates the Secret for you.

```bash
gh auth token | docker login ghcr.io -u <you> --password-stdin   # one-time
export DATABASE_URL='postgresql://USER:PASSWORD@postgres.infra.svc.cluster.local:5432/postgres'
./apps/kafka-demo/scripts/deploy.sh                              # build+push+apply
kubectl -n kafka-demo port-forward svc/gateway 8080:80
open http://localhost:8080
```

The four GHCR packages (`playground-kafka-demo-*`) must be **public** the first
time (Package settings → Change visibility), or add an image pull secret to the
namespace — otherwise pods `ImagePullBackOff`.

Press **Produce message** and watch A → B → C light up.

## The mirrord bit — queue splitting

Every message carries a `baggage` header. When you type a **session** in the UI
(e.g. your username), the gateway sets `mirrord-session=<you>` as a **W3C Baggage**
member once; from there propagation is handled by **OpenTelemetry**, not by hand.

Each service installs the OTel propagator (`OTEL_PROPAGATORS`, default
`tracecontext,baggage`) and, at each Kafka hop, does `Extract` on consume →
`Inject` on produce over a small Kafka-header carrier. The `baggage` member — and
a `traceparent` for free — rides along automatically; no service ever names the
header. This mirrors how a real OTel-instrumented service already carries context,
so mirrord piggybacks on instrumentation you'd have anyway. Set `OTEL_PROPAGATORS`
to include `baggage` (it does by default) or splitting won't see the session.

Each service ships a `mirrord.json` with a `split_queues` filter on that header,
plus a `MirrordSplitConfig` in the manifests. So you can run any one service
locally and **steal only your own tagged messages** out of the shared chain while
the in-cluster copy keeps serving everyone else — the isolation story for testing
Kafka consumers against a shared/staging cluster (incl. from CI).

Run service-b locally against the cluster:

```bash
cd apps/kafka-demo/service-b
USER=$(whoami) mirrord exec -f mirrord.json -- go run .
```

Then in the UI set the session field to your `$USER` and press the button:
your local service-b handles the message; leave it blank and the cluster handles it.

> Requires the mirrord operator (>= 3.170.0) for Kafka queue splitting.

## Config (env vars)

Services: `KAFKA_ADDRESS`, `KAFKA_TOPIC` (in), `NEXT_TOPIC` (out; empty = terminal),
`TRACE_TOPIC`, `KAFKA_CONSUMER_GROUP`, `STAGE`, `SERVICE_NAME`, `WORK_MILLIS`, `PORT`,
`DB_MODE` (empty = terminal counter; `event-sink` = write pending state, no forward).
Gateway: `KAFKA_ADDRESS`, `FIRST_TOPIC`, `TRACE_TOPIC`, `TRACE_GROUP_ID`, `BASE_PATH`,
`UI_VARIANT` (empty = Kafka-chain UI; `event-driven` = the DB + CronJob UI), `PORT`.
All: `OTEL_PROPAGATORS` (default `tracecontext,baggage`) — must include `baggage`.

## Event-driven mode (DB state + CronJob)

A **second, parallel** demo that mirrors an event-driven architecture where a service
writes DB state and a **CronJob** periodically inspects that state and emits the next
event. It runs alongside the base A→B→C demo (same namespace, `*-ev` names, its own
`kafka-demo.ev.*` topics), so both are available at once.

```
[ button ] --HTTP--> gateway-ev --produce--> kafka-demo.ev.a
                                                  │
                                          service-a-ev  (consume ev.a → produce ev.b)
                                                  │
                                          kafka-demo.ev.b
                                                  │
                                          service-b-ev  (consume ev.b → WRITE DB state)
                                                  │
                                          kafka_demo_events (pending)      ← Postgres
                                                  │
                                          CronJob Z   (every ~1m: read pending state →
                                                  │    emit kafka-demo.ev.c, mark emitted)
                                          kafka-demo.ev.c
                                                  │
                                          service-c-ev  (consume ev.c → done)
```

The originating **`mirrord-session` baggage** is stored on the DB row and re-attached
by CronJob Z to the event it emits, so the flow stays session-tagged end to end —
that's what lets queue splitting and idle previews route a single developer's flow.

### Deploy

```bash
gh auth token | docker login ghcr.io -u <you> --password-stdin   # one-time
export DATABASE_URL='postgresql://USER:PASSWORD@postgres.infra.svc.cluster.local:5432/postgres'
./apps/kafka-demo/scripts/deploy.sh                     # build+push ALL images (incl. cronjob)
./apps/kafka-demo/scripts/deploy-event-driven.sh        # apply the event-driven overlay
kubectl -n kafka-demo port-forward svc/gateway-ev 8081:80
open http://localhost:8081/kafka-demo-ev
```

Press **Produce message** and watch **A → B (writes DB) → CronJob Z → C** light up. The
B→Z hop waits for the CronJob's next tick (~1 min); use
`scripts/preview-event-driven.sh trigger` to run it immediately.

### The mirrord bit — the POC choreography

This mode is built to show the two capabilities the POC sells:

- **Idle Preview Environments** — a preview of `service-c-ev` that runs **zero pods**
  until a matching Kafka message arrives, then boots to handle it
  (`feature.preview.idle`, see `service-c/mirrord-preview-ev.json`).
- **CronJob DB-branching** — CronJob Z run under mirrord reads an **isolated Postgres
  branch** instead of shared staging (`copy_target` + `db_branches`, target
  `cronjob/cronjob-z`, see `cronjob/mirrord-preview.json`).

```bash
# 1. start the idle preview of service-c-ev (0 pods until your event lands)
./apps/kafka-demo/scripts/preview-event-driven.sh idle

# 2. in the UI, set the session field to your username and press the button
#    (service-b-ev writes a session-tagged pending row)

# 3. run CronJob Z under mirrord against a branched DB
./apps/kafka-demo/scripts/preview-event-driven.sh cron

# → the branched CronJob reads only your rows, emits a session-tagged event,
#   which wakes your idle service-c-ev preview to process only your message,
#   while the cluster copy keeps serving everyone else. Shared staging DB is untouched.

# cleanup
./apps/kafka-demo/scripts/preview-event-driven.sh clean
```

> Requires an operator build with idle previews and cronjob DB-branching support,
> in addition to the base demo's Kafka-splitting requirement (>= 3.170.0). The exact
> interplay of a shared DB branch across the previewed CronJob and `service-c-ev` is
> still being finalized.

Tear down only the event-driven resources (base demo stays):

```bash
kubectl delete -k manifests/kafka-demo/overlays/event-driven
```
