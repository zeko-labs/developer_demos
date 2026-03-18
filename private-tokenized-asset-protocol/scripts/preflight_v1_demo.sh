#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7011}"
PROOF_MODE_EXPECTED="${PROOF_MODE_EXPECTED:-zk}"
RUN_RUNTIME="${RUN_RUNTIME:-0}"

ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
PLAID_CLIENT_ID="${PLAID_CLIENT_ID:-}"
PLAID_SECRET="${PLAID_SECRET:-}"
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN:-}"

if [[ -z "${TAP_API_KEYS_JSON:-}" ]]; then
  TAP_API_KEYS_JSON='{"admin_key":{"role":"CONSORTIUM_ADMIN"},"tenant_a_key":{"role":"ISSUER","tenantId":"tenant-a"},"maker_key":{"role":"ISSUER_MAKER","tenantId":"tenant-a"},"checker_key":{"role":"ISSUER_CHECKER","tenantId":"tenant-a"},"checker2_key":{"role":"ISSUER_CHECKER","tenantId":"tenant-a"}}'
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1"
    exit 1
  fi
}

require_env() {
  local key="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "error: required env is missing: ${key}"
    exit 1
  fi
}

echo "[preflight:1] Static checks..."
require_cmd pnpm
require_cmd curl
require_cmd node
require_cmd openssl

require_env PLAID_CLIENT_ID "${PLAID_CLIENT_ID}"
require_env PLAID_SECRET "${PLAID_SECRET}"
require_env PLAID_ACCESS_TOKEN "${PLAID_ACCESS_TOKEN}"
require_env TAP_API_KEYS_JSON "${TAP_API_KEYS_JSON}"

echo "[preflight:2] API key map checks..."
node - <<'NODE' "${TAP_API_KEYS_JSON}" "${TENANT_ID}"
const raw = process.argv[2];
const tenantId = process.argv[3];
const data = JSON.parse(raw);
const required = {
  admin_key: { role: 'CONSORTIUM_ADMIN' },
  tenant_a_key: { role: 'ISSUER', tenantId },
  maker_key: { role: 'ISSUER_MAKER', tenantId },
  checker_key: { role: 'ISSUER_CHECKER', tenantId },
  checker2_key: { role: 'ISSUER_CHECKER', tenantId }
};
for (const [key, expect] of Object.entries(required)) {
  if (!data[key]) {
    console.error(`missing key mapping: ${key}`);
    process.exit(1);
  }
  if (data[key].role !== expect.role) {
    console.error(`role mismatch for ${key}: expected=${expect.role} actual=${String(data[key].role)}`);
    process.exit(1);
  }
  if (expect.tenantId && data[key].tenantId !== expect.tenantId) {
    console.error(`tenantId mismatch for ${key}: expected=${expect.tenantId} actual=${String(data[key].tenantId)}`);
    process.exit(1);
  }
}
NODE

if [[ "${RUN_RUNTIME}" != "1" ]]; then
echo "[preflight:3] Port availability check..."
node - <<'NODE' "${API_BASE_URL}"
const base = process.argv[2];
const u = new URL(base);
if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') process.exit(0);
const net = require('net');
const port = Number(u.port || 80);
const socket = net.createConnection({ host: u.hostname, port, timeout: 300 });
socket.on('connect', () => {
  console.error(`port is already in use: ${u.hostname}:${port}`);
  process.exit(1);
});
socket.on('timeout', () => process.exit(0));
socket.on('error', (err) => {
  if (err && err.code === 'ECONNREFUSED') process.exit(0);
  process.exit(0);
});
NODE
fi

if [[ "${RUN_RUNTIME}" != "1" ]]; then
  echo "[preflight] Static checks passed."
  exit 0
fi

echo "[preflight:4] Runtime health/config checks..."
curl -fsS "${API_BASE_URL}/api/v1/health" >/dev/null
CONFIG="$(curl -fsS "${API_BASE_URL}/api/v1/config/public")"
MODE="$(printf '%s' "${CONFIG}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(String(d.proofMode||''));")"
if [[ "${MODE}" != "${PROOF_MODE_EXPECTED}" ]]; then
  echo "error: proof mode mismatch. expected=${PROOF_MODE_EXPECTED} actual=${MODE}"
  exit 1
fi

echo "[preflight:5] Admin auth and policy snapshot checks..."
RESET_RESP="$(curl -fsS -X POST "${API_BASE_URL}/api/v1/admin/demo/reset" -H "Authorization: Bearer ${ADMIN_API_KEY}" -H 'content-type: application/json' -d '{}')"
RESET_OK="$(printf '%s' "${RESET_RESP}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.ok===true?'true':'false');")"
if [[ "${RESET_OK}" != "true" ]]; then
  echo "error: admin reset check failed"
  exit 1
fi

API_BASE_URL="${API_BASE_URL}" ADMIN_API_KEY="${ADMIN_API_KEY}" TENANT_ID="${TENANT_ID}" POLICY_ID="${POLICY_ID}" \
  "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null
ACTIVE_POLICY="$(curl -fsS "${API_BASE_URL}/api/v1/policy/${TENANT_ID}/${POLICY_ID}/active" -H "Authorization: Bearer ${ADMIN_API_KEY}")"
printf '%s' "${ACTIVE_POLICY}" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
if (!Number.isFinite(Number(d.version)) || Number(d.version) < 1) process.exit(1);
if (typeof d.policyHash !== 'string' || d.policyHash.length < 16) process.exit(1);
" || {
  echo "error: active policy snapshot is invalid"
  exit 1
}

echo "[preflight:6] Credential diagnostics checks..."
DIAG="$(curl -fsS "${API_BASE_URL}/api/v1/diag/credentials" -H "Authorization: Bearer ${ADMIN_API_KEY}")"
printf '%s' "${DIAG}" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const s=d.summary||{};
if ((s.expired||0) > 0) process.exit(1);
if ((s.rotation_overdue||0) > 0) process.exit(1);
if ((s.missing_env_secret||0) > 0) process.exit(1);
" || {
  echo "error: credential diagnostics reported blocking statuses"
  exit 1
}

echo "[preflight:7] Plaid source smoke check..."
PLAID_COLLECT="$(curl -fsS -X POST "${API_BASE_URL}/api/v1/attest/source/collect" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -d "{
    \"provider\":\"plaid\",
    \"tenantId\":\"${TENANT_ID}\",
    \"subjectCommitment\":\"subj_preflight_plaid\",
    \"policyId\":${POLICY_ID},
    \"settle\":false,
    \"source\":{
      \"accessToken\":\"${PLAID_ACCESS_TOKEN}\",
      \"minBalanceCents\":10000,
      \"requirePositiveBalance\":true
    }
  }")"
printf '%s' "${PLAID_COLLECT}" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
if (d.error) process.exit(1);
if (!d.attestation || d.attestation.provider !== 'plaid') process.exit(1);
" || {
  echo "error: plaid smoke check failed"
  echo "${PLAID_COLLECT}"
  exit 1
}

echo "[preflight] Runtime checks passed."
