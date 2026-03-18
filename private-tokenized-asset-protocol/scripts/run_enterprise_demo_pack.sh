#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/output/demo-transcripts}"
PUBLIC_DIR="${PUBLIC_DIR:-${OUT_DIR}/public-pack}"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
MAKER_API_KEY="${MAKER_API_KEY:-maker_key}"
CHECKER_API_KEY="${CHECKER_API_KEY:-checker_key}"
PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN:-}"
INCREASE_ACCOUNT_ID="${INCREASE_ACCOUNT_ID:-}"
PERSONA_ENABLED="${PERSONA_ENABLED:-0}"
CUSTODY_ENABLED="${CUSTODY_ENABLED:-0}"
CUSTOMER_SANDBOX_ENABLED="${CUSTOMER_SANDBOX_ENABLED:-1}"

if [[ -z "${PLAID_ACCESS_TOKEN}" ]]; then
  echo "error: PLAID_ACCESS_TOKEN is required for enterprise demo pack."
  exit 1
fi

mkdir -p "${OUT_DIR}"
mkdir -p "${PUBLIC_DIR}"

echo "[1/8] Generating policy-linkage transcript..."
POLICY_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  RESET_DEMO_STATE=1 \
  "${ROOT_DIR}/scripts/generate_policy_demo_transcript.sh"
)"
echo "${POLICY_OUTPUT}"
LATEST_POLICY="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'policy-linkage-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_POLICY}"

echo "[2/10] Generating maker-checker transcript..."
MC_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  MAKER_API_KEY="${MAKER_API_KEY}" \
  CHECKER_API_KEY="${CHECKER_API_KEY}" \
  RESET_LOCAL_STATE=1 \
  REDACT_PUBLIC_COPY=1 \
  "${ROOT_DIR}/scripts/generate_maker_checker_transcript.sh"
)"
echo "${MC_OUTPUT}"
LATEST_MC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'maker-checker-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_MC}"

echo "[3/10] Generating issuer-sla+reconcile transcript..."
SLA_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  MAKER_API_KEY="${MAKER_API_KEY}" \
  CHECKER_API_KEY="${CHECKER_API_KEY}" \
  CHECKER2_API_KEY="${CHECKER2_API_KEY:-checker2_key}" \
  RESET_DEMO_STATE=1 \
  REDACT_PUBLIC_COPY=1 \
  "${ROOT_DIR}/scripts/generate_issuer_sla_reconcile_transcript.sh"
)"
echo "${SLA_OUTPUT}"
LATEST_SLA="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'issuer-sla-reconcile-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_SLA}"

echo "[4/10] Generating partner-adapter-certification transcript..."
CERT_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  TENANT_API_KEY="${TENANT_API_KEY}" \
  RESET_DEMO_STATE=1 \
  REDACT_PUBLIC_COPY=1 \
  "${ROOT_DIR}/scripts/generate_partner_adapter_certification_transcript.sh"
)"
echo "${CERT_OUTPUT}"
LATEST_CERT="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'partner-adapter-certification-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_CERT}"

if [[ "${PERSONA_ENABLED}" == "1" ]]; then
  echo "[optional] Generating persona identity transcript via isolated reference pack..."
  PERSONA_OUTPUT="$(
    ADMIN_API_KEY="${ADMIN_API_KEY}" \
    TENANT_API_KEY="${TENANT_API_KEY}" \
    PERSONA_API_KEY="${PERSONA_API_KEY:-persona_mock_api_key}" \
    PERSONA_WEBHOOK_SECRET="${PERSONA_WEBHOOK_SECRET:-persona_mock_webhook_secret}" \
    "${ROOT_DIR}/scripts/run_persona_identity_demo_pack.sh"
  )"
  echo "${PERSONA_OUTPUT}"
  LATEST_PERSONA="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'persona-identity-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
else
  LATEST_PERSONA=""
fi

if [[ "${CUSTODY_ENABLED}" == "1" ]]; then
  echo "[optional] Generating holdings custody transcript via isolated reference pack..."
  CUSTODY_OUTPUT="$(
    ADMIN_API_KEY="${ADMIN_API_KEY}" \
    TENANT_API_KEY="${TENANT_API_KEY}" \
    CUSTODY_API_KEY="${CUSTODY_API_KEY:-custody_mock_api_key}" \
    CUSTODY_WEBHOOK_SECRET="${CUSTODY_WEBHOOK_SECRET:-custody_mock_webhook_secret}" \
    "${ROOT_DIR}/scripts/run_holdings_custody_demo_pack.sh"
  )"
  echo "${CUSTODY_OUTPUT}"
  LATEST_CUSTODY="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'holdings-custody-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
else
  LATEST_CUSTODY=""
fi

if [[ "${CUSTOMER_SANDBOX_ENABLED}" == "1" ]]; then
  echo "[optional] Generating customer-owned dual-asset transcript via isolated customer pack..."
  CUSTOMER_OUTPUT="$(
    ADMIN_API_KEY="${ADMIN_API_KEY}" \
    TENANT_API_KEY="${TENANT_API_KEY}" \
    "${ROOT_DIR}/scripts/run_customer_dual_asset_demo_pack.sh"
  )"
  echo "${CUSTOMER_OUTPUT}"
  LATEST_CUSTOMER="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'customer-dual-asset-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
else
  LATEST_CUSTOMER=""
fi

echo "[5/10] Generating plaid transcript..."
PLAID_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  TENANT_API_KEY="${TENANT_API_KEY}" \
  PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN}" \
  RESET_DEMO_STATE=1 \
  REDACT_PUBLIC_COPY=1 \
  "${ROOT_DIR}/scripts/generate_plaid_demo_transcript.sh"
)"
echo "${PLAID_OUTPUT}"
LATEST_PLAID="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'plaid-balance-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_PLAID}"

if [[ -n "${INCREASE_ACCOUNT_ID}" ]]; then
  echo "[optional] Generating increase transcript..."
  INCREASE_OUTPUT="$(
    API_BASE_URL="${API_BASE_URL}" \
    ADMIN_API_KEY="${ADMIN_API_KEY}" \
    TENANT_API_KEY="${TENANT_API_KEY}" \
    INCREASE_ACCOUNT_ID="${INCREASE_ACCOUNT_ID}" \
    RESET_DEMO_STATE=1 \
    "${ROOT_DIR}/scripts/generate_increase_demo_transcript.sh"
  )"
  echo "${INCREASE_OUTPUT}"
  LATEST_INCREASE="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'increase-balance-demo-*.md' | sort | tail -n 1)"
  "${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_INCREASE}"
else
  LATEST_INCREASE=""
fi

echo "[6/10] Generating stock lifecycle transcript..."
STOCK_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  MAKER_API_KEY="${MAKER_API_KEY}" \
  CHECKER_API_KEY="${CHECKER_API_KEY}" \
  RESET_LOCAL_STATE=1 \
  REDACT_PUBLIC_COPY=1 \
  "${ROOT_DIR}/scripts/generate_stock_lifecycle_transcript.sh"
)"
echo "${STOCK_OUTPUT}"
LATEST_STOCK="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'stock-lifecycle-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_STOCK}"

echo "[7/11] Generating dual-asset flagship transcript..."
FLAGSHIP_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  MAKER_API_KEY="${MAKER_API_KEY}" \
  CHECKER_API_KEY="${CHECKER_API_KEY}" \
  RESET_LOCAL_STATE=1 \
  REDACT_PUBLIC_COPY=1 \
  "${ROOT_DIR}/scripts/generate_dual_asset_flagship_transcript.sh"
)"
echo "${FLAGSHIP_OUTPUT}"
LATEST_FLAGSHIP="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'dual-asset-flagship-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_FLAGSHIP}"

echo "[8/11] Generating zkTLS source-collect transcript..."
ZKTLS_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  TENANT_API_KEY="${TENANT_API_KEY}" \
  TENANT_ID="tenant-a" \
  POLICY_ID="1" \
  RESET_DEMO_STATE=1 \
  "${ROOT_DIR}/scripts/generate_zktls_source_collect_transcript.sh"
)"
echo "${ZKTLS_OUTPUT}"
LATEST_ZKTLS="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'zktls-source-collect-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_ZKTLS}"

echo "[9/11] Generating zkTLS bank source-collect transcript..."
ZKTLS_BANK_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  TENANT_API_KEY="${TENANT_API_KEY}" \
  TENANT_ID="tenant-a" \
  POLICY_ID="1" \
  RUN_PIPELINE_FIRST=1 \
  RESET_DEMO_STATE=1 \
  bash "${ROOT_DIR}/scripts/generate_zktls_bank_source_collect_transcript.sh"
)"
echo "${ZKTLS_BANK_OUTPUT}"
LATEST_ZKTLS_BANK="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'zktls-bank-source-collect-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_ZKTLS_BANK}"

echo "[10/11] Generating real o1js runtime transcript..."
ZK_RUNTIME_OUTPUT="$(
  API_BASE_URL="${API_BASE_URL}" \
  ADMIN_API_KEY="${ADMIN_API_KEY}" \
  RESET_DEMO_STATE=1 \
  "${ROOT_DIR}/scripts/generate_zk_o1js_runtime_transcript.sh"
)"
echo "${ZK_RUNTIME_OUTPUT}"
LATEST_ZK_RUNTIME="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'zk-o1js-runtime-demo-*.md' | grep -v '\.public\.md$' | sort | tail -n 1)"
"${ROOT_DIR}/scripts/verify_transcript.sh" "${LATEST_ZK_RUNTIME}"

echo "[11/11] Building public-only artifact pack..."
LATEST_FLAGSHIP_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'dual-asset-flagship-demo-*.public.md' | sort | tail -n 1)"
LATEST_MC_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'maker-checker-demo-*.public.md' | sort | tail -n 1)"
LATEST_SLA_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'issuer-sla-reconcile-demo-*.public.md' | sort | tail -n 1)"
LATEST_CERT_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'partner-adapter-certification-demo-*.public.md' | sort | tail -n 1)"
LATEST_PLAID_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'plaid-balance-demo-*.public.md' | sort | tail -n 1)"
LATEST_STOCK_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'stock-lifecycle-demo-*.public.md' | sort | tail -n 1)"
LATEST_PERSONA_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'persona-identity-demo-*.public.md' | sort | tail -n 1)"
LATEST_CUSTODY_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'holdings-custody-demo-*.public.md' | sort | tail -n 1)"
LATEST_CUSTOMER_PUBLIC="$(find "${OUT_DIR}" -maxdepth 1 -type f -name 'customer-dual-asset-demo-*.public.md' | sort | tail -n 1)"
cp "${LATEST_FLAGSHIP_PUBLIC}" "${PUBLIC_DIR}/"
cp "${LATEST_FLAGSHIP_PUBLIC}" "${PUBLIC_DIR}/flagship-dual-asset-latest.public.md"
cp "${LATEST_MC_PUBLIC}" "${PUBLIC_DIR}/"
cp "${LATEST_SLA_PUBLIC}" "${PUBLIC_DIR}/"
cp "${LATEST_CERT_PUBLIC}" "${PUBLIC_DIR}/"
cp "${LATEST_PLAID_PUBLIC}" "${PUBLIC_DIR}/"
cp "${LATEST_STOCK_PUBLIC}" "${PUBLIC_DIR}/"
if [[ "${PERSONA_ENABLED}" == "1" && -n "${LATEST_PERSONA_PUBLIC}" ]]; then
  cp "${LATEST_PERSONA_PUBLIC}" "${PUBLIC_DIR}/"
fi
if [[ "${CUSTODY_ENABLED}" == "1" && -n "${LATEST_CUSTODY_PUBLIC}" ]]; then
  cp "${LATEST_CUSTODY_PUBLIC}" "${PUBLIC_DIR}/"
fi
if [[ "${CUSTOMER_SANDBOX_ENABLED}" == "1" && -n "${LATEST_CUSTOMER_PUBLIC}" ]]; then
  cp "${LATEST_CUSTOMER_PUBLIC}" "${PUBLIC_DIR}/"
  cp "${LATEST_CUSTOMER_PUBLIC}" "${PUBLIC_DIR}/customer-owned-dual-asset-latest.public.md"
fi
if [[ -n "${LATEST_INCREASE}" ]]; then
  cp "${LATEST_INCREASE}" "${PUBLIC_DIR}/"
fi
cp "${LATEST_POLICY}" "${PUBLIC_DIR}/"
cp "${LATEST_ZKTLS}" "${PUBLIC_DIR}/"
cp "${LATEST_ZKTLS_BANK}" "${PUBLIC_DIR}/"
cp "${LATEST_ZK_RUNTIME}" "${PUBLIC_DIR}/"
FLAGSHIP_FILE="${PUBLIC_DIR}/flagship-dual-asset-latest.public.md" \
POLICY_FILE="${LATEST_POLICY}" \
MAKER_FILE="${LATEST_MC_PUBLIC}" \
STOCK_FILE="${LATEST_STOCK_PUBLIC}" \
PLAID_FILE="${LATEST_PLAID_PUBLIC}" \
PERSONA_FILE="${LATEST_PERSONA_PUBLIC}" \
CUSTODY_FILE="${LATEST_CUSTODY_PUBLIC}" \
CUSTOMER_FILE="${LATEST_CUSTOMER_PUBLIC}" \
SLA_FILE="${LATEST_SLA_PUBLIC}" \
CERT_FILE="${LATEST_CERT_PUBLIC}" \
ZKTLS_FILE="${LATEST_ZKTLS}" \
ZKTLS_BANK_FILE="${LATEST_ZKTLS_BANK}" \
ZK_RUNTIME_FILE="${LATEST_ZK_RUNTIME}" \
INCREASE_FILE="${LATEST_INCREASE}" \
PUBLIC_DIR="${PUBLIC_DIR}" \
"${ROOT_DIR}/scripts/write_public_pack_readme.sh"

echo "enterprise demo pack complete:"
echo "  public pack dir: ${PUBLIC_DIR}"
echo "  included:"
echo "    - $(basename "${LATEST_FLAGSHIP_PUBLIC}") [flagship]"
echo "    - $(basename "${LATEST_POLICY}")"
echo "    - $(basename "${LATEST_MC_PUBLIC}")"
echo "    - $(basename "${LATEST_SLA_PUBLIC}")"
echo "    - $(basename "${LATEST_CERT_PUBLIC}")"
echo "    - $(basename "${LATEST_PLAID_PUBLIC}")"
echo "    - $(basename "${LATEST_STOCK_PUBLIC}")"
if [[ "${PERSONA_ENABLED}" == "1" && -n "${LATEST_PERSONA_PUBLIC}" ]]; then
  echo "    - $(basename "${LATEST_PERSONA_PUBLIC}")"
fi
if [[ "${CUSTODY_ENABLED}" == "1" && -n "${LATEST_CUSTODY_PUBLIC}" ]]; then
  echo "    - $(basename "${LATEST_CUSTODY_PUBLIC}")"
fi
if [[ "${CUSTOMER_SANDBOX_ENABLED}" == "1" && -n "${LATEST_CUSTOMER_PUBLIC}" ]]; then
  echo "    - $(basename "${LATEST_CUSTOMER_PUBLIC}") [customer-sandbox]"
fi
if [[ -n "${LATEST_INCREASE}" ]]; then
  echo "    - $(basename "${LATEST_INCREASE}")"
fi
echo "    - $(basename "${LATEST_ZKTLS}")"
echo "    - $(basename "${LATEST_ZKTLS_BANK}")"
echo "    - $(basename "${LATEST_ZK_RUNTIME}")"

if [[ -f "${ROOT_DIR}/output/certification/index.json" ]]; then
  echo "verifying certification manifest..."
  "${ROOT_DIR}/scripts/verify_certification_manifest.sh" "${ROOT_DIR}/output/certification"
fi

if [[ "${BUILD_RELEASE_AUDIT_BUNDLE:-0}" == "1" ]]; then
  echo "building release audit bundle..."
  TRANSCRIPTS_DIR="${OUT_DIR}" \
  PUBLIC_PACK_DIR="${PUBLIC_DIR}" \
  CERT_DIR="${ROOT_DIR}/output/certification" \
  "${ROOT_DIR}/scripts/run_release_audit_bundle.sh"
fi
