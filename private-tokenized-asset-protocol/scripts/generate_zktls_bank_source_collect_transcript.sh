#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_zktls_bank_demo_001}"
RUN_PIPELINE_FIRST="${RUN_PIPELINE_FIRST:-0}"
MODE="${MODE:-eligible}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT_FILE="${OUT_DIR}/zktls-bank-source-collect-demo-${STAMP}.md"
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
  echo "# TAP zkTLS Bank Source Collect Demo Transcript"
  echo
  echo "- generatedAtUtc: ${STAMP}"
  echo "- apiBaseUrl: ${API_BASE_URL}"
  echo "- tenantId: ${TENANT_ID}"
  echo "- policyId: ${POLICY_ID}"
  echo "- runPipelineFirst: ${RUN_PIPELINE_FIRST}"
  echo "- mode: ${MODE}"
  echo
  echo "## Expected Outcomes"
  echo
  echo "- zkTLS-backed bank-balance collection succeeds through the normal source/collect path."
  echo "- Bank-profile proof metadata is mapped into TAP settlement input."
  echo "- Recent settlements include provider=zktls-bank metadata."
  echo
} >"${OUT_FILE}"

if [[ "${RESET_DEMO_STATE}" == "1" ]]; then
  capture "Reset Demo State" "curl -sf -X POST ${API_BASE_URL}/api/v1/admin/demo/reset -H 'Authorization: Bearer ${ADMIN_API_KEY}' -H 'content-type: application/json' -d '{}'"
fi

capture "Health Check" "curl -sf ${API_BASE_URL}/api/v1/health"
capture "Bootstrap Policy" "API_BASE_URL='${API_BASE_URL}' ADMIN_API_KEY='${ADMIN_API_KEY}' TENANT_ID='${TENANT_ID}' POLICY_ID='${POLICY_ID}' '${ROOT_DIR}/scripts/bootstrap_policy_seed.sh'"
capture "Run zkTLS Bank Source Collect Demo" "API_BASE_URL='${API_BASE_URL}' TENANT_API_KEY='${TENANT_API_KEY}' ADMIN_API_KEY='${ADMIN_API_KEY}' TENANT_ID='${TENANT_ID}' POLICY_ID='${POLICY_ID}' SUBJECT_COMMITMENT='${SUBJECT_COMMITMENT}' RUN_PIPELINE_FIRST='${RUN_PIPELINE_FIRST}' MODE='${MODE}' bash '${ROOT_DIR}/scripts/run_zktls_bank_source_collect_demo.sh'"
capture "Recent Settlements" "curl -sf ${API_BASE_URL}/api/v1/settlement/recent"

{
  echo "## Summary"
  echo
  echo "- passed: ${PASSED}"
  echo "- failed: ${FAILED}"
} >>"${OUT_FILE}"

echo "transcript written: ${OUT_FILE}"
