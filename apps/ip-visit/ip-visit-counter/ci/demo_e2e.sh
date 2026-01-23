#!/usr/bin/env bash
set -euo pipefail

: "${PLAYGROUND_URL:?Need PLAYGROUND_URL (e.g. http://localhost:30080 or https://playground.metalbear.dev)}"
: "${DEMO_TENANT:?Need DEMO_TENANT (e.g. mirrord-ci-demo)}"

echo "Hitting ${PLAYGROUND_URL}/count with tenant=${DEMO_TENANT}"

resp="$(curl -sS -H "X-PG-Tenant: ${DEMO_TENANT}" "${PLAYGROUND_URL}/count")"
echo "$resp" | jq .

# Assert: demo_marker exists and equals "mirrord-ci-demo"
echo "$resp" | jq -e '.demo_marker == "mirrord-ci-demo"' >/dev/null || {
	echo "❌ ERROR: demo_marker missing or incorrect"
	exit 1
}

echo "✅ demo_e2e passed"
