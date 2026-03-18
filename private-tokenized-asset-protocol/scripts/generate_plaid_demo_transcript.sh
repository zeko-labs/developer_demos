#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_plaid_demo_001}"
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN:-}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT_FILE="${OUT_DIR}/plaid-balance-demo-${STAMP}.md"
REDACT_PUBLIC_COPY="${REDACT_PUBLIC_COPY:-1}"
RESET_DEMO_STATE="${RESET_DEMO_STATE:-1}"

mkdir -p "${OUT_DIR}"
PASSED=0
FAILED=0

capture() {
  local title="$1"
  local cmd="$2"
  local status=0
  local tmp_file
  tmp_file="$(mktemp)"

  echo "## ${title}" >>"${OUT_FILE}"
  echo '```bash' >>"${OUT_FILE}"
  echo "${cmd}" >>"${OUT_FILE}"
  echo '```' >>"${OUT_FILE}"
  echo '```text' >>"${OUT_FILE}"
  set +e
  bash -lc "${cmd}" >"${tmp_file}" 2>&1
  status=$?
  set -e
  cat "${tmp_file}" >>"${OUT_FILE}"
  rm -f "${tmp_file}"
  echo >>"${OUT_FILE}"
  echo "[exit_code=${status}]" >>"${OUT_FILE}"
  echo '```' >>"${OUT_FILE}"
  echo >>"${OUT_FILE}"

  if [[ ${status} -eq 0 ]]; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
}

{
  echo "# TAP Plaid Balance Demo Transcript"
  echo
  echo "- generatedAtUtc: ${STAMP}"
  echo "- apiBaseUrl: ${API_BASE_URL}"
  echo "- tenantId: ${TENANT_ID}"
  echo "- policyId: ${POLICY_ID}"
  echo
  echo "## Expected Outcomes"
  echo
  echo "- Plaid balance source collection succeeds."
  echo "- Eligibility proof is generated and settled with policy snapshot linkage."
  echo "- Recent settlements include provider=plaid metadata."
  echo
} >"${OUT_FILE}"

if [[ "${RESET_DEMO_STATE}" == "1" ]]; then
  capture "Reset Demo State" "curl -s -X POST ${API_BASE_URL}/api/v1/admin/demo/reset -H 'Authorization: Bearer ${ADMIN_API_KEY}' -H 'content-type: application/json' -d '{}'"
fi

capture "Health Check" "curl -s ${API_BASE_URL}/api/v1/health"
capture "Bootstrap Policy" "ADMIN_API_KEY='${ADMIN_API_KEY}' '${ROOT_DIR}/scripts/bootstrap_policy_seed.sh'"

if [[ -z "${PLAID_ACCESS_TOKEN}" ]]; then
  capture "Plaid Demo Run (missing token)" "echo 'PLAID_ACCESS_TOKEN is required'; exit 1"
else
  capture "Run Plaid Balance Demo" "API_BASE_URL='${API_BASE_URL}' TENANT_API_KEY='${TENANT_API_KEY}' ADMIN_API_KEY='${ADMIN_API_KEY}' TENANT_ID='${TENANT_ID}' POLICY_ID='${POLICY_ID}' SUBJECT_COMMITMENT='${SUBJECT_COMMITMENT}' PLAID_ACCESS_TOKEN='${PLAID_ACCESS_TOKEN}' BOOTSTRAP_POLICY=0 '${ROOT_DIR}/scripts/run_plaid_balance_demo.sh'"
fi

capture "Recent Settlements" "curl -s ${API_BASE_URL}/api/v1/settlement/recent"

{
  echo "## Summary"
  echo
  echo "- passed: ${PASSED}"
  echo "- failed: ${FAILED}"
} >>"${OUT_FILE}"

if [[ "${REDACT_PUBLIC_COPY}" == "1" ]]; then
  REDACTED_FILE="${OUT_DIR}/plaid-balance-demo-${STAMP}.public.md"
  sed -E \
    -e 's/\b(access-sandbox|public-sandbox)-[A-Za-z0-9-]+\b/<redacted-token>/g' \
    -e 's/\b(0x)?[a-f0-9]{16,}\b/<redacted-hash>/g' \
    -e 's/\b(att_src|set|evt|prf)_[0-9]+_[a-z0-9]+\b/<redacted-id>/g' \
    "${OUT_FILE}" >"${REDACTED_FILE}"
  echo "redacted transcript written: ${REDACTED_FILE}"
fi

echo "transcript written: ${OUT_FILE}"
