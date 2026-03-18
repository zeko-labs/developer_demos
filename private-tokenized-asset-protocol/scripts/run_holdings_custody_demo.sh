#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_custody_demo_001}"
CUSTODY_ACCOUNT_ID="${CUSTODY_ACCOUNT_ID:-acct_sandbox_demo_001}"
CUSTODY_ASSET_SYMBOL="${CUSTODY_ASSET_SYMBOL:-DEMO}"
CUSTODY_BASE_URL="${CUSTODY_BASE_URL:-https://sandbox.custody.example}"
CUSTODY_WEBHOOK_SECRET="${CUSTODY_WEBHOOK_SECRET:-}"

if [[ -z "${CUSTODY_WEBHOOK_SECRET}" ]]; then
  echo "error: CUSTODY_WEBHOOK_SECRET is required for webhook signature demo."
  exit 1
fi

echo "[1/3] Collecting holdings attestation from custody-holdings adapter..."
curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -H 'content-type: application/json' \
  -d "{
    \"provider\":\"custody-holdings\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{
      \"accountId\":\"${CUSTODY_ACCOUNT_ID}\",
      \"assetSymbol\":\"${CUSTODY_ASSET_SYMBOL}\",
      \"baseUrl\":\"${CUSTODY_BASE_URL}\",
      \"apiKeyEnv\":\"CUSTODY_API_KEY\",
      \"minUnits\":1,
      \"requireCertificateValid\":true
    }
  }"
echo

echo "[2/3] Sending signed custody webhook sample..."
ts="$(date +%s)"
payload='{"type":"holding.updated","data":{"attributes":{"account-id":"'"${CUSTODY_ACCOUNT_ID}"'","symbol":"'"${CUSTODY_ASSET_SYMBOL}"'","certificate-id":"cert_demo_001","status":"verified"}}}'
sig="$(printf "%s.%s" "${ts}" "${payload}" | openssl dgst -sha256 -hmac "${CUSTODY_WEBHOOK_SECRET}" -r | awk '{print $1}')"
curl -s -X POST "${API_BASE_URL}/api/v1/attest/holdings/custody/webhook" \
  -H 'content-type: application/json' \
  -H "x-custody-signature: t=${ts},v1=${sig}" \
  -d "${payload}"
echo

echo "[3/3] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
