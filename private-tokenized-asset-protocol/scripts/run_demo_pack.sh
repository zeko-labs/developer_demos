#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"

echo "[1/4] Generating policy-linkage transcripts..."
POLICY_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL:-http://localhost:7001}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}" \
  RESET_DEMO_STATE="${RESET_DEMO_STATE:-1}" \
  "${ROOT_DIR}/scripts/generate_policy_demo_transcript.sh"
)"
echo "${POLICY_OUTPUT}"
LATEST_POLICY="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'policy-linkage-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_POLICY}"

echo "[2/4] Generating maker-checker transcripts..."
MC_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL:-http://localhost:7001}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}" \
  MAKER_API_KEY="${MAKER_API_KEY:-maker_key}" \
  CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}" \
  RESET_LOCAL_STATE="${RESET_LOCAL_STATE:-1}" \
  REDACT_PUBLIC_COPY="${REDACT_PUBLIC_COPY:-1}" \
  "${ROOT_DIR}/scripts/generate_maker_checker_transcript.sh"
)"
echo "${MC_OUTPUT}"
LATEST_MC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'maker-checker-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_MC}"

echo "[3/4] Generating zk-mode transcript..."
ZK_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL:-http://localhost:7001}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}" \
  RESET_DEMO_STATE="${RESET_DEMO_STATE:-1}" \
  "${ROOT_DIR}/scripts/generate_zk_mode_transcript.sh"
)"
echo "${ZK_OUTPUT}"
LATEST_ZK="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'zk-mode-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_ZK}"

echo "[4/5] Generating stock lifecycle transcript..."
STOCK_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL:-http://localhost:7001}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}" \
  MAKER_API_KEY="${MAKER_API_KEY:-maker_key}" \
  CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}" \
  RESET_LOCAL_STATE="${RESET_LOCAL_STATE:-1}" \
  REDACT_PUBLIC_COPY="${REDACT_PUBLIC_COPY:-1}" \
  "${ROOT_DIR}/scripts/generate_stock_lifecycle_transcript.sh"
)"
echo "${STOCK_OUTPUT}"
LATEST_STOCK="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'stock-lifecycle-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_STOCK}"

echo "[5/5] Generating real o1js runtime transcript..."
ZK_RUNTIME_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL:-http://localhost:7001}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}" \
  RESET_DEMO_STATE="${RESET_DEMO_STATE:-1}" \
  "${ROOT_DIR}/scripts/generate_zk_o1js_runtime_transcript.sh"
)"
echo "${ZK_RUNTIME_OUTPUT}"
LATEST_ZK_RUNTIME="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'zk-o1js-runtime-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_ZK_RUNTIME}"

echo "demo pack complete. transcripts are in ${OUT_DIR}"
