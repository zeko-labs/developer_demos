#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-2001}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_customer_holdings_001}"
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME:-customerHoldingsOauth}"
HOLDINGS_URL="${HOLDINGS_URL:-https://sandbox.brokerage.customer.example/v1/accounts/acct_eq_001/positions/sec_fund_a}"

echo "[1/2] Collecting customer holdings attestation through generic-rest..."
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
      \"url\":\"${HOLDINGS_URL}\",
      \"method\":\"GET\",
      \"authProfile\":\"${AUTH_PROFILE_NAME}\",
      \"extract\":{
        \"eligibilityPath\":\"position_eligible\",
        \"scorePath\":\"position_score\",
        \"fields\":{
          \"securityId\":\"security_id\",
          \"holdingQuantity\":\"position_quantity\",
          \"positionStatus\":\"position_status\",
          \"asOf\":\"as_of\"
        }
      }
    }
  }"
echo

echo "[2/2] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
