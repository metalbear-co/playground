#!/usr/bin/env bash
# Deploy the EVENT-DRIVEN mode of kafka-demo in its own kafka-demo-event namespace
# (the base A->B->C demo stays in kafka-demo).
#
#   gateway-ev -> service-a-ev --(kafka)--> service-b-ev --(writes DB state)-->
#   CronJob Z (reads DB state, emits kafka) --> service-c-ev
#
# Mirrors an event-driven flow. Reuses the base demo's images (built by deploy.sh) plus
# the new cronjob image, on the shared Kafka with kafka-demo.ev.* topics, so both demos
# run at once. Manual deploy — not ArgoCD.
#
# Run scripts/deploy.sh first (it builds+pushes all images incl. the cronjob). The
# overlay creates the namespace + Kafka MirrordPropertyList; this script also creates
# the DB secret (a credential, kept out of git).
set -euo pipefail

NS=kafka-demo-event
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "==> Target cluster: $(kubectl config current-context)"

echo "==> Ensuring $NS namespace"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

echo "==> Ensuring DB secret in $NS (connection string stays out of git)"
if ! kubectl -n "$NS" get secret kafka-demo-db >/dev/null 2>&1; then
  if [ -z "${DATABASE_URL:-}" ] && kubectl -n kafka-demo get secret kafka-demo-db >/dev/null 2>&1; then
    # Reuse the base demo's DB credential if it already exists.
    DATABASE_URL="$(kubectl -n kafka-demo get secret kafka-demo-db -o jsonpath='{.data.url}' | base64 -d)"
  fi
  : "${DATABASE_URL:?Set DATABASE_URL to your Postgres connection string, e.g. postgresql://USER:PASSWORD@postgres.infra.svc.cluster.local:5432/postgres}"
  kubectl -n "$NS" create secret generic kafka-demo-db --from-literal=url="$DATABASE_URL"
fi

echo "==> Applying the event-driven overlay (namespace, property list, workloads)"
kubectl apply -k manifests/kafka-demo/overlays/event-driven

echo "==> Waiting for rollouts"
for d in gateway-ev service-a-ev service-b-ev service-c-ev; do
  kubectl -n "$NS" rollout status "deployment/$d" --timeout=120s
done
echo "==> CronJob:"
kubectl -n "$NS" get cronjob cronjob-z

cat <<EOF

==> Done.

Open the event-driven button UI:
    kubectl -n $NS port-forward svc/gateway-ev 8081:80
    open http://localhost:8081/kafka-demo-ev

Watch the flow (B writes DB state, CronJob Z, C consumes):
    kubectl -n $NS logs -l app=service-b-ev -f --tail=20
    kubectl -n $NS logs -l app=cronjob-z    -f --tail=20
    kubectl -n $NS logs -l app=service-c-ev -f --tail=20

Run the mirrord POC choreography (branched CronJob + idle preview):
    ./apps/kafka-demo/scripts/preview-event-driven.sh --help

Tear down ONLY the event-driven demo (base demo in kafka-demo stays):
    kubectl delete -k manifests/kafka-demo/overlays/event-driven
EOF
