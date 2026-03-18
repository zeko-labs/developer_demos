#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
JURISDICTION="${JURISDICTION:-US}"
EFFECTIVE_AT="${EFFECTIVE_AT:-2026-02-01T00:00:00.000Z}"

auth_header() {
  printf 'Authorization: Bearer %s' "${ADMIN_API_KEY}"
}

echo "[1/4] Upserting tenant provider config (${TENANT_ID}/mock-bank)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"mock-bank",
    "enabled":true,
    "allowedHosts":[],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":["generic-rest"],
    "routingStrategy":"health-weighted",
    "routingWeight":5
  }' >/dev/null

echo "[2/9] Upserting tenant provider config (${TENANT_ID}/increase)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"increase",
    "enabled":true,
    "allowedHosts":["api.increase.com"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":["generic-rest"],
    "routingStrategy":"health-weighted",
    "routingWeight":9
  }' >/dev/null

echo "[3/9] Upserting tenant provider config (${TENANT_ID}/plaid)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"plaid",
    "enabled":true,
    "allowedHosts":["sandbox.plaid.com"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":["generic-rest"],
    "routingStrategy":"health-weighted",
    "routingWeight":10
  }' >/dev/null

echo "[4/9] Upserting tenant provider config (${TENANT_ID}/persona)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"persona",
    "enabled":true,
    "allowedHosts":["withpersona.com"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":["generic-rest"],
    "routingStrategy":"ordered",
    "routingWeight":5
  }' >/dev/null

echo "[5/9] Upserting tenant provider config (${TENANT_ID}/custody-holdings)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"custody-holdings",
    "enabled":true,
    "allowedHosts":["sandbox.custody.example"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":["generic-rest"],
    "routingStrategy":"health-weighted",
    "routingWeight":8
  }' >/dev/null

echo "[6/9] Upserting tenant provider config (${TENANT_ID}/zktls-employer)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"zktls-employer",
    "enabled":true,
    "allowedHosts":["localhost"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":[],
    "routingStrategy":"ordered",
    "routingWeight":12
  }' >/dev/null

echo "[7/9] Upserting tenant provider config (${TENANT_ID}/zktls-bank)..."
curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d '{
    "provider":"zktls-bank",
    "enabled":true,
    "allowedHosts":["localhost"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":[],
    "routingStrategy":"ordered",
    "routingWeight":15
  }' >/dev/null

echo "[8/9] Upserting policy versions..."
curl -sf -X POST "${API_BASE_URL}/api/v1/policy/upsert" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "{
    \"tenantId\":\"${TENANT_ID}\",
    \"policyId\":${POLICY_ID},
    \"version\":1,
    \"jurisdiction\":\"${JURISDICTION}\",
    \"rules\":{\"minScore\":60},
    \"effectiveAt\":\"${EFFECTIVE_AT}\",
    \"status\":\"retired\"
  }" >/dev/null

ACTIVE="$(curl -sf -X POST "${API_BASE_URL}/api/v1/policy/upsert" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "{
    \"tenantId\":\"${TENANT_ID}\",
    \"policyId\":${POLICY_ID},
    \"version\":2,
    \"jurisdiction\":\"${JURISDICTION}\",
    \"rules\":{\"minScore\":70},
    \"effectiveAt\":\"${EFFECTIVE_AT}\",
    \"status\":\"active\"
  }")"

echo "[9/9] Active policy snapshot:"
echo "${ACTIVE}"
