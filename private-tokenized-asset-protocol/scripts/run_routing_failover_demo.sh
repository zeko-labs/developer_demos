#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_routing_failover_demo_001}"
BOOTSTRAP_POLICY="${BOOTSTRAP_POLICY:-1}"

echo "[1/6] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

if [[ "${BOOTSTRAP_POLICY}" == "1" ]]; then
  echo "[2/6] Bootstrapping tenant policy/provider config..."
  ADMIN_API_KEY="${ADMIN_API_KEY}" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null
else
  echo "[2/6] Skipping bootstrap (BOOTSTRAP_POLICY=${BOOTSTRAP_POLICY})..."
fi

echo "[3/6] Upserting generic-rest provider config..."
curl -s -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d '{
    "provider":"generic-rest",
    "enabled":true,
    "allowedHosts":["partner.example.com"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{}
  }'
echo

echo "[4/6] Setting routing defaults (generic-rest -> mock-bank failover)..."
curl -s -X POST "${API_BASE_URL}/api/v1/routing/config/upsert" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{
    \"tenantId\":\"${TENANT_ID}\",
    \"provider\":\"generic-rest\",
    \"failoverProviders\":[\"mock-bank\"],
    \"routingStrategy\":\"ordered\",
    \"routingWeight\":0
  }"
echo

echo "[5/6] Running source collect with forced failover..."
COLLECT="$(curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -d "{
    \"provider\":\"generic-rest\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{
      \"url\":\"https://partner.example.com/unavailable\",
      \"method\":\"GET\",
      \"timeoutMs\":500,
      \"extract\":{
        \"subjectPath\":\"$.subject\",
        \"eligibilityPath\":\"$.eligible\",
        \"scorePath\":\"$.score\"
      }
    },
    \"failover\":{
      \"providers\":[\"mock-bank\"],
      \"sources\":{
        \"mock-bank\":{
          \"balanceCents\":120000,
          \"kycPassed\":true,
          \"accountStatus\":\"active\"
        }
      }
    }
  }")"
echo "${COLLECT}"

if ! printf '%s' "${COLLECT}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.failoverUsed===true && d.selectedProvider==='mock-bank' ? 0 : 1)"; then
  echo "error: failover demo did not route to mock-bank as expected"
  exit 1
fi

echo "[6/6] Routing diagnostics..."
curl -s "${API_BASE_URL}/api/v1/diag/providers/ranked?tenantId=${TENANT_ID}&providers=generic-rest,mock-bank&strategy=ordered" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"
echo

echo "completed: routing/failover demo succeeded for subject=${SUBJECT_COMMITMENT}"
