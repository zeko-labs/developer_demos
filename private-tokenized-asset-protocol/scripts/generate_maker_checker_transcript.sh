#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT_FILE="${OUT_DIR}/maker-checker-demo-${STAMP}.md"
RESET_LOCAL_STATE="${RESET_LOCAL_STATE:-1}"
REDACT_PUBLIC_COPY="${REDACT_PUBLIC_COPY:-1}"

mkdir -p "${OUT_DIR}"

PASSED=0
FAILED=0

reset_local_state() {
  if [[ "${RESET_LOCAL_STATE}" != "1" ]]; then
    return
  fi
  capture "Reset Demo State" curl -s -X POST "${API_BASE_URL}/api/v1/admin/demo/reset" \
    -H "Authorization: Bearer ${ADMIN_API_KEY}" \
    -H 'content-type: application/json' \
    -d '{}'
}

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
  echo "# TAP Maker-Checker Demo Transcript"
  echo
  echo "- generatedAtUtc: ${STAMP}"
  echo "- apiBaseUrl: ${API_BASE_URL}"
  echo "- resetLocalState: ${RESET_LOCAL_STATE}"
  echo
  echo "## Expected Outcomes"
  echo
  echo "- Mint settlement is rejected before checker approval."
  echo "- Mint settlement succeeds after checker approval."
  echo "- Burn settlement is rejected before checker approval."
  echo "- Burn settlement succeeds after checker approval."
  echo "- Settlement metadata includes maker/checker + policy snapshot linkage."
  echo
} >"${OUT_FILE}"

reset_local_state

capture "Health Check" curl -s "${API_BASE_URL}/api/v1/health"
capture "Bootstrap Policy" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh"
capture "Run Maker-Checker Demo (Mint + Burn)" "${ROOT_DIR}/scripts/run_maker_checker_demo.sh"
capture "Recent Settlements" curl -s "${API_BASE_URL}/api/v1/settlement/recent"
capture "Issuer Requests" curl -s "${API_BASE_URL}/api/v1/issuer/requests" -H "Authorization: Bearer ${CHECKER_API_KEY:-checker_key}"

{
  echo "## Summary"
  echo
  echo "- passed: ${PASSED}"
  echo "- failed: ${FAILED}"
} >>"${OUT_FILE}"

if [[ "${REDACT_PUBLIC_COPY}" == "1" ]]; then
  REDACTED_FILE="${OUT_DIR}/maker-checker-demo-${STAMP}.public.md"
  sed -E \
    -e 's/\b(0x)?[a-f0-9]{16,}\b/<redacted-hash>/g' \
    -e 's/\b(mint|burn|set|evt|prf)_[0-9]+_[a-z0-9]+\b/<redacted-id>/g' \
    "${OUT_FILE}" >"${REDACTED_FILE}"
  echo "redacted transcript written: ${REDACTED_FILE}"
fi

echo "transcript written: ${OUT_FILE}"
