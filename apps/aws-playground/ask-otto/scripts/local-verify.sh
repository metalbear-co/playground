#!/usr/bin/env bash
# Checks the local stand-in for the AWS layout: ALB -> ECS task -> private RDS, with the laptop locked out.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/local/compose.yaml")
ALB="http://127.0.0.1:8000"
QUESTION='{"question": "How do I return a sleeping bag?"}'

failures=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; failures=$((failures + 1)); }

published_ports() {
  "${COMPOSE[@]}" ps --format json "$1" 2>/dev/null | jq -rs '[.[].Publishers[]? | select(.PublishedPort != 0) | .PublishedPort] | join(",")'
}

can_connect() {
  python3 -c 'import socket, sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=3).close()' "$1" "$2" >/dev/null 2>&1
}

echo "ALB (127.0.0.1:8000)"
health="$(curl -fsS "$ALB/healthz" 2>/dev/null)"
if [ "$(jq -r '.served_by' <<<"$health" 2>/dev/null)" = "ecs" ]; then
  ok "GET /healthz answered by the ECS task stand-in"
else
  fail "GET /healthz did not answer with served_by=ecs" "Is the stack up? Run: make local-up"
fi

answer="$(curl -fsS "$ALB/ask" -H 'Content-Type: application/json' -d "$QUESTION" 2>/dev/null)"
topic="$(jq -r '.topic' <<<"$answer" 2>/dev/null)"
guide_product="$(jq -r '.guide_product' <<<"$answer" 2>/dev/null)"
echo "        POST /ask \"How do I return a sleeping bag?\""
echo "        -> $(jq -r '.answer' <<<"$answer" 2>/dev/null | cut -c1-90)..."
if [ "$topic" = "warranty" ] && [ "$guide_product" = "hiking boots" ]; then
  ok "shipped bug reproduced: the sleeping bag return question gets the hiking boots warranty"
elif [ "$topic" = "returns" ] && [ "$guide_product" = "sleeping bag" ]; then
  ok "fix is live: the sleeping bag return question gets the sleeping bag returns guide"
else
  fail "unexpected /ask answer: topic=$topic guide_product=$guide_product"
fi

task_id="$("${COMPOSE[@]}" ps -q ask-otto 2>/dev/null)"
task_ip="$(docker inspect -f '{{with index .NetworkSettings.Networks "ask-otto-local_vpc-private"}}{{.IPAddress}}{{end}}' "$task_id" 2>/dev/null)"
client_addr="$(curl -fsS "$ALB/debug/db" 2>/dev/null | jq -r '.db_client_addr' 2>/dev/null)"
if [ -n "$task_ip" ] && [ "$client_addr" = "$task_ip" ]; then
  ok "RDS sees the ECS task's private IP ($client_addr)"
else
  fail "RDS client address '$client_addr' is not the task's private IP '$task_ip'"
fi

echo "Laptop is locked out of the private network"
rds_published="$(published_ports rds)"
if [ -z "$rds_published" ]; then
  ok "RDS publishes no port to the laptop"
else
  fail "RDS publishes port(s) $rds_published to the laptop"
fi

if python3 -c 'import socket, sys; socket.gethostbyname("rds")' >/dev/null 2>&1; then
  fail "the name 'rds' resolves on the laptop"
else
  ok "the name 'rds' does not resolve on the laptop"
fi

rds_id="$("${COMPOSE[@]}" ps -q rds 2>/dev/null)"
rds_ip="$(docker inspect -f '{{with index .NetworkSettings.Networks "ask-otto-local_vpc-private"}}{{.IPAddress}}{{end}}' "$rds_id" 2>/dev/null)"
if [ -n "$rds_ip" ] && can_connect "$rds_ip" 5432; then
  fail "the laptop can connect to RDS at $rds_ip:5432"
else
  ok "the laptop cannot connect to RDS at ${rds_ip:-?}:5432 (timed out)"
fi

task_published="$(published_ports ask-otto)"
if [ -z "$task_published" ]; then
  ok "the ECS task publishes no port; only the ALB is reachable"
else
  fail "the ECS task publishes port(s) $task_published to the laptop"
fi

echo "Request logs (CloudWatch stand-in)"
asks="$("${COMPOSE[@]}" logs --no-color ask-otto 2>/dev/null | grep -c 'path=/ask ' || true)"
if [ "${asks:-0}" -ge 1 ]; then
  ok "ECS task logged $asks /ask request(s)"
else
  fail "no /ask lines in the ECS task logs"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "Local stack matches the AWS layout."
else
  echo "$failures check(s) failed."
  exit 1
fi
