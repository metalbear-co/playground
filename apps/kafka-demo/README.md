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
`TRACE_TOPIC`, `KAFKA_CONSUMER_GROUP`, `STAGE`, `SERVICE_NAME`, `WORK_MILLIS`, `PORT`.
Gateway: `KAFKA_ADDRESS`, `FIRST_TOPIC`, `TRACE_TOPIC`, `TRACE_GROUP_ID`, `PORT`.
All: `OTEL_PROPAGATORS` (default `tracecontext,baggage`) — must include `baggage`.
