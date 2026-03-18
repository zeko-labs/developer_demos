#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"

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

echo "[0/4] Resolving active policy..."
ACTIVE_POLICY="$(curl -s "${API_BASE_URL}/api/v1/policy/${TENANT_ID}/${POLICY_ID}/active" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}")"
ACTIVE_HASH="$(extract_json "${ACTIVE_POLICY}" "policyHash")"
ACTIVE_VERSION="$(extract_json "${ACTIVE_POLICY}" "version")"
echo "active policy version=${ACTIVE_VERSION} hash=${ACTIVE_HASH}"

echo "[1/4] Happy path source/collect + settle (must pass)..."
COLLECT_OK="$(curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -d "{
    \"provider\":\"mock-bank\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"subj_demo_policy_ok\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{\"balanceCents\":250000,\"kycPassed\":true,\"accountStatus\":\"active\"}
  }")"
echo "${COLLECT_OK}"

echo "[2/4] Missing linkage source/collect settle (must fail)..."
COLLECT_FAIL="$(curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -d "{
    \"provider\":\"mock-bank\",
    \"subjectCommitment\":\"subj_demo_missing_linkage\",
    \"policyId\":${POLICY_ID},
    \"settle\":true,
    \"source\":{\"balanceCents\":120000,\"kycPassed\":true,\"accountStatus\":\"active\"}
  }")"
echo "${COLLECT_FAIL}"

echo "[3/4] Stale settlement/record (must fail with policy_version_mismatch)..."
STALE_PROOF="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/eligibility" \
  -H 'content-type: application/json' \
  -d "{
    \"subjectCommitment\":\"subj_demo_stale\",
    \"policyId\":${POLICY_ID},
    \"tenantId\":\"${TENANT_ID}\",
    \"policyVersion\":1,
    \"policyHash\":\"stale_hash_v1\"
  }")"
STALE_SETTLE="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{
    \"operation\":\"eligibility\",
    \"subjectCommitment\":\"subj_demo_stale\",
    \"proof\":${STALE_PROOF}
  }")"
echo "${STALE_SETTLE}"

echo "[4/4] Current settlement/record (must pass with policySnapshotHash)..."
CURRENT_PROOF="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/eligibility" \
  -H 'content-type: application/json' \
  -d "{
    \"subjectCommitment\":\"subj_demo_current\",
    \"policyId\":${POLICY_ID},
    \"tenantId\":\"${TENANT_ID}\",
    \"policyVersion\":${ACTIVE_VERSION},
    \"policyHash\":\"${ACTIVE_HASH}\"
  }")"
CURRENT_SETTLE="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{
    \"operation\":\"eligibility\",
    \"subjectCommitment\":\"subj_demo_current\",
    \"proof\":${CURRENT_PROOF}
  }")"
echo "${CURRENT_SETTLE}"
