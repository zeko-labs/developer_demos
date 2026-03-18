#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_increase_demo_001}"
INCREASE_ACCOUNT_ID="${INCREASE_ACCOUNT_ID:-}"
BOOTSTRAP_POLICY="${BOOTSTRAP_POLICY:-1}"
MIN_BALANCE_CENTS="${MIN_BALANCE_CENTS:-10000}"

if [[ -z "${INCREASE_ACCOUNT_ID}" ]]; then
  echo "error: INCREASE_ACCOUNT_ID is required."
  echo "example: INCREASE_ACCOUNT_ID=account_123 ./scripts/run_increase_balance_demo.sh"
  exit 1
fi

echo "[1/5] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

if [[ "${BOOTSTRAP_POLICY}" == "1" ]]; then
  echo "[2/5] Bootstrapping tenant policy/provider config..."
  API_BASE_URL="${API_BASE_URL}" ADMIN_API_KEY="${ADMIN_API_KEY}" TENANT_ID="${TENANT_ID}" POLICY_ID="${POLICY_ID}" \
    "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null
else
  echo "[2/5] Skipping bootstrap (BOOTSTRAP_POLICY=${BOOTSTRAP_POLICY})..."
fi

echo "[3/5] Running Increase source collect + settle..."
COLLECT="$(curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -d "{
    \"provider\":\"increase\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{
      \"accountId\":\"${INCREASE_ACCOUNT_ID}\",
      \"minBalanceCents\":${MIN_BALANCE_CENTS},
      \"requirePositiveAvailable\":true,
      \"requireOpenAccount\":true
    }
  }")"
echo "${COLLECT}"
if printf '%s' "${COLLECT}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.error ? 0 : 1)"; then
  echo "error: increase collect failed"
  exit 1
fi

SETTLEMENT_ID="$(printf '%s' "${COLLECT}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const id=d?.settlement?.settlementId; if(!id){process.exit(1)}; console.log(id)")" || {
  echo "error: increase collect did not create settlement"
  exit 1
}
echo "settlementId=${SETTLEMENT_ID}"

echo "[4/5] Listing recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo

echo "[5/5] Completed Increase adapter demo for subject=${SUBJECT_COMMITMENT}"
