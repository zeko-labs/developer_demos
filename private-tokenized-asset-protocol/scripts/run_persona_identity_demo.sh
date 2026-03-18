#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_persona_demo_001}"
PERSONA_INQUIRY_ID="${PERSONA_INQUIRY_ID:-inq_sandbox_demo_001}"
PERSONA_BASE_URL="${PERSONA_BASE_URL:-https://withpersona.com}"
PERSONA_WEBHOOK_SECRET="${PERSONA_WEBHOOK_SECRET:-}"

if [[ -z "${PERSONA_WEBHOOK_SECRET}" ]]; then
  echo "error: PERSONA_WEBHOOK_SECRET is required for webhook signature demo."
  exit 1
fi

echo "[1/3] Collecting identity attestation from persona adapter..."
curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -H 'content-type: application/json' \
  -d "{
    \"provider\":\"persona\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{
      \"inquiryId\":\"${PERSONA_INQUIRY_ID}\",
      \"baseUrl\":\"${PERSONA_BASE_URL}\",
      \"apiKeyEnv\":\"PERSONA_API_KEY\",
      \"requirePassed\":true
    }
  }"
echo

echo "[2/3] Sending signed persona webhook sample..."
ts="$(date +%s)"
payload='{"type":"inquiry.completed","data":{"id":"'"${PERSONA_INQUIRY_ID}"'","attributes":{"status":"approved","reference-id":"'"${SUBJECT_COMMITMENT}"'"}}}'
sig="$(printf "%s.%s" "${ts}" "${payload}" | openssl dgst -sha256 -hmac "${PERSONA_WEBHOOK_SECRET}" -r | awk '{print $1}')"
curl -s -X POST "${API_BASE_URL}/api/v1/attest/identity/persona/webhook" \
  -H 'content-type: application/json' \
  -H "persona-signature: t=${ts},v1=${sig}" \
  -d "${payload}"
echo

echo "[3/3] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
