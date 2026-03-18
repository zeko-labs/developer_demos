#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7012}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
PROOF_MODE="${PROOF_MODE:-zk}"
API_LOG="${API_LOG:-/tmp/tap-api-stock-lifecycle.log}"

ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
MAKER_API_KEY="${MAKER_API_KEY:-maker_key}"
CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}"
CHECKER2_API_KEY="${CHECKER2_API_KEY:-checker2_key}"

if [[ -z "${TAP_API_KEYS_JSON:-}" ]]; then
  TAP_API_KEYS_JSON='{"admin_key":{"role":"CONSORTIUM_ADMIN"},"tenant_a_key":{"role":"TENANT_OPERATOR","tenantId":"tenant-a"},"maker_key":{"role":"ISSUER_MAKER","tenantId":"tenant-a"},"checker_key":{"role":"ISSUER_CHECKER","tenantId":"tenant-a"},"checker2_key":{"role":"ISSUER_CHECKER","tenantId":"tenant-a"}}'
fi

cleanup() {
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
pnpm --filter @tap/circuits build >/dev/null
pnpm --filter @tap/o1js-verifier build >/dev/null
pnpm --filter @tap/api-gateway build >/dev/null

echo "[2/6] Starting isolated API (${API_BASE_URL})..."
PORT="${PORT}" \
PROOF_MODE="${PROOF_MODE}" \
ZK_PROVER_BACKEND="${ZK_PROVER_BACKEND:-o1js}" \
ZK_O1JS_PROVE_CMD="${ZK_O1JS_PROVE_CMD:-node ${ROOT_DIR}/packages/circuits/dist/prove-cli.js}" \
ZK_O1JS_VERIFY_CMD="${ZK_O1JS_VERIFY_CMD:-node ${ROOT_DIR}/packages/o1js-verifier/dist/cli.js}" \
ZK_O1JS_VERIFIER_MODE="${ZK_O1JS_VERIFIER_MODE:-o1js-runtime}" \
ZK_O1JS_MODULE="${ZK_O1JS_MODULE:-o1js}" \
TAP_API_KEYS_JSON="${TAP_API_KEYS_JSON}" \
pnpm --filter @tap/api-gateway start >"${API_LOG}" 2>&1 &
API_PID=$!

echo "[3/6] Waiting for health check..."
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
  echo "log: ${API_LOG}"
  tail -n 120 "${API_LOG}" || true
  exit 1
fi

echo "[4/6] Running stock lifecycle transcript..."
API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
MAKER_API_KEY="${MAKER_API_KEY}" \
CHECKER_API_KEY="${CHECKER_API_KEY}" \
CHECKER2_API_KEY="${CHECKER2_API_KEY}" \
RESET_LOCAL_STATE=1 \
REDACT_PUBLIC_COPY=1 \
./scripts/generate_stock_lifecycle_transcript.sh

LATEST_TRANSCRIPT="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'stock-lifecycle-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
LATEST_PUBLIC="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'stock-lifecycle-demo-*.public.md' | sort | tail -n 1)"

echo "[5/6] Verifying transcript..."
./scripts/verify_transcript.sh "${LATEST_TRANSCRIPT}"

echo "[6/6] Complete."
echo "api log: ${API_LOG}"
echo "api base url: ${API_BASE_URL}"
echo "transcript: ${LATEST_TRANSCRIPT}"
echo "public transcript: ${LATEST_PUBLIC}"
