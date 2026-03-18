#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_plaid_demo_001}"
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN:-}"
BOOTSTRAP_POLICY="${BOOTSTRAP_POLICY:-1}"

if [[ -z "${PLAID_ACCESS_TOKEN}" ]]; then
  echo "error: PLAID_ACCESS_TOKEN is required (sandbox access token)."
  echo "example: PLAID_ACCESS_TOKEN=access-sandbox-... ./scripts/run_plaid_balance_demo.sh"
  exit 1
fi

echo "[1/5] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

if [[ "${BOOTSTRAP_POLICY}" == "1" ]]; then
  echo "[2/5] Bootstrapping tenant policy/provider config..."
  ADMIN_API_KEY="${ADMIN_API_KEY}" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null
else
  echo "[2/5] Skipping bootstrap (BOOTSTRAP_POLICY=${BOOTSTRAP_POLICY})..."
fi

echo "[3/5] Running Plaid source collect + settle..."
COLLECT="$(curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -d "{
    \"provider\":\"plaid\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{
      \"accessToken\":\"${PLAID_ACCESS_TOKEN}\",
      \"minBalanceCents\":10000,
      \"requirePositiveBalance\":true
    }
  }")"
echo "${COLLECT}"
if printf '%s' "${COLLECT}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.error ? 0 : 1)"; then
  echo "error: plaid collect failed"
  exit 1
fi
SETTLEMENT_ID="$(printf '%s' "${COLLECT}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const id=d?.settlement?.settlementId; if(!id){process.exit(1)}; console.log(id)")" || {
  echo "error: plaid collect did not create settlement"
  exit 1
}
echo "settlementId=${SETTLEMENT_ID}"

echo "[4/5] Listing recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo

echo "[5/5] Completed Plaid adapter demo for subject=${SUBJECT_COMMITMENT}"
