#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"

MINT_MAX_PER_TXN_CENTS="${MINT_MAX_PER_TXN_CENTS:-1000000}"
MINT_MAX_DAILY_CENTS="${MINT_MAX_DAILY_CENTS:-5000000}"
MINT_MAX_REQ_PER_HOUR="${MINT_MAX_REQ_PER_HOUR:-200}"

BURN_MAX_PER_TXN_CENTS="${BURN_MAX_PER_TXN_CENTS:-1000000}"
BURN_MAX_DAILY_CENTS="${BURN_MAX_DAILY_CENTS:-5000000}"
BURN_MAX_REQ_PER_HOUR="${BURN_MAX_REQ_PER_HOUR:-200}"

ELIGIBILITY_MIN_SCORE="${ELIGIBILITY_MIN_SCORE:-70}"
ELIGIBILITY_MAX_REQ_PER_HOUR="${ELIGIBILITY_MAX_REQ_PER_HOUR:-1000}"

auth_header() {
  printf 'Authorization: Bearer %s' "${ADMIN_API_KEY}"
}

upsert() {
  curl -s -X POST "${API_BASE_URL}/api/v1/risk/config/upsert" \
    -H 'content-type: application/json' \
    -H "$(auth_header)" \
    -d "$1" >/dev/null
}

echo "[1/4] Upserting eligibility risk config..."
upsert "{
  \"tenantId\":\"${TENANT_ID}\",
  \"operation\":\"eligibility\",
  \"enabled\":true,
  \"minScore\":${ELIGIBILITY_MIN_SCORE},
  \"maxRequestsPerHour\":${ELIGIBILITY_MAX_REQ_PER_HOUR}
}"

echo "[2/4] Upserting mint risk config..."
upsert "{
  \"tenantId\":\"${TENANT_ID}\",
  \"operation\":\"mint\",
  \"enabled\":true,
  \"maxPerTxnAmountCents\":\"${MINT_MAX_PER_TXN_CENTS}\",
  \"maxDailyAmountCents\":\"${MINT_MAX_DAILY_CENTS}\",
  \"maxRequestsPerHour\":${MINT_MAX_REQ_PER_HOUR}
}"

echo "[3/4] Upserting burn risk config..."
upsert "{
  \"tenantId\":\"${TENANT_ID}\",
  \"operation\":\"burn\",
  \"enabled\":true,
  \"maxPerTxnAmountCents\":\"${BURN_MAX_PER_TXN_CENTS}\",
  \"maxDailyAmountCents\":\"${BURN_MAX_DAILY_CENTS}\",
  \"maxRequestsPerHour\":${BURN_MAX_REQ_PER_HOUR}
}"

echo "[4/4] Active risk configs:"
curl -s "${API_BASE_URL}/api/v1/risk/configs?tenantId=${TENANT_ID}" -H "$(auth_header)"
echo
