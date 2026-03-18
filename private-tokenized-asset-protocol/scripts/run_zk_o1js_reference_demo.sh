#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_o1js_ref_demo_001}"
VK_HASH="${ZK_O1JS_VERIFICATION_KEY_HASH:-vk_hash_demo}"

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

echo "[4/8] Building zk-o1js-proof envelope..."
PROOF="$(node - <<'NODE' "${SUBJECT_COMMITMENT}" "${TENANT_ID}" "${POLICY_ID}" "${POLICY_VERSION}" "${POLICY_HASH}" "${VK_HASH}"
const crypto = require('crypto');
const subjectCommitment = process.argv[2];
const tenantId = process.argv[3];
const policyId = Number(process.argv[4]);
const policyVersion = Number(process.argv[5]);
const policyHash = process.argv[6];
const verificationKeyHash = process.argv[7];

const evaluationDate = Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));
const publicInput = {
  evaluationDate,
  policyHash,
  policyId,
  policyVersion,
  result: true,
  subjectCommitment,
  tenantId
};

const sorted = Object.keys(publicInput).sort().reduce((acc, k) => {
  acc[k] = publicInput[k];
  return acc;
}, {});
const serialized = JSON.stringify(sorted);
const publicInputHash = crypto.createHash('sha256').update(serialized).digest('hex');
const proofHash = crypto.createHash('sha256').update(`eligibility_v1:zk:${serialized}`).digest('hex');
const payload = {
  verified: true,
  circuitId: 'eligibility_v1',
  publicInputHash,
  verificationKeyHash
};
const proofBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
const proof = {
  id: `prf_o1js_ref_${Date.now()}`,
  circuitId: 'eligibility_v1',
  mode: 'zk',
  publicInput: sorted,
  proof: {
    kind: 'zk-o1js-proof',
    proofBase64,
    verificationKeyHash,
    publicInputHash
  },
  proofHash,
  verifiedLocal: true,
  createdAt: new Date().toISOString()
};
process.stdout.write(JSON.stringify(proof));
NODE
)"
echo "${PROOF}"

echo "[5/8] Verifying proof envelope..."
VERIFY="$(curl -s -X POST "${API_BASE_URL}/api/v1/proof/verify" \
  -H 'content-type: application/json' \
  -d "${PROOF}")"
echo "${VERIFY}"
VERIFIED="$(extract_json "${VERIFY}" "verified")"
if [[ "${VERIFIED}" != "true" ]]; then
  echo "error: zk-o1js proof verify failed (check ZK_O1JS_VERIFY_CMD / ZK_O1JS_VERIFICATION_KEY_HASH)."
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
