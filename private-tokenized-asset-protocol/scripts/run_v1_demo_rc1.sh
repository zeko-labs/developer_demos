#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7011}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
PROOF_MODE="${PROOF_MODE:-zk}"
API_LOG="${API_LOG:-/tmp/tap-api-v1-demo-rc1.log}"

ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
MAKER_API_KEY="${MAKER_API_KEY:-maker_key}"
CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}"
CHECKER2_API_KEY="${CHECKER2_API_KEY:-checker2_key}"

PLAID_CLIENT_ID="${PLAID_CLIENT_ID:-}"
PLAID_SECRET="${PLAID_SECRET:-}"
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN:-}"

if [[ -z "${PLAID_CLIENT_ID}" ]]; then
  echo "error: PLAID_CLIENT_ID is required"
  exit 1
fi
if [[ -z "${PLAID_SECRET}" ]]; then
  echo "error: PLAID_SECRET is required"
  exit 1
fi
if [[ -z "${PLAID_ACCESS_TOKEN}" ]]; then
  echo "error: PLAID_ACCESS_TOKEN is required"
  exit 1
fi

if [[ -z "${TAP_API_KEYS_JSON:-}" ]]; then
  TAP_API_KEYS_JSON='{"admin_key":{"role":"CONSORTIUM_ADMIN"},"tenant_a_key":{"role":"ISSUER","tenantId":"tenant-a"},"maker_key":{"role":"ISSUER_MAKER","tenantId":"tenant-a"},"checker_key":{"role":"ISSUER_CHECKER","tenantId":"tenant-a"},"checker2_key":{"role":"ISSUER_CHECKER","tenantId":"tenant-a"}}'
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"

echo "[1/8] Running static preflight checks..."
API_BASE_URL="${API_BASE_URL}" \
PROOF_MODE_EXPECTED="${PROOF_MODE}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_API_KEY="${TENANT_API_KEY}" \
PLAID_CLIENT_ID="${PLAID_CLIENT_ID}" \
PLAID_SECRET="${PLAID_SECRET}" \
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN}" \
TAP_API_KEYS_JSON="${TAP_API_KEYS_JSON}" \
RUN_RUNTIME=0 \
./scripts/preflight_v1_demo.sh

echo "[2/8] Building API gateway..."
pnpm --filter @tap/api-gateway build >/dev/null

echo "[3/8] Starting API gateway (${API_BASE_URL}, PROOF_MODE=${PROOF_MODE})..."
PORT="${PORT}" \
PROOF_MODE="${PROOF_MODE}" \
TAP_API_KEYS_JSON="${TAP_API_KEYS_JSON}" \
PLAID_CLIENT_ID="${PLAID_CLIENT_ID}" \
PLAID_SECRET="${PLAID_SECRET}" \
pnpm --filter @tap/api-gateway start >"${API_LOG}" 2>&1 &
API_PID=$!

echo "[4/8] Waiting for health check..."
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

echo "[5/8] Running runtime preflight checks..."
API_BASE_URL="${API_BASE_URL}" \
PROOF_MODE_EXPECTED="${PROOF_MODE}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_API_KEY="${TENANT_API_KEY}" \
TENANT_ID="tenant-a" \
POLICY_ID="1" \
PLAID_CLIENT_ID="${PLAID_CLIENT_ID}" \
PLAID_SECRET="${PLAID_SECRET}" \
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN}" \
TAP_API_KEYS_JSON="${TAP_API_KEYS_JSON}" \
RUN_RUNTIME=1 \
./scripts/preflight_v1_demo.sh

echo "[6/8] Running enterprise demo pack + release audit bundle..."
API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_API_KEY="${TENANT_API_KEY}" \
MAKER_API_KEY="${MAKER_API_KEY}" \
CHECKER_API_KEY="${CHECKER_API_KEY}" \
CHECKER2_API_KEY="${CHECKER2_API_KEY}" \
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN}" \
BUILD_RELEASE_AUDIT_BUNDLE=1 \
./scripts/run_enterprise_demo_pack.sh

LATEST_BUNDLE="$(find "${ROOT_DIR}/output/release-bundles" -maxdepth 1 -type d -name 'release-audit-*' | sort | tail -n 1)"
if [[ -z "${LATEST_BUNDLE}" ]]; then
  echo "error: no release bundle found"
  exit 1
fi

echo "[7/8] Verifying latest release bundle..."
./scripts/release_bundle_verify.sh "${LATEST_BUNDLE}"

LATEST_TGZ="$(find "${ROOT_DIR}/output/release-bundles" -maxdepth 1 -type f -name 'release-audit-*.tar.gz' | sort | tail -n 1)"
LATEST_FLAGSHIP_PUBLIC="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'dual-asset-flagship-demo-*.public.md' | sort | tail -n 1)"
LATEST_POLICY="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'policy-linkage-demo-*.md' | sort | tail -n 1)"
LATEST_MC_PUBLIC="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'maker-checker-demo-*.public.md' | sort | tail -n 1)"
LATEST_PLAID_PUBLIC="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'plaid-balance-demo-*.public.md' | sort | tail -n 1)"
LATEST_ZKTLS="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'zktls-source-collect-demo-*.md' | sort | tail -n 1)"
LATEST_ZK_RUNTIME="$(find "${ROOT_DIR}/output/demo-transcripts" -maxdepth 1 -type f -name 'zk-o1js-runtime-demo-*.md' | sort | tail -n 1)"

echo "[8/8] Complete."
echo "api log: ${API_LOG}"
echo "bundle dir: ${LATEST_BUNDLE}"
echo "bundle tarball: ${LATEST_TGZ}"
echo "public pack dir: ${ROOT_DIR}/output/demo-transcripts/public-pack"
echo "latest flagship public transcript: ${LATEST_FLAGSHIP_PUBLIC}"
echo "latest policy transcript: ${LATEST_POLICY}"
echo "latest maker-checker public transcript: ${LATEST_MC_PUBLIC}"
echo "latest plaid public transcript: ${LATEST_PLAID_PUBLIC}"
echo "latest zktls source-collect transcript: ${LATEST_ZKTLS}"
echo "latest zk o1js runtime transcript: ${LATEST_ZK_RUNTIME}"
