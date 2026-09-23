#!/usr/bin/env bash
# Test B for a login-app pull request. The Node server is not deployed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NS="${NAMESPACE:-ci-lab}"
PF_PID=""

cleanup() {
  mirrord ci stop || true
  if [[ -n "${PF_PID}" ]]; then
    kill "${PF_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

kubectl -n "${NS}" port-forward svc/account-srvc 18081:8080 >/tmp/ci-lab-account-pf.log 2>&1 &
PF_PID=$!
for _ in $(seq 1 30); do
  nc -z 127.0.0.1 18081 && break
  sleep 1
done
nc -z 127.0.0.1 18081

cd "${ROOT}/login-app"
npm ci
npm run build
mirrord ci start --config-file "${ROOT}/.mirrord/login-app.json" -- node "${ROOT}/login-app/server.js"

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:8080/health" && break
  sleep 2
done
curl -sf "http://127.0.0.1:8080/health"

export ACCOUNT_URL="http://127.0.0.1:18081"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:8080"
unset MIRRORD_SESSION || true
npx playwright test
