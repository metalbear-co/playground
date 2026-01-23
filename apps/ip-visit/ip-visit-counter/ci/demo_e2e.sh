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

# Assert: total_requests exists and is a number
echo "$resp" | jq -e '.total_requests | type == "number"' >/dev/null || {
	echo "❌ ERROR: total_requests field missing or not a number"
	exit 1
}

# Assert: total_requests equals count + unique_ips
count=$(echo "$resp" | jq -r '.count')
unique_ips=$(echo "$resp" | jq -r '.unique_ips')
total_requests=$(echo "$resp" | jq -r '.total_requests')
expected_total=$((count + unique_ips))
if [ "$total_requests" -ne "$expected_total" ]; then
	echo "❌ ERROR: total_requests ($total_requests) does not equal count + unique_ips ($expected_total)"
	exit 1
fi

echo "✅ demo_e2e passed"
