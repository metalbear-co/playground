#!/usr/bin/env bash
# Deploy the EVENT-DRIVEN mode of kafka-demo alongside the base A->B->C demo.
#
#   gateway-ev -> service-a-ev --(kafka)--> service-b-ev --(writes DB state)-->
#   CronJob Z (reads DB state, emits kafka) --> service-c-ev
#
# Mirrors an event-driven flow. Reuses the base demo's images (built by deploy.sh) plus
# the new cronjob image, and lands in the same kafka-demo namespace with *-ev names
# and kafka-demo.ev.* topics, so both modes run at once. Manual deploy — not ArgoCD.
#
# Run scripts/deploy.sh first (it builds+pushes all images incl. the cronjob). This
# script only applies the overlay + the shared resources kustomize can't pull up
# from base (namespace, DB secret, Kafka MirrordPropertyList).
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "==> Target cluster: $(kubectl config current-context)"

echo "==> Ensuring namespace + DB secret (connection string stays out of git)"
kubectl create namespace kafka-demo --dry-run=client -o yaml | kubectl apply -f -
if ! kubectl -n kafka-demo get secret kafka-demo-db >/dev/null 2>&1; then
  : "${DATABASE_URL:?Set DATABASE_URL to your Postgres connection string, e.g. postgresql://USER:PASSWORD@postgres.infra.svc.cluster.local:5432/postgres}"
  kubectl -n kafka-demo create secret generic kafka-demo-db --from-literal=url="$DATABASE_URL"
fi

echo "==> Applying the shared Kafka MirrordPropertyList (referenced by the split configs)"
kubectl -n kafka-demo apply -f manifests/kafka-demo/base/kafka-property-list.yaml

echo "==> Applying the event-driven overlay"
kubectl apply -k manifests/kafka-demo/overlays/event-driven

echo "==> Waiting for rollouts"
for d in gateway-ev service-a-ev service-b-ev service-c-ev; do
  kubectl -n kafka-demo rollout status "deployment/$d" --timeout=120s
done
echo "==> CronJob:"
kubectl -n kafka-demo get cronjob cronjob-z

cat <<'EOF'

==> Done.

Open the event-driven button UI:
    kubectl -n kafka-demo port-forward svc/gateway-ev 8081:80
    open http://localhost:8081/kafka-demo-ev

Watch the flow (B writes DB state, CronJob Z runs every minute, C consumes):
    kubectl -n kafka-demo logs -l app=service-b-ev -f --tail=20
    kubectl -n kafka-demo logs -l app=cronjob-z    -f --tail=20
    kubectl -n kafka-demo logs -l app=service-c-ev -f --tail=20

Run the mirrord POC choreography (branched CronJob + idle preview):
    ./apps/kafka-demo/scripts/preview-event-driven.sh --help

Tear down ONLY the event-driven resources (base demo stays):
    kubectl delete -k manifests/kafka-demo/overlays/event-driven
EOF
