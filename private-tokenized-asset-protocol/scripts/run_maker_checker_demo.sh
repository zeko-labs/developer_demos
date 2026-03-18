#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
MAKER_API_KEY="${MAKER_API_KEY:-maker_key}"
CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"

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

ACTIVE_POLICY="$(curl -s "${API_BASE_URL}/api/v1/policy/tenant-a/1/active" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}")"
ACTIVE_VERSION="$(extract_json "${ACTIVE_POLICY}" "version")"
ACTIVE_HASH="$(extract_json "${ACTIVE_POLICY}" "policyHash")"

run_flow() {
  local kind="$1"
  local subject="$2"
  local request_payload="$3"

  echo "Creating ${kind} issuer request as maker..."
  local request
  request="$(curl -s -X POST "${API_BASE_URL}/api/v1/issuer/${kind}/request" \
    -H 'content-type: application/json' \
    -H "Authorization: Bearer ${MAKER_API_KEY}" \
    -d "${request_payload}")"
  local request_id
  request_id="$(extract_json "${request}" "requestId")"
  echo "requestId=${request_id}"

  echo "Attempting ${kind} settlement before approval (expected fail)..."
  local proof
  proof="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/eligibility" \
    -H 'content-type: application/json' \
    -d "{\"subjectCommitment\":\"${subject}\",\"policyId\":1,\"tenantId\":\"tenant-a\",\"policyVersion\":${ACTIVE_VERSION},\"policyHash\":\"${ACTIVE_HASH}\"}")"
  local pre_settle
  pre_settle="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
    -H 'content-type: application/json' \
    -H "Authorization: Bearer ${ADMIN_API_KEY}" \
    -d "{\"operation\":\"${kind}\",\"subjectCommitment\":\"${subject}\",\"proof\":${proof},\"metadata\":{\"issuerRequestId\":\"${request_id}\",\"tenantId\":\"tenant-a\",\"policyId\":1}}")"
  echo "${pre_settle}"

  echo "Approving ${kind} request as checker..."
  local approved
  approved="$(curl -s -X POST "${API_BASE_URL}/api/v1/issuer/${kind}/${request_id}/approve" \
    -H 'content-type: application/json' \
    -H "Authorization: Bearer ${CHECKER_API_KEY}" \
    -d '{"note":"checker approved"}')"
  echo "${approved}"

  echo "Settling ${kind} again after approval (expected success)..."
  local post_settle
  post_settle="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
    -H 'content-type: application/json' \
    -H "Authorization: Bearer ${ADMIN_API_KEY}" \
    -d "{\"operation\":\"${kind}\",\"subjectCommitment\":\"${subject}\",\"proof\":${proof},\"metadata\":{\"issuerRequestId\":\"${request_id}\",\"tenantId\":\"tenant-a\",\"policyId\":1}}")"
  echo "${post_settle}"
}

echo "[1/8] Running mint path..."
run_flow "mint" "subj_mc_mint_001" '{"issuerId":"issuer_demo_bank","recipientCommitment":"subj_mc_mint_001","amountCents":"100000","assetId":1,"tenantId":"tenant-a","policyId":1}'

echo "[2/8] Running burn path..."
run_flow "burn" "subj_mc_burn_001" '{"issuerId":"issuer_demo_bank","holderCommitment":"subj_mc_burn_001","amountCents":"50000","assetId":1,"tenantId":"tenant-a","policyId":1}'

echo "[3/8] Listing issuer requests..."
curl -s "${API_BASE_URL}/api/v1/issuer/requests" -H "Authorization: Bearer ${CHECKER_API_KEY}"
echo

echo "[4/8] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
