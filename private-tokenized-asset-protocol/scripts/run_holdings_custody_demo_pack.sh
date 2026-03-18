#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7015}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
PROOF_MODE="${PROOF_MODE:-zk}"
API_LOG="${API_LOG:-/tmp/tap-api-holdings-custody.log}"
CUSTODY_MOCK_PORT="${CUSTODY_MOCK_PORT:-4512}"
CUSTODY_MOCK_BASE_URL="${CUSTODY_MOCK_BASE_URL:-http://127.0.0.1:${CUSTODY_MOCK_PORT}}"
CUSTODY_MOCK_LOG="${CUSTODY_MOCK_LOG:-/tmp/tap-custody-mock.log}"

ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"

CUSTODY_API_KEY="${CUSTODY_API_KEY:-custody_mock_api_key}"
CUSTODY_WEBHOOK_SECRET="${CUSTODY_WEBHOOK_SECRET:-custody_mock_webhook_secret}"

if [[ -z "${TAP_API_KEYS_JSON:-}" ]]; then
  TAP_API_KEYS_JSON='{"admin_key":{"role":"CONSORTIUM_ADMIN"},"tenant_a_key":{"role":"TENANT_OPERATOR","tenantId":"tenant-a"}}'
fi

cleanup() {
  if [[ -n "${CUSTODY_MOCK_PID:-}" ]]; then
    kill "${CUSTODY_MOCK_PID}" >/dev/null 2>&1 || true
    wait "${CUSTODY_MOCK_PID}" 2>/dev/null || true
  fi
  if [[ -n "${API_PID:-}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"

echo "[1/6] Building required packages..."
pnpm --filter @tap/shared-types build >/dev/null
pnpm --filter @tap/compliance-engine build >/dev/null
pnpm --filter @tap/api-gateway build >/dev/null

echo "[2/6] Starting custody mock (${CUSTODY_MOCK_BASE_URL})..."
CUSTODY_MOCK_PORT="${CUSTODY_MOCK_PORT}" \
node "${ROOT_DIR}/scripts/custody_mock_server.mjs" >"${CUSTODY_MOCK_LOG}" 2>&1 &
CUSTODY_MOCK_PID=$!

MOCK_READY=0
for _ in $(seq 1 15); do
  if curl -fsS "${CUSTODY_MOCK_BASE_URL}/health" >/dev/null 2>&1; then
    MOCK_READY=1
    break
  fi
  sleep 1
done
if [[ "${MOCK_READY}" != "1" ]]; then
  echo "error: custody mock did not become ready at ${CUSTODY_MOCK_BASE_URL}"
  tail -n 120 "${CUSTODY_MOCK_LOG}" || true
  exit 1
fi

echo "[3/6] Starting isolated API (${API_BASE_URL})..."
PORT="${PORT}" \
PROOF_MODE="${PROOF_MODE}" \
TAP_API_KEYS_JSON="${TAP_API_KEYS_JSON}" \
CUSTODY_API_KEY="${CUSTODY_API_KEY}" \
CUSTODY_WEBHOOK_SECRET="${CUSTODY_WEBHOOK_SECRET}" \
CUSTODY_BASE_URL="${CUSTODY_MOCK_BASE_URL}" \
pnpm --filter @tap/api-gateway start >"${API_LOG}" 2>&1 &
API_PID=$!

echo "[4/6] Waiting for health check..."
READY=0
for _ in $(seq 1 30); do
  if curl -fsS "${API_BASE_URL}/api/v1/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "${READY}" != "1" ]]; then
  echo "error: API did not become ready at ${API_BASE_URL}"
  tail -n 120 "${API_LOG}" || true
  exit 1
fi

echo "[5/6] Running holdings custody transcript..."
API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_API_KEY="${TENANT_API_KEY}" \
CUSTODY_API_KEY="${CUSTODY_API_KEY}" \
CUSTODY_WEBHOOK_SECRET="${CUSTODY_WEBHOOK_SECRET}" \
CUSTODY_BASE_URL="${CUSTODY_MOCK_BASE_URL}" \
CUSTODY_ALLOWED_HOST="127.0.0.1" \
RESET_LOCAL_STATE=1 \
REDACT_PUBLIC_COPY=1 \
./scripts/generate_holdings_custody_transcript.sh

LATEST_TRANSCRIPT="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'holdings-custody-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"

echo "[6/6] Verifying transcript..."
./scripts/verify_transcript.sh "${LATEST_TRANSCRIPT}"

echo "[done] Complete."
echo "api log: ${API_LOG}"
echo "custody mock log: ${CUSTODY_MOCK_LOG}"
echo "api base url: ${API_BASE_URL}"
echo "transcript: ${LATEST_TRANSCRIPT}"
