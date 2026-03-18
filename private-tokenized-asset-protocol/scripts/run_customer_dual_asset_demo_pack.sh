#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7016}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
PROOF_MODE="${PROOF_MODE:-zk}"
API_LOG="${API_LOG:-/tmp/tap-api-customer-dual-asset.log}"
CUSTOMER_MOCK_PORT="${CUSTOMER_MOCK_PORT:-4516}"
CUSTOMER_MOCK_BASE_URL="${CUSTOMER_MOCK_BASE_URL:-http://127.0.0.1:${CUSTOMER_MOCK_PORT}}"
CUSTOMER_MOCK_LOG="${CUSTOMER_MOCK_LOG:-/tmp/tap-customer-dual-asset-mock.log}"

ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"

if [[ -z "${TAP_API_KEYS_JSON:-}" ]]; then
  TAP_API_KEYS_JSON='{"admin_key":{"role":"CONSORTIUM_ADMIN"},"tenant_a_key":{"role":"TENANT_OPERATOR","tenantId":"tenant-a"}}'
fi

cleanup() {
  if [[ -n "${CUSTOMER_MOCK_PID:-}" ]]; then
    kill "${CUSTOMER_MOCK_PID}" >/dev/null 2>&1 || true
    wait "${CUSTOMER_MOCK_PID}" 2>/dev/null || true
  fi
  if [[ -n "${API_PID:-}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"

echo "[1/7] Building required packages..."
pnpm --filter @tap/shared-types build >/dev/null
pnpm --filter @tap/compliance-engine build >/dev/null
pnpm --filter @tap/circuits build >/dev/null
pnpm --filter @tap/o1js-verifier build >/dev/null
pnpm --filter @tap/api-gateway build >/dev/null

echo "[2/7] Starting customer mock sandbox (${CUSTOMER_MOCK_BASE_URL})..."
CUSTOMER_DUAL_ASSET_MOCK_PORT="${CUSTOMER_MOCK_PORT}" \
node "${ROOT_DIR}/scripts/customer_dual_asset_mock_server.mjs" >"${CUSTOMER_MOCK_LOG}" 2>&1 &
CUSTOMER_MOCK_PID=$!

MOCK_READY=0
for _ in $(seq 1 15); do
  if curl -fsS "${CUSTOMER_MOCK_BASE_URL}/health" >/dev/null 2>&1; then
    MOCK_READY=1
    break
  fi
  sleep 1
done
if [[ "${MOCK_READY}" != "1" ]]; then
  echo "error: customer mock did not become ready at ${CUSTOMER_MOCK_BASE_URL}"
  tail -n 120 "${CUSTOMER_MOCK_LOG}" || true
  exit 1
fi

echo "[3/7] Starting isolated API (${API_BASE_URL})..."
PORT="${PORT}" \
PROOF_MODE="${PROOF_MODE}" \
ZK_PROVER_BACKEND="${ZK_PROVER_BACKEND:-o1js}" \
ZK_O1JS_PROVE_CMD="${ZK_O1JS_PROVE_CMD:-node ${ROOT_DIR}/packages/circuits/dist/prove-cli.js}" \
ZK_O1JS_VERIFY_CMD="${ZK_O1JS_VERIFY_CMD:-node ${ROOT_DIR}/packages/o1js-verifier/dist/cli.js}" \
ZK_O1JS_VERIFIER_MODE="${ZK_O1JS_VERIFIER_MODE:-o1js-runtime}" \
ZK_O1JS_MODULE="${ZK_O1JS_MODULE:-o1js}" \
TAP_API_KEYS_JSON="${TAP_API_KEYS_JSON}" \
CUSTOMER_BALANCE_CLIENT_ID="${CUSTOMER_BALANCE_CLIENT_ID:-customer_balance_client_id}" \
CUSTOMER_BALANCE_CLIENT_SECRET="${CUSTOMER_BALANCE_CLIENT_SECRET:-customer_balance_client_secret}" \
CUSTOMER_KYC_API_KEY="${CUSTOMER_KYC_API_KEY:-customer_kyc_api_key}" \
CUSTOMER_HOLDINGS_CLIENT_ID="${CUSTOMER_HOLDINGS_CLIENT_ID:-customer_holdings_client_id}" \
CUSTOMER_HOLDINGS_CLIENT_SECRET="${CUSTOMER_HOLDINGS_CLIENT_SECRET:-customer_holdings_client_secret}" \
pnpm --filter @tap/api-gateway start >"${API_LOG}" 2>&1 &
API_PID=$!

echo "[4/7] Waiting for health check..."
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

echo "[5/7] Bootstrapping customer dual-asset policies..."
API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
./scripts/bootstrap_customer_dual_asset_policies.sh >/dev/null

echo "[6/7] Running customer dual-asset transcript..."
API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_API_KEY="${TENANT_API_KEY}" \
ALLOWED_HOSTS_CSV="127.0.0.1" \
TOKEN_URL="${CUSTOMER_MOCK_BASE_URL}/oauth/token" \
BALANCE_URL="${CUSTOMER_MOCK_BASE_URL}/v1/accounts/acct_demo_001/balance" \
KYC_URL="${CUSTOMER_MOCK_BASE_URL}/v1/customers/cust_demo_001/kyc-status" \
HOLDINGS_URL="${CUSTOMER_MOCK_BASE_URL}/v1/accounts/acct_eq_001/positions/sec_fund_a" \
RESET_LOCAL_STATE=1 \
REDACT_PUBLIC_COPY=1 \
./scripts/generate_customer_dual_asset_transcript.sh

LATEST_TRANSCRIPT="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'customer-dual-asset-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
LATEST_PUBLIC="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'customer-dual-asset-demo-*.public.md' | sort | tail -n 1)"

echo "[7/7] Verifying transcript..."
./scripts/verify_transcript.sh "${LATEST_TRANSCRIPT}"

echo "api log: ${API_LOG}"
echo "customer mock log: ${CUSTOMER_MOCK_LOG}"
echo "api base url: ${API_BASE_URL}"
echo "transcript: ${LATEST_TRANSCRIPT}"
echo "public transcript: ${LATEST_PUBLIC}"
