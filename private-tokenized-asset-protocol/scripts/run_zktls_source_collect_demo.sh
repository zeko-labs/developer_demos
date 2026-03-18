#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_zktls_collect_001}"
RUN_PIPELINE_FIRST="${RUN_PIPELINE_FIRST:-0}"
MODE="${MODE:-eligible}"

echo "[1/4] Bootstrapping policy..."
API_BASE_URL="${API_BASE_URL}" ADMIN_API_KEY="${ADMIN_API_KEY}" TENANT_ID="${TENANT_ID}" POLICY_ID="${POLICY_ID}" \
  "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null

echo "[2/4] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

echo "[3/4] Source collect via zktls-employer..."
PAYLOAD="$(node - <<'NODE' "${TENANT_ID}" "${POLICY_ID}" "${SUBJECT_COMMITMENT}" "${RUN_PIPELINE_FIRST}" "${MODE}"
const tenantId = process.argv[2];
const policyId = Number(process.argv[3]);
const subjectCommitment = process.argv[4];
const runPipelineFirst = process.argv[5] === '1';
const mode = process.argv[6] === 'ineligible' ? 'ineligible' : 'eligible';
process.stdout.write(JSON.stringify({
  provider: 'zktls-employer',
  tenantId,
  policyId,
  subjectCommitment,
  settle: true,
  source: {
    runPipelineFirst,
    mode,
    expectedServerName: 'localhost',
    minSalary: 50000,
    minTenureMonths: 12,
    requireActive: true
  }
}));
NODE
)"
curl -s -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -H 'content-type: application/json' \
  -d "${PAYLOAD}"
echo

echo "[4/4] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo
