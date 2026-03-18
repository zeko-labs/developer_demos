#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT_FILE="${OUT_DIR}/dual-asset-flagship-demo-${STAMP}.md"
RESET_LOCAL_STATE="${RESET_LOCAL_STATE:-1}"
REDACT_PUBLIC_COPY="${REDACT_PUBLIC_COPY:-1}"

mkdir -p "${OUT_DIR}"

PASSED=0
FAILED=0

if ! curl -fsS "${API_BASE_URL}/api/v1/health" >/dev/null 2>&1; then
  echo "error: API is not reachable at ${API_BASE_URL}"
  echo "start the API first or use ./scripts/run_dual_asset_flagship_pack.sh"
  exit 1
fi

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
  echo "# TAP Dual-Asset Flagship Demo Transcript"
  echo
  echo "- generatedAtUtc: ${STAMP}"
  echo "- apiBaseUrl: ${API_BASE_URL}"
  echo "- resetLocalState: ${RESET_LOCAL_STATE}"
  echo
  echo "## Expected Outcomes"
  echo
  echo "- Stablecoin mint and burn require maker-checker approval before settlement."
  echo "- Tokenized stock issue, allocate, restrict, and redeem require maker-checker approval before settlement."
  echo "- Both stablecoin and stock lifecycle records persist policy-linked settlement metadata."
  echo "- The resulting recent settlements show one shared control plane across cash and risk assets."
  echo
} >"${OUT_FILE}"

capture "Reset Demo State" curl -s -X POST "${API_BASE_URL}/api/v1/admin/demo/reset" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H 'content-type: application/json' \
  -d '{}'
capture "Health Check" curl -s "${API_BASE_URL}/api/v1/health"
capture "Bootstrap Policy" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh"
capture "Run Stablecoin Maker-Checker Demo" "${ROOT_DIR}/scripts/run_maker_checker_demo.sh"
capture "Run Tokenized Stock Lifecycle Demo" "${ROOT_DIR}/scripts/run_stock_lifecycle_demo.sh"
capture "Recent Settlements" curl -s "${API_BASE_URL}/api/v1/settlement/recent"
capture "All Issuer Requests" curl -s "${API_BASE_URL}/api/v1/issuer/requests" -H "Authorization: Bearer ${CHECKER_API_KEY:-checker_key}"

{
  echo "## Summary"
  echo
  echo "- passed: ${PASSED}"
  echo "- failed: ${FAILED}"
} >>"${OUT_FILE}"

if [[ "${REDACT_PUBLIC_COPY}" == "1" ]]; then
  REDACTED_FILE="${OUT_DIR}/dual-asset-flagship-demo-${STAMP}.public.md"
  sed -E \
    -e 's/\b(0x)?[a-f0-9]{16,}\b/<redacted-hash>/g' \
    -e 's/\b(mint|burn|issue|allocate|restrict|redeem|set|evt|prf)_[0-9]+_[a-z0-9]+\b/<redacted-id>/g' \
    "${OUT_FILE}" >"${REDACTED_FILE}"
  echo "redacted transcript written: ${REDACTED_FILE}"
fi

echo "transcript written: ${OUT_FILE}"
