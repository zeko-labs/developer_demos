#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_o1js_runtime_demo_001}"

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

echo "[1/8] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

echo "[2/8] Confirming server proof mode is zk..."
CFG="$(curl -s "${API_BASE_URL}/api/v1/config/public")"
echo "${CFG}"
MODE="$(extract_json "${CFG}" "proofMode")"
if [[ "${MODE}" != "zk" ]]; then
  echo "error: server proofMode is '${MODE}', expected 'zk'."
  exit 1
fi

echo "[3/8] Bootstrapping policy..."
API_BASE_URL="${API_BASE_URL}" ADMIN_API_KEY="${ADMIN_API_KEY}" TENANT_ID="${TENANT_ID}" POLICY_ID="${POLICY_ID}" \
  "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null
ACTIVE_POLICY="$(curl -s "${API_BASE_URL}/api/v1/policy/${TENANT_ID}/${POLICY_ID}/active" -H "Authorization: Bearer ${ADMIN_API_KEY}")"
POLICY_VERSION="$(extract_json "${ACTIVE_POLICY}" "version")"
POLICY_HASH="$(extract_json "${ACTIVE_POLICY}" "policyHash")"

echo "[4/8] Requesting real o1js eligibility proof from API..."
PROOF_REQUEST="$(node - <<'NODE' "${SUBJECT_COMMITMENT}" "${TENANT_ID}" "${POLICY_ID}" "${POLICY_VERSION}" "${POLICY_HASH}"
const subjectCommitment = process.argv[2];
const tenantId = process.argv[3];
const policyId = Number(process.argv[4]);
const policyVersion = Number(process.argv[5]);
const policyHash = process.argv[6];
process.stdout.write(JSON.stringify({
  subjectCommitment,
  tenantId,
  policyId,
  policyVersion,
  policyHash,
  jurisdiction: 'US'
}));
NODE
)"
PROOF="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/eligibility" \
  -H 'content-type: application/json' \
  -d "${PROOF_REQUEST}")"
echo "${PROOF}"
PROOF_KIND="$(extract_json "${PROOF}" "proof.kind")"
if [[ "${PROOF_KIND}" != "zk-o1js-proof" ]]; then
  echo "error: server returned proof kind '${PROOF_KIND}', expected 'zk-o1js-proof'."
  echo "hint: start API with ZK_PROVER_BACKEND=o1js and ZK_O1JS_PROVE_CMD configured."
  exit 1
fi

echo "[5/8] Verifying proof envelope..."
VERIFY="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/verify" \
  -H 'content-type: application/json' \
  -d "${PROOF}")"
echo "${VERIFY}"
VERIFIED="$(extract_json "${VERIFY}" "verified")"
if [[ "${VERIFIED}" != "true" ]]; then
  echo "error: zk-o1js proof verify failed."
  exit 1
fi

echo "[6/8] Recording settlement..."
SETTLE="$(curl -s -X POST "${API_BASE_URL}/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -d "{\"operation\":\"eligibility\",\"subjectCommitment\":\"${SUBJECT_COMMITMENT}\",\"proof\":${PROOF},\"metadata\":{\"tenantId\":\"${TENANT_ID}\",\"policyId\":${POLICY_ID},\"policyVersion\":${POLICY_VERSION},\"policyHash\":\"${POLICY_HASH}\"}}")"
echo "${SETTLE}"

echo "[7/8] Recent settlements..."
curl -s "${API_BASE_URL}/api/v1/settlement/recent"
echo

echo "[8/8] Done."
