#!/usr/bin/env bash
# Test B for an auth-srvc pull request. The auth jar is not deployed.
# The portal already in the cluster receives the browser, and only the login call is stolen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NS="${NAMESPACE:-ci-lab}"
KEY="${MIRRORD_SESSION:-ci$(date +%s)}"
LOGIN_PF=""
ACCOUNT_PF=""

cleanup() {
  mirrord ci stop || true
  if [[ -n "${LOGIN_PF}" ]]; then
    kill "${LOGIN_PF}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${ACCOUNT_PF}" ]]; then
    kill "${ACCOUNT_PF}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

kubectl -n "${NS}" port-forward svc/login-app 18080:8080 >/tmp/ci-lab-login-pf.log 2>&1 &
LOGIN_PF=$!
kubectl -n "${NS}" port-forward svc/account-srvc 18081:8080 >/tmp/ci-lab-account-pf.log 2>&1 &
ACCOUNT_PF=$!
for _ in $(seq 1 30); do
  nc -z 127.0.0.1 18080 && nc -z 127.0.0.1 18081 && break
  sleep 1
done
nc -z 127.0.0.1 18080
nc -z 127.0.0.1 18081

mvn -q -f "${ROOT}/auth-srvc/pom.xml" -DskipTests package
mirrord ci start --config-file "${ROOT}/.mirrord/auth-srvc.json" --key "${KEY}" -- java -jar "${ROOT}/auth-srvc/target/auth-srvc.jar"

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:8080/health" && break
  sleep 2
done
curl -sf "http://127.0.0.1:8080/health"

cd "${ROOT}/login-app"
npm ci
export ACCOUNT_URL="http://127.0.0.1:18081"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:18080"
export MIRRORD_SESSION="${KEY}"
npx playwright test
