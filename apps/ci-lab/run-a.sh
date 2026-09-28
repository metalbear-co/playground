#!/usr/bin/env bash
# Test A. Starts the pull-request account-srvc jar. Does not deploy it.
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

kubectl -n "${NS}" port-forward svc/postgres 15432:5432 >/tmp/ci-lab-postgres-pf.log 2>&1 &
PF_PID=$!
for _ in $(seq 1 30); do
  nc -z 127.0.0.1 15432 && break
  sleep 1
done
nc -z 127.0.0.1 15432

mvn -q -f "${ROOT}/account-srvc/pom.xml" -DskipTests package
mirrord ci start --config-file "${ROOT}/.mirrord/account-srvc.json" -- java -jar "${ROOT}/account-srvc/target/account-srvc.jar"

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:8080/health" && break
  sleep 2
done
curl -sf "http://127.0.0.1:8080/health"

export ACCOUNT_URL="http://127.0.0.1:8080"
export TEST_DATABASE_URL="jdbc:postgresql://127.0.0.1:15432/accounts?user=account&password=account"
mvn -f "${ROOT}/account-srvc/pom.xml" -Dtest=FetchAccountTest test
