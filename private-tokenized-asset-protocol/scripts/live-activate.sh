#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-7011}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${API_PORT}}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-zktls_subject}"
ZKTLS_MODE="${ZKTLS_MODE:-eligible}"
ZKTLS_REPO_PATH="${ZKTLS_REPO_PATH:-${ROOT_DIR}/external/zk-verify-poc}"
MOON_BIN="${MOON_BIN:-$HOME/.proto/shims/moon}"

API_PID=""

cleanup() {
  if [[ -n "${API_PID}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_api() {
  local attempts=30
  for ((i=1; i<=attempts; i++)); do
    if curl -s "${API_BASE_URL}/api/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

extract_json() {
  local json="$1"
  local path="$2"
  printf '%s' "${json}" | node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(0, 'utf8'));
const path = process.argv[1].split('.');
let current = data;
for (const key of path) current = current == null ? undefined : current[key];
if (current == null) process.exit(1);
if (typeof current === 'object') console.log(JSON.stringify(current));
else console.log(String(current));
" "${path}"
}

echo "[1/6] Building TAP services..."
cd "${ROOT_DIR}"
pnpm --filter @tap/attestor-service build >/dev/null
pnpm --filter @tap/api-gateway build >/dev/null

echo "[2/6] Deploy preflight (best-effort)..."
if [[ -x "${MOON_BIN}" ]] || command -v "${MOON_BIN}" >/dev/null 2>&1; then
  (cd "${ZKTLS_REPO_PATH}" && "${MOON_BIN}" run poc:deploy >/dev/null)
else
  echo "warning: moon binary not found at ${MOON_BIN}; skipping deploy preflight"
fi

echo "[3/6] Starting isolated API gateway..."
PORT="${API_PORT}" ZKTLS_REPO_PATH="${ZKTLS_REPO_PATH}" MOON_BIN="${MOON_BIN}" node apps/api-gateway/dist/server.js >/tmp/tap-api.log 2>&1 &
API_PID="$!"
wait_for_api || { echo "api-gateway failed to start"; cat /tmp/tap-api.log; exit 1; }

echo "[4/6] Running zkTLS pipeline (${ZKTLS_MODE})..."
RUN_RESP="$(curl -s -X POST "${API_BASE_URL}/api/v1/attest/zktls/run" \
  -H 'content-type: application/json' \
  -d "{\"mode\":\"${ZKTLS_MODE}\"}")"

if printf '%s' "${RUN_RESP}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.error ? 0 : 1)"; then
  echo "pipeline error:"
  echo "${RUN_RESP}"
  exit 1
fi

RUN_ID="$(extract_json "${RUN_RESP}" "artifacts.runId")"
echo "runId=${RUN_ID}"

echo "[5/6] Submitting settlement for runId=${RUN_ID}..."
SUBMIT_RESP="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/zktls/submit-latest" \
  -H 'content-type: application/json' \
  -d "{\"runId\":\"${RUN_ID}\",\"subjectCommitment\":\"${SUBJECT_COMMITMENT}\"}")"

if printf '%s' "${SUBMIT_RESP}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.error ? 0 : 1)"; then
  echo "submit error:"
  echo "${SUBMIT_RESP}"
  exit 1
fi

SETTLEMENT_ID="$(extract_json "${SUBMIT_RESP}" "settlement.settlementId")"
SUBMIT_TX_HASH="$(extract_json "${SUBMIT_RESP}" "settlement.txHash")"
echo "submitted settlementId=${SETTLEMENT_ID} txHash=${SUBMIT_TX_HASH}"

echo "[6/6] Syncing finality for runId=${RUN_ID}..."
SYNC_RESP="$(curl -s -X POST "${API_BASE_URL}/api/v1/finality/sync/zktls-latest" \
  -H 'content-type: application/json' \
  -d "{\"runId\":\"${RUN_ID}\",\"subjectCommitment\":\"${SUBJECT_COMMITMENT}\"}")"

if printf '%s' "${SYNC_RESP}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.error ? 0 : 1)"; then
  echo "sync error:"
  echo "${SYNC_RESP}"
  exit 1
fi

FINAL_STATUS="$(extract_json "${SYNC_RESP}" "updated.status")"
FINAL_ANCHORED="$(extract_json "${SYNC_RESP}" "updated.anchored")"
FINAL_TX_HASH="$(extract_json "${SYNC_RESP}" "updated.txHash")"

echo "activation complete:"
echo "  settlementId=${SETTLEMENT_ID}"
echo "  runId=${RUN_ID}"
echo "  status=${FINAL_STATUS}"
echo "  anchored=${FINAL_ANCHORED}"
echo "  txHash=${FINAL_TX_HASH}"
