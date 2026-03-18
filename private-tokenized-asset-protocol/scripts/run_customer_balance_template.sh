#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1001}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_customer_balance_001}"
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME:-customerBalanceOauth}"
BALANCE_URL="${BALANCE_URL:-https://sandbox.api.customer.example/v1/accounts/acct_demo_001/balance}"

echo "[1/2] Collecting customer balance attestation through generic-rest..."
curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -H 'content-type: application/json' \
  -d "{
    \"provider\":\"generic-rest\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{
      \"url\":\"${BALANCE_URL}\",
      \"method\":\"GET\",
      \"authProfile\":\"${AUTH_PROFILE_NAME}\",
      \"extract\":{
        \"eligibilityPath\":\"eligible\",
        \"scorePath\":\"score\",
        \"fields\":{
          \"currentBalanceCents\":\"current_balance_cents\",
          \"availableBalanceCents\":\"available_balance_cents\",
          \"currency\":\"currency\",
          \"accountStatus\":\"account_status\"
        }
      }
    }
  }"
echo

echo "[2/2] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
