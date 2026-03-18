#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_zk_demo_001}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

echo "[1/6] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

echo "[2/6] Confirming server PROOF_MODE is zk..."
CFG="$(curl -s "${API_BASE_URL}/api/v1/config/public")"
echo "${CFG}"
MODE="$(extract_json "${CFG}" "proofMode")"
if [[ "${MODE}" != "zk" ]]; then
  echo "error: server proofMode is '${MODE}', expected 'zk'."
  echo "hint: restart api-gateway with PROOF_MODE=zk"
  exit 1
fi

echo "[3/6] Bootstrap policy and load active snapshot..."
ADMIN_API_KEY="${ADMIN_API_KEY}" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null
ACTIVE_POLICY="$(curl -s "${API_BASE_URL}/api/v1/policy/tenant-a/1/active" -H "Authorization: Bearer ${ADMIN_API_KEY}")"
POLICY_VERSION="$(extract_json "${ACTIVE_POLICY}" "version")"
POLICY_HASH="$(extract_json "${ACTIVE_POLICY}" "policyHash")"

echo "[4/7] Generating zk eligibility proof..."
PROOF="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/eligibility" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{\"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",\"policyId\":1,\"tenantId\":\"tenant-a\",\"policyVersion\":${POLICY_VERSION},\"policyHash\":\"${POLICY_HASH}\"}")"
echo "${PROOF}"
PROOF_MODE="$(extract_json "${PROOF}" "mode")"
if [[ "${PROOF_MODE}" != "zk" ]]; then
  echo "error: proof mode is '${PROOF_MODE}', expected 'zk'"
  exit 1
fi

echo "[5/7] Verifying zk proof envelope..."
VERIFY="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/verify" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "${PROOF}")"
echo "${VERIFY}"
VERIFIED="$(extract_json "${VERIFY}" "verified")"
if [[ "${VERIFIED}" != "true" ]]; then
  echo "error: zk proof verify failed"
  exit 1
fi

echo "[6/7] Recording settlement..."
SETTLE="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -d "{\"operation\":\"eligibility\",\"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",\"proof\":${PROOF},\"metadata\":{\"tenantId\":\"tenant-a\",\"policyId\":1,\"policyVersion\":${POLICY_VERSION},\"policyHash\":\"${POLICY_HASH}\"}}")"
echo "${SETTLE}"

echo "[7/7] Done."
