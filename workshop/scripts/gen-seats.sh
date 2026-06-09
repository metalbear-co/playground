#!/usr/bin/env bash
# Generate the broker's seats.json from a DEPLOYED workshop cluster.
#
# For each ws-aNN namespace it reads the namespace-scoped `attendee-token` Secret (created by the
# Helm chart) plus the cluster CA/endpoint, and emits a kubeconfig whose ONLY credential is that
# ServiceAccount token — no GCP IAM, so the handout can't reach anything but its own namespace
# (+ the finale namespace, per RBAC).
#
#   HOST=workshop.metalbear.dev ATTENDEES=60 ./gen-seats.sh > ../broker/seats.json
#
# Requires: kubectl (pointed at the workshop cluster, admin context), jq, openssl.
set -euo pipefail

HOST="${HOST:-workshop.metalbear.dev}"
ATTENDEES="${ATTENDEES:-60}"
PREFIX="${PREFIX:-a}"

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

SERVER=$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')
[ -n "$SERVER" ] || { echo "could not read cluster server from current kube context" >&2; exit 1; }

emit_one() {
  local nn="$1" ns="$2" ca token kubeconfig
  # The token controller populates the Secret asynchronously — wait for it.
  for _ in $(seq 1 30); do
    token=$(kubectl get secret attendee-token -n "$ns" -o jsonpath='{.data.token}' 2>/dev/null || true)
    [ -n "$token" ] && break
    sleep 1
  done
  [ -n "$token" ] || { echo "timed out waiting for attendee-token in $ns" >&2; exit 1; }
  ca=$(kubectl get secret attendee-token -n "$ns" -o jsonpath='{.data.ca\.crt}')
  token=$(printf '%s' "$token" | openssl base64 -d -A)

  kubeconfig=$(cat <<EOF
apiVersion: v1
kind: Config
clusters:
- name: workshop
  cluster:
    server: $SERVER
    certificate-authority-data: $ca
contexts:
- name: $nn
  context:
    cluster: workshop
    user: $nn
    namespace: $ns
current-context: $nn
users:
- name: $nn
  user:
    token: $token
EOF
)
  jq -n --arg id "$nn" --arg ns "$ns" --arg url "https://$HOST/$nn/" --arg kc "$kubeconfig" \
    '{id:$id, namespace:$ns, url:$url, kubeconfig:$kc}'
}

{
  for i in $(seq 1 "$ATTENDEES"); do
    nn=$(printf "%s%02d" "$PREFIX" "$i")
    emit_one "$nn" "ws-$nn"
  done
} | jq -s '.'
