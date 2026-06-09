#!/usr/bin/env bash
# Stand up the throwaway workshop cluster end-to-end. Run from workshop/.
# Idempotent-ish: safe to re-run individual sections. Review before running — it creates billable
# GCP resources. Tear down with: gcloud container clusters delete "$CLUSTER" --region "$REGION".
#
# Required env:
#   PROJECT                GCP project (separate-cluster-in-existing-project per the plan)
#   OPERATOR_LICENSE_KEY   mirrord Operator license (https://app.metalbear.co)
# Optional:
#   REGION (us-central1)  CLUSTER (workshop-cluster)  HOST (workshop.metalbear.dev)  ATTENDEES (60)
set -euo pipefail
cd "$(dirname "$0")/.."   # workshop/

: "${PROJECT:?set PROJECT}"
: "${OPERATOR_LICENSE_KEY:?set OPERATOR_LICENSE_KEY}"
REGION="${REGION:-us-central1}"
CLUSTER="${CLUSTER:-workshop-cluster}"
HOST="${HOST:-workshop.metalbear.dev}"
ATTENDEES="${ATTENDEES:-60}"
# Generated, never committed. Override by exporting ADMIN_TOKEN / BROKER_IMAGE.
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 12)}"
BROKER_IMAGE="${BROKER_IMAGE:-$REGION-docker.pkg.dev/$PROJECT/workshop/broker:latest}"

echo "▸ 1/6  Create GKE Standard cluster ($CLUSTER in $REGION)"
# Standard (NOT Autopilot): the mirrord agent needs privileged/NET_ADMIN for iptables.
# Gateway API enabled for path-based routing. Size for ~60 inventory pods + infra.
gcloud container clusters create "$CLUSTER" \
  --project "$PROJECT" --region "$REGION" \
  --release-channel regular --gateway-api=standard \
  --num-nodes 2 --machine-type e2-standard-4 \
  --no-enable-autoupgrade
gcloud container clusters get-credentials "$CLUSTER" --project "$PROJECT" --region "$REGION"

echo "▸ 2/6  Install mirrord Operator (license, no queue-splitting)"
helm repo add metalbear https://metalbear-co.github.io/charts >/dev/null 2>&1 || true
helm repo update >/dev/null
# Pin the operator chart version (validated 3.166.0) so it doesn't drift between dry-run and event.
OPERATOR_CHART_VERSION="${OPERATOR_CHART_VERSION:-3.166.0}"
helm upgrade --install mirrord-operator metalbear/mirrord-operator \
  --version "$OPERATOR_CHART_VERSION" \
  --namespace mirrord --create-namespace \
  --set license.key="$OPERATOR_LICENSE_KEY" \
  --wait

echo "▸ 3/6  Build the broker image, then deploy the workshop stack"
gcloud artifacts repositories create workshop --repository-format=docker --location="$REGION" --project "$PROJECT" 2>/dev/null || true
gcloud builds submit ./broker --tag "$BROKER_IMAGE" --project "$PROJECT"
helm upgrade --install workshop ./chart --namespace default \
  --set host="$HOST" --set attendeeCount="$ATTENDEES" \
  --set broker.image="$BROKER_IMAGE" --set broker.adminToken="$ADMIN_TOKEN" \
  --wait --timeout 10m

echo "▸ 4/6  Reserve the Gateway IP + DNS"
echo "   Point an A-record for $HOST (and a wildcard *.$HOST if you like) at the Gateway address:"
kubectl get gateway workshop-gateway -n workshop-system -o jsonpath='{.status.addresses[0].value}{"\n"}' || true
echo "   (Then wait for the ManagedCertificate to go Active — can take 15-60+ min.)"

echo "▸ 5/6  Finish TLS once the cert provisions"
CERT=$(kubectl get managedcertificate workshop-cert -n workshop-system -o jsonpath='{.status.certificateName}' 2>/dev/null || true)
if [ -n "$CERT" ]; then
  echo "   ManagedCertificate compute cert: $CERT — wiring it into the Gateway"
  helm upgrade workshop ./chart --namespace default \
    --set host="$HOST" --set attendeeCount="$ATTENDEES" \
    --set broker.image="$BROKER_IMAGE" --set broker.adminToken="$ADMIN_TOKEN" \
    --set gateway.tls.preSharedCertName="$CERT" --wait
else
  echo "   Cert not provisioned yet. Re-run this step later, or:"
  echo "     helm upgrade workshop ./chart -n default --set host=$HOST --set attendeeCount=$ATTENDEES --set gateway.tls.preSharedCertName=<mcrt-...>"
fi

echo "▸ 6/6  Generate seats + load them into the in-cluster broker"
HOST="$HOST" ATTENDEES="$ATTENDEES" ./scripts/gen-seats.sh > /tmp/workshop-seats.json
kubectl create secret generic workshop-seats -n workshop-shared \
  --from-file=seats.json=/tmp/workshop-seats.json --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deploy/broker -n workshop-shared
rm -f /tmp/workshop-seats.json
echo "   loaded ~$ATTENDEES seats into the broker"

cat <<EOF

✓ Cluster ready. Attendees just open  https://$HOST/  — that landing page has both the companion
  (fast) and manual (no-binary) paths, and claims seats via /api.
  - Admin board:      https://$HOST/api/admin?token=$ADMIN_TOKEN
  - Smoke test:       see run-of-show.md "Facilitator pre-flight"
  - Tear down after:  gcloud container clusters delete $CLUSTER --project $PROJECT --region $REGION

  (Admin token was generated for this run; it is NOT in git. Save the admin URL above.)
EOF
