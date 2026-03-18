#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
STABLECOIN_POLICY_ID="${STABLECOIN_POLICY_ID:-1001}"
STOCK_POLICY_ID="${STOCK_POLICY_ID:-2001}"
EFFECTIVE_AT="${EFFECTIVE_AT:-2026-03-17T00:00:00.000Z}"

auth_header() {
  printf 'Authorization: Bearer %s' "${ADMIN_API_KEY}"
}

echo "[1/2] Upserting stablecoin policy (${STABLECOIN_POLICY_ID})..."
curl -sf -X POST "${API_BASE_URL}/api/v1/policy/upsert" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "{
    \"tenantId\":\"${TENANT_ID}\",
    \"policyId\":${STABLECOIN_POLICY_ID},
    \"version\":1,
    \"jurisdiction\":\"US\",
    \"rules\":{\"minScore\":70,\"track\":\"stablecoin\"},
    \"effectiveAt\":\"${EFFECTIVE_AT}\",
    \"status\":\"active\"
  }" >/dev/null

echo "[2/2] Upserting tokenized stock policy (${STOCK_POLICY_ID})..."
curl -sf -X POST "${API_BASE_URL}/api/v1/policy/upsert" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "{
    \"tenantId\":\"${TENANT_ID}\",
    \"policyId\":${STOCK_POLICY_ID},
    \"version\":1,
    \"jurisdiction\":\"US\",
    \"rules\":{\"minScore\":75,\"track\":\"tokenized-stock\"},
    \"effectiveAt\":\"${EFFECTIVE_AT}\",
    \"status\":\"active\"
  }" >/dev/null

echo "customer dual-asset policies ready."
