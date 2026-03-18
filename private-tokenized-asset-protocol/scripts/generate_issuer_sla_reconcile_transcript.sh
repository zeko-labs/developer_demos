#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT_FILE="${OUT_DIR}/issuer-sla-reconcile-demo-${STAMP}.md"
RESET_DEMO_STATE="${RESET_DEMO_STATE:-1}"
REDACT_PUBLIC_COPY="${REDACT_PUBLIC_COPY:-1}"

mkdir -p "${OUT_DIR}"

PASSED=0
FAILED=0

capture() {
  local title="$1"
  shift
  local status=0
  local tmp_file
  tmp_file="$(mktemp)"

  echo "## ${title}" >>"${OUT_FILE}"
  echo '```bash' >>"${OUT_FILE}"
  echo "$*" >>"${OUT_FILE}"
  echo '```' >>"${OUT_FILE}"
  echo '```text' >>"${OUT_FILE}"
  set +e
  "$@" >"${tmp_file}" 2>&1
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
  echo "# TAP Issuer SLA + Reconcile Demo Transcript"
  echo
  echo "- generatedAtUtc: ${STAMP}"
  echo "- apiBaseUrl: ${API_BASE_URL}"
  echo "- resetDemoState: ${RESET_DEMO_STATE}"
  echo
  echo "## Expected Outcomes"
  echo
  echo "- Dual approval + reason code policy is enforced for issuer mint requests."
  echo "- Settlement is rejected before quorum and accepted after quorum."
  echo "- Reconcile run repairs an intentionally drifted settlement status."
  echo
} >"${OUT_FILE}"

if [[ "${RESET_DEMO_STATE}" == "1" ]]; then
  capture "Reset Demo State" curl -s -X POST "${API_BASE_URL}/api/v1/admin/demo/reset" \
    -H "Authorization: Bearer ${ADMIN_API_KEY}" \
    -H 'content-type: application/json' \
    -d '{}'
fi

capture "Run Issuer SLA + Reconcile Demo" "${ROOT_DIR}/scripts/run_issuer_sla_reconcile_demo.sh"
capture "Recent Settlements" curl -s "${API_BASE_URL}/api/v1/settlement/recent"
capture "Issuer Requests" curl -s "${API_BASE_URL}/api/v1/issuer/requests" -H "Authorization: Bearer ${ADMIN_API_KEY}"
capture "Reconcile Audit" curl -s "${API_BASE_URL}/api/v1/reliability/settlement-reconcile/audit?limit=10" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"

{
  echo "## Summary"
  echo
  echo "- passed: ${PASSED}"
  echo "- failed: ${FAILED}"
} >>"${OUT_FILE}"

if [[ "${REDACT_PUBLIC_COPY}" == "1" ]]; then
  REDACTED_FILE="${OUT_DIR}/issuer-sla-reconcile-demo-${STAMP}.public.md"
  sed -E \
    -e 's/\b(0x)?[a-f0-9]{16,}\b/<redacted-hash>/g' \
    -e 's/\b(mint|burn|set|evt|prf)_[0-9]+_[a-z0-9]+\b/<redacted-id>/g' \
    "${OUT_FILE}" >"${REDACTED_FILE}"
  echo "redacted transcript written: ${REDACTED_FILE}"
fi

echo "transcript written: ${OUT_FILE}"
