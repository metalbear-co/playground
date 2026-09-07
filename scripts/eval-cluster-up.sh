#!/usr/bin/env bash
#
# Stand up the rehearsal cluster for the agent-evals demo.
#
# A cut-down Metal Mart on its own GKE cluster: Postgres, Kafka and RabbitMQ in
# `infra`, inventory-service, order-service and chat-service in `shop`, seeded
# with the catalogue captured from live playground staging.
#
# chat-service is here because the shopping agent replaces its canned bot reply,
# so the eval target and the on-stage chat demo are the same code path.
#
# Namespaces match playground on purpose, so every .mirrord/*.json config works
# against either cluster and only the kube context changes.
#
# Usage:
#   MIRRORD_LICENSE_KEY=<key> ./scripts/eval-cluster-up.sh
#   MIRRORD_LICENSE_KEY=<key> ./scripts/eval-cluster-up.sh --yes      # skip the prompt
#   ./scripts/eval-cluster-up.sh --apply-only                         # skip cluster creation
#
# The license key is read from the environment and never stored in this repo,
# which is public. To read the key off the playground cluster:
#
#   kubectl --context=<playground> get deployment mirrord-operator -n mirrord \
#     -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="OPERATOR_LICENSE_KEY")].value}'

set -euo pipefail

PROJECT="${EVAL_CLUSTER_PROJECT:-mirrord-test}"
CLUSTER="${EVAL_CLUSTER_NAME:-agent-evals-rehearsal}"
ZONE="${EVAL_CLUSTER_ZONE:-us-central1-c}"
MACHINE="${EVAL_CLUSTER_MACHINE:-e2-standard-4}"
NODES="${EVAL_CLUSTER_NODES:-2}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="$REPO_ROOT/overlays/eval-rehearsal"
CONTEXT="gke_${PROJECT}_${ZONE}_${CLUSTER}"

APPLY_ONLY=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --apply-only) APPLY_ONLY=true ;;
    --yes|-y)     ASSUME_YES=true ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

for bin in gcloud kubectl helm; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is not on PATH"
done
[ -n "${MIRRORD_LICENSE_KEY:-}" ] || die "MIRRORD_LICENSE_KEY is not set (see the header of this script)"

# --------------------------------------------------------------------------
# 1. Cluster
# --------------------------------------------------------------------------
if [ "$APPLY_ONLY" = false ]; then
  if gcloud container clusters describe "$CLUSTER" --zone "$ZONE" --project "$PROJECT" >/dev/null 2>&1; then
    say "Cluster $CLUSTER already exists in $PROJECT/$ZONE — reusing it"
  else
    say "About to CREATE a GKE cluster (this is billable)"
    printf '  project : %s\n  cluster : %s\n  zone    : %s\n  nodes   : %s x %s\n' \
      "$PROJECT" "$CLUSTER" "$ZONE" "$NODES" "$MACHINE"
    if [ "$ASSUME_YES" = false ]; then
      read -r -p "Create it? [y/N] " reply
      case "$reply" in [yY]*) ;; *) die "aborted by user" ;; esac
    fi
    gcloud container clusters create "$CLUSTER" \
      --project "$PROJECT" --zone "$ZONE" \
      --machine-type "$MACHINE" --num-nodes "$NODES" \
      --disk-size 50 --no-enable-autoupgrade
  fi
  gcloud container clusters get-credentials "$CLUSTER" --zone "$ZONE" --project "$PROJECT"
fi

k() { kubectl --context="$CONTEXT" "$@"; }

# Two things settle here, and a live request is the only honest test of either:
# the kubeconfig entry that get-credentials just rewrote has to be readable, and
# a freshly created GKE control plane accepts connections before it can serve
# them — the first helm call otherwise lands as "connection reset by peer".
say "Waiting for the control plane to answer"
for attempt in $(seq 1 30); do
  if k --request-timeout=20s get nodes >/dev/null 2>&1; then
    printf '  ready after %s attempt(s)\n' "$attempt"
    break
  fi
  [ "$attempt" -eq 30 ] && die "context '$CONTEXT' never became reachable — did cluster creation succeed?"
  sleep 10
done

# --------------------------------------------------------------------------
# 2. mirrord operator
# --------------------------------------------------------------------------
# pgBranching is what Act 4 needs and is off by default in the chart. The
# splitters cover the brokers order-service publishes to on a confirmed order.
# SQS splitting is deliberately left off: this cluster runs order-service with
# SQS_QUEUE_URL empty, and enabling it would require an AWS role ARN.
say "Installing/upgrading the mirrord operator"
helm repo add metalbear https://metalbear-co.github.io/charts >/dev/null 2>&1 || true
helm repo update metalbear >/dev/null

helm --kube-context="$CONTEXT" upgrade --install mirrord-operator \
  metalbear/mirrord-operator \
  --namespace mirrord --create-namespace \
  --set license.key="$MIRRORD_LICENSE_KEY" \
  --set operator.pgBranching=true \
  --set operator.kafkaSplitting=true \
  --set operator.rmqSplitting=true \
  --wait --timeout 10m

# --------------------------------------------------------------------------
# 3. Application
# --------------------------------------------------------------------------
say "Applying the eval-rehearsal overlay"
k apply -k "$OVERLAY"

# The shopping agent runs inside chat-service, so the pod needs its own
# Anthropic credential. Created after the overlay because the overlay is what
# creates the namespace, then chat-service is restarted so it picks the secret
# up. Skipped when no key is present: chat-service still runs, and the agent
# answers with a handover message instead of crash-looping.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  say "Creating the shopping-agent secret"
  k create secret generic shopping-agent -n shop \
    --from-literal=anthropic-api-key="$ANTHROPIC_API_KEY" \
    --dry-run=client -o yaml | k apply -f - >/dev/null
  k rollout restart deployment/chat-service -n shop >/dev/null
else
  printf '\n\033[1;33mWARNING: ANTHROPIC_API_KEY is unset — the shopping agent will not answer chats.\033[0m\n'
  printf '  Set it and re-run with --apply-only to enable the storefront demo.\n'
fi

say "Waiting for infrastructure"
k rollout status deployment/postgres  -n infra --timeout=5m
k rollout status deployment/rabbitmq  -n infra --timeout=5m
k rollout status statefulset/kafka    -n infra --timeout=10m

say "Waiting for shop services"
k rollout status deployment/inventory-service -n shop --timeout=5m
k rollout status deployment/order-service     -n shop --timeout=5m
k rollout status deployment/chat-service      -n shop --timeout=5m
k rollout status deployment/metal-mart-frontend -n shop --timeout=5m

say "Waiting for the catalogue seed"
# The job waits for inventory-service to create the products table, so give it
# room; a failure here means the table never appeared.
if ! k wait --for=condition=complete job/catalogue-seed -n shop --timeout=6m; then
  echo "seed job did not complete — logs follow:" >&2
  k logs job/catalogue-seed -n shop --tail=40 >&2 || true
  die "catalogue seed failed"
fi

# --------------------------------------------------------------------------
# 4. Verify
# --------------------------------------------------------------------------
say "Verifying"
printf 'operator : '; k get deployment mirrord-operator -n mirrord \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
printf 'pg branching : '; k get deployment mirrord-operator -n mirrord \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="OPERATOR_PG_BRANCHING")].value}{"\n"}'

# That env var is set by the chart whether or not the operator can license
# itself, so on its own it proves nothing. An unlicensed operator still runs,
# and mirrord silently falls back to OSS mode: basic connectivity keeps working
# while queue splitting, traffic filtering and DB branching quietly do not.
printf 'licence : '
if k logs -n mirrord deployment/mirrord-operator --tail=200 2>/dev/null | grep -q "Failed loading license"; then
  printf '\033[1;31mNOT VALID on this cluster\033[0m\n'
  printf '  The operator cannot load its licence, so mirrord will run without it.\n'
  printf '  Acts using the storefront and the eval still work; queue splitting and\n'
  printf '  DB branching do not. A licence key is bound to its installation — one\n'
  printf '  copied from another cluster will not validate here.\n'
else
  printf 'loaded\n'
fi
printf 'products : '; k exec -n infra deployment/postgres -- \
  psql -U postgres -d inventory -tAc 'SELECT count(*) FROM products;'
printf 'price points : '; k exec -n infra deployment/postgres -- \
  psql -U postgres -d inventory -tAc 'SELECT count(DISTINCT price_cents) FROM products;'

cat <<EOF

$(printf '\033[1;32mRehearsal cluster ready.\033[0m')

  context : $CONTEXT

Show the shop (the agent answers the chat widget):

  kubectl --context $CONTEXT port-forward -n shop svc/metal-mart-frontend 3000:80
  open http://localhost:3000/shop

Run the eval against it — the cluster is named in the config, so your active
kube context does not matter:

  cd apps/shop/chat-service
  mirrord exec --config-file ../../../.mirrord/agent-evals.json -- npm run eval

Tear it down when you are done — it is billable:

  gcloud container clusters delete $CLUSTER --zone $ZONE --project $PROJECT
EOF
