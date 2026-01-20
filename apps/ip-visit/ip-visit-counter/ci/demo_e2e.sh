#!/usr/bin/env bash
set -euo pipefail

: "${PLAYGROUND_URL:?Need PLAYGROUND_URL (e.g. http://localhost:30080 or https://playground.metalbear.dev)}"
: "${DEMO_TENANT:?Need DEMO_TENANT (e.g. mirrord-ci-demo)}"

echo "Hitting ${PLAYGROUND_URL}/count with tenant=${DEMO_TENANT}"

resp="$(curl -sS -H "X-PG-Tenant: ${DEMO_TENANT}" "${PLAYGROUND_URL}/count")"
echo "$resp" | jq .

# Assert: unique_ips exists and is a number
echo "$resp" | jq -e '.unique_ips | type == "number"' >/dev/null || {
	echo "❌ ERROR: unique_ips field missing or not a number"
	exit 1
}

# Assert: demo_marker exists and equals "mirrord-ci-demo"
echo "$resp" | jq -e '.demo_marker == "mirrord-ci-demo"' >/dev/null || {
	echo "❌ ERROR: demo_marker missing or incorrect"
	exit 1
}

echo "✅ demo_e2e passed"
