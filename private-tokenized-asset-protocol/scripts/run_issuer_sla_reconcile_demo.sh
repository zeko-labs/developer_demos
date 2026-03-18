#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
MAKER_API_KEY="${MAKER_API_KEY:-maker_key}"
CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}"
CHECKER2_API_KEY="${CHECKER2_API_KEY:-checker2_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_issuer_sla_reconcile_001}"

extract_json() {
  local json="$1"
  local path="$2"
  printf '%s' "${json}" | node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(0, 'utf8'));
const parts = process.argv[1].split('.');
let current = data;
for (const key of parts) current = current == null ? undefined : current[key];
if (current == null) process.exit(1);
if (typeof current === 'object') console.log(JSON.stringify(current));
else console.log(String(current));
" "${path}"
}

echo "[1/10] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

echo "[2/10] Bootstrap baseline policy/provider config..."
ADMIN_API_KEY="${ADMIN_API_KEY}" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null

echo "[3/10] Upsert issuer controls (dual-approval + reason code)..."
curl -s -X POST "${API_BASE_URL}/api/v1/issuer/controls/upsert" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H 'content-type: application/json' \
  -d "{
    \"tenantId\":\"${TENANT_ID}\",
    \"approvalExpiryMinutes\":1440,
    \"dualApprovalThresholdCents\":\"50000\",
    \"requireReasonCode\":true,
    \"allowedReasonCodes\":[\"risk_ok\",\"ops_approved\"]
  }"
echo

echo "[4/10] Create mint request as maker..."
REQUEST="$(curl -s -X POST "${API_BASE_URL}/api/v1/issuer/mint/request" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${MAKER_API_KEY}" \
  -d "{
    \"issuerId\":\"issuer_demo_bank\",
    \"recipientCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"amountCents\":\"100000\",
    \"assetId\":1,
    \"tenantId\":\"${TENANT_ID}\",
    \"policyId\":${POLICY_ID}
  }")"
echo "${REQUEST}"
REQUEST_ID="$(extract_json "${REQUEST}" "requestId")"

ACTIVE_POLICY="$(curl -s "${API_BASE_URL}/api/v1/policy/${TENANT_ID}/${POLICY_ID}/active" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}")"
ACTIVE_VERSION="$(extract_json "${ACTIVE_POLICY}" "version")"
ACTIVE_HASH="$(extract_json "${ACTIVE_POLICY}" "policyHash")"

PROOF="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/eligibility" \
  -H 'content-type: application/json' \
  -d "{
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"tenantId\":\"${TENANT_ID}\",
    \"policyVersion\":${ACTIVE_VERSION},
    \"policyHash\":\"${ACTIVE_HASH}\"
  }")"

echo "[5/10] First checker approval (progress expected)..."
APPROVE1="$(curl -s -X POST "${API_BASE_URL}/api/v1/issuer/mint/${REQUEST_ID}/approve" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${CHECKER_API_KEY}" \
  -d '{"reasonCode":"risk_ok","note":"checker1 approved"}')"
echo "${APPROVE1}"

echo "[6/10] Settlement attempt before quorum (expected fail)..."
PRE_SETTLE="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{
    \"operation\":\"mint\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"proof\":${PROOF},
    \"metadata\":{\"issuerRequestId\":\"${REQUEST_ID}\",\"tenantId\":\"${TENANT_ID}\",\"policyId\":${POLICY_ID}}
  }")"
echo "${PRE_SETTLE}"

echo "[7/10] Second checker approval (quorum reached)..."
APPROVE2="$(curl -s -X POST "${API_BASE_URL}/api/v1/issuer/mint/${REQUEST_ID}/approve" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${CHECKER2_API_KEY}" \
  -d '{"reasonCode":"ops_approved","note":"checker2 approved"}')"
echo "${APPROVE2}"

echo "[8/10] Settlement after quorum (expected success)..."
SETTLE_OK="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{
    \"operation\":\"mint\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"proof\":${PROOF},
    \"metadata\":{\"issuerRequestId\":\"${REQUEST_ID}\",\"tenantId\":\"${TENANT_ID}\",\"policyId\":${POLICY_ID}}
  }")"
echo "${SETTLE_OK}"
SETTLEMENT_ID="$(extract_json "${SETTLE_OK}" "settlementId")"

echo "[9/10] Simulate drift then reconcile (force mode)..."
MANUAL_SUBMITTED="$(curl -s -X POST "${API_BASE_URL}/api/v1/reliability/settlement/manual-status" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{
    \"settlementId\":\"${SETTLEMENT_ID}\",
    \"status\":\"submitted\",
    \"anchored\":false,
    \"confirmationSource\":\"demo_manual_drift\"
  }")"
echo "${MANUAL_SUBMITTED}"
RECONCILE="$(curl -s -X POST "${API_BASE_URL}/api/v1/reliability/settlement-reconcile/run-once" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d '{"limit":100,"staleMinutes":15,"force":true}')"
echo "${RECONCILE}"

echo "[10/10] Final settlement status + reconcile audit..."
curl -s "${API_BASE_URL}/api/v1/settlement/${SETTLEMENT_ID}" -H "Authorization: Bearer ${ADMIN_API_KEY}"
echo
curl -s "${API_BASE_URL}/api/v1/reliability/settlement-reconcile/audit?limit=5" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"
echo

echo "completed: issuer SLA + settlement reconcile demo"
