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

issue_counter=0

run_flow() {
  local kind="$1"
  local subject="$2"
  local request_path="$3"
  local request_payload="$4"

  issue_counter=$((issue_counter + 1))

  echo "Creating ${kind} issuer request as maker..."
  local request
  request="$(curl -s -X POST "${API_BASE_URL}${request_path}" \
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
    -d "{\"note\":\"checker approved ${kind}\"}")"
  echo "${approved}"

  echo "Settling ${kind} again after approval (expected success)..."
  local post_settle
  post_settle="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
    -H 'content-type: application/json' \
    -H "Authorization: Bearer ${ADMIN_API_KEY}" \
    -d "{\"operation\":\"${kind}\",\"subjectCommitment\":\"${subject}\",\"proof\":${proof},\"metadata\":{\"issuerRequestId\":\"${request_id}\",\"tenantId\":\"tenant-a\",\"policyId\":1}}")"
  echo "${post_settle}"
}

echo "[1/6] Running stock issue path..."
run_flow "issue" "subj_stock_issue_001" \
  "/api/v1/issuer/stock/issue/request" \
  '{"issuerId":"issuer_demo_bank","investorCommitment":"subj_stock_issue_001","quantityUnits":"1250","assetId":101,"securityId":"sec_fund_a","issuanceType":"primary","notionalCents":"750000","tenantId":"tenant-a","policyId":1}'

echo "[2/6] Running stock allocation path..."
run_flow "allocate" "subj_stock_alloc_001" \
  "/api/v1/issuer/stock/allocate/request" \
  '{"issuerId":"issuer_demo_bank","investorCommitment":"subj_stock_alloc_001","quantityUnits":"500","assetId":101,"securityId":"sec_fund_a","allocationId":"alloc_demo_001","notionalCents":"300000","tenantId":"tenant-a","policyId":1}'

echo "[3/6] Running stock restriction path..."
run_flow "restrict" "subj_stock_hold_001" \
  "/api/v1/issuer/stock/restrict/request" \
  '{"issuerId":"issuer_demo_bank","holderCommitment":"subj_stock_hold_001","assetId":101,"securityId":"sec_fund_a","restrictionCode":"compliance_hold","note":"demo restriction","tenantId":"tenant-a","policyId":1}'

echo "[4/6] Running stock redeem path..."
run_flow "redeem" "subj_stock_hold_001" \
  "/api/v1/issuer/stock/redeem/request" \
  '{"issuerId":"issuer_demo_bank","holderCommitment":"subj_stock_hold_001","quantityUnits":"250","assetId":101,"securityId":"sec_fund_a","redemptionType":"redeem","notionalCents":"150000","tenantId":"tenant-a","policyId":1}'

echo "[5/6] Listing stock issuer requests..."
curl -s "${API_BASE_URL}/api/v1/issuer/requests" -H "Authorization: Bearer ${CHECKER_API_KEY}"
echo

echo "[6/6] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
