#!/usr/bin/env bash
# Runs the real Scylla flags and copy script from scylla-branch.json on local Docker.
# Stands in for the operator: two containers play the source and the branch pod, and the
# script applies the kubelet's `$$` expansion to the copy Job's command. Needs no cluster,
# and removes its containers on exit.
set -euo pipefail
cd "$(dirname "$0")"

NET=scylla-local
DC=us-central1
KEYSPACE=metalmart
BOOT_BUDGET_SECS=120

read_config() {
  python3 -c '
import json, sys
branch = json.load(open("scylla-branch.json"))["feature"]["db_branches"][0]
field = sys.argv[1]
if field == "image":
    print(branch["image"])
elif field == "args":
    print("\n".join(arg.replace("$(MIRRORD_PARAM_DC)", sys.argv[2]) for arg in branch["args"]))
elif field == "copy":
    print(branch["copy"]["command"][2].replace("$$", "$"), end="")
' "$@"
}

IMAGE=$(read_config image)
ARGS=()
while IFS= read -r arg; do ARGS+=("$arg"); done < <(read_config args "$DC")
COPY_SCRIPT=$(read_config copy)

cleanup() {
  docker rm -f scylla-source scylla-branch >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

start_scylla() {
  docker run -d --name "$1" --network "$NET" --memory 2g "$IMAGE" "${ARGS[@]}" >/dev/null
}

wait_for_cql() {
  local started=$SECONDS
  until docker exec "$1" cqlsh -e 'SELECT release_version FROM system.local' >/dev/null 2>&1; do
    if (( SECONDS - started > BOOT_BUDGET_SECS )); then
      echo "FAIL: $1 not ready in ${BOOT_BUDGET_SECS}s"
      docker logs --tail 40 "$1"
      exit 1
    fi
    sleep 2
  done
  echo "$1 ready in $(( SECONDS - started ))s (operator probe budget is about ${BOOT_BUDGET_SECS}s)"
}

count_products() {
  docker exec "$1" cqlsh -e "SELECT count(*) FROM $KEYSPACE.products" |
    sed -n '/^---/,/^$/p' | sed -e '/^---/d' -e '/^$/d' -e 's/ //g'
}

echo "== Boot source and branch with the config's args: ${ARGS[*]}"
start_scylla scylla-source
start_scylla scylla-branch
wait_for_cql scylla-source
wait_for_cql scylla-branch

echo "== Seed the source"
sed -n "/<<'CQL'/,/^ *CQL$/p" ../../manifests/scylla-demo/scylla-demo.yaml | sed -e '1d' -e '$d' -e 's/^ *//' |
  docker exec -i scylla-source sh -c 'cat > /tmp/seed.cql && cqlsh -f /tmp/seed.cql'
echo "source products: $(count_products scylla-source)"

echo "== Run the copy script from the config"
BRANCH_IP=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" scylla-branch)
docker run --rm --network "$NET" --entrypoint sh \
  -e MIRRORD_PARAM_HOST=scylla-source \
  -e MIRRORD_PARAM_PORT=9042 \
  -e MIRRORD_PARAM_KEYSPACE="$KEYSPACE" \
  -e MIRRORD_PARAM_DC="$DC" \
  -e MIRRORD_BRANCH_HOST="$BRANCH_IP" \
  -e MIRRORD_BRANCH_PORT=9042 \
  "$IMAGE" -c "$COPY_SCRIPT"

copied=$(count_products scylla-branch)
echo "branch products after copy: $copied"
[[ "$copied" == "4" ]] || { echo "FAIL: expected 4 products on the branch"; exit 1; }
docker exec scylla-branch cqlsh -e "DESCRIBE KEYSPACE $KEYSPACE" | grep 'CREATE KEYSPACE'

echo "== Run demo.mjs against the branch with a DC-aware driver"
docker run --rm --network "$NET" -v "$PWD:/src:ro" \
  -e SCYLLA_HOST="$BRANCH_IP" \
  -e SCYLLA_PORT=9042 \
  -e SCYLLA_KEYSPACE="$KEYSPACE" \
  -e SCYLLA_DC="$DC" \
  node:22-alpine sh -ec '
    mkdir /tmp/app && cd /tmp/app
    cp /src/package.json /src/demo.mjs .
    npm install --silent --no-audit --no-fund
    node demo.mjs list
    node demo.mjs add
    node demo.mjs wipe
  '

after_branch=$(count_products scylla-branch)
after_source=$(count_products scylla-source)
echo "branch products after wipe: $after_branch"
echo "source products after wipe: $after_source"
[[ "$after_branch" == "0" && "$after_source" == "4" ]] || { echo "FAIL: isolation check"; exit 1; }

echo "PASS"
