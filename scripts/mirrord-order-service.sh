#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/.mirrord/mirrord-order-service.json"
PID_FILE="${ROOT_DIR}/.mirrord/.mirrord-order-service.pid"
NAMESPACE="shop"
TARGET_TYPE="deployment"
TARGET_NAME="order-service"
LOG_FILE="${ROOT_DIR}/.mirrord/.mirrord-order-service.log"

usage() {
  cat <<'EOF'
Usage:
  scripts/mirrord-order-service.sh [--background] -- <local command...>
  scripts/mirrord-order-service.sh --stop

Examples:
  scripts/mirrord-order-service.sh -- npm run dev
  scripts/mirrord-order-service.sh --background -- npm run dev
  scripts/mirrord-order-service.sh --stop
EOF
}

check_requirements() {
  if ! command -v mirrord >/dev/null 2>&1; then
    echo "Error: mirrord is not installed or not in PATH." >&2
    exit 1
  fi

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "Error: kubectl is not installed or not in PATH." >&2
    exit 1
  fi

  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Error: config file not found at ${CONFIG_FILE}." >&2
    exit 1
  fi

  if ! kubectl config current-context >/dev/null 2>&1; then
    echo "Error: kubectl current context is unavailable." >&2
    exit 1
  fi

  if ! kubectl -n "${NAMESPACE}" get "${TARGET_TYPE}" "${TARGET_NAME}" >/dev/null 2>&1; then
    echo "Error: ${TARGET_TYPE}/${TARGET_NAME} not found in namespace ${NAMESPACE}." >&2
    exit 1
  fi
}

stop_session() {
  if [[ -f "${PID_FILE}" ]]; then
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" >/dev/null 2>&1 || true
      rm -f "${PID_FILE}"
      echo "Stopped mirrord session (pid ${pid})."
      return 0
    fi
    rm -f "${PID_FILE}"
  fi

  pids="$(pgrep -f "mirrord.+mirrord-order-service\\.json" || true)"
  if [[ -n "${pids}" ]]; then
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] && kill "${pid}" >/dev/null 2>&1 || true
    done <<< "${pids}"
    echo "Stopped matching mirrord process(es)."
    return 0
  fi

  echo "No running mirrord session found for order-service."
}

background=false
stop=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --background)
      background=true
      shift
      ;;
    --stop)
      stop=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Error: unknown option '$1'." >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${stop}" == "true" ]]; then
  stop_session
  exit 0
fi

if [[ $# -eq 0 ]]; then
  echo "Error: missing local command to run with mirrord." >&2
  usage
  exit 1
fi

check_requirements

if [[ "${background}" == "true" ]]; then
  mkdir -p "$(dirname "${LOG_FILE}")"
  mirrord exec -f "${CONFIG_FILE}" -- "$@" >>"${LOG_FILE}" 2>&1 &
  echo "$!" > "${PID_FILE}"
  echo "Started mirrord session in background (pid $!)."
  echo "Log file: ${LOG_FILE}"
  exit 0
fi

exec mirrord exec -f "${CONFIG_FILE}" -- "$@"
