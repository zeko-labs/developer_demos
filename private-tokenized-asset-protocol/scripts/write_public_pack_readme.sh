#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="${PUBLIC_DIR:-${ROOT_DIR}/output/demo-transcripts/public-pack}"
README_FILE="${PUBLIC_DIR}/README.md"

mkdir -p "${PUBLIC_DIR}"

FLAGSHIP_FILE="${FLAGSHIP_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'flagship-dual-asset-latest.public.md' | sort | tail -n 1)}"
POLICY_FILE="${POLICY_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'policy-linkage-demo-*.md' | sort | tail -n 1)}"
MAKER_FILE="${MAKER_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'maker-checker-demo-*.public.md' | sort | tail -n 1)}"
STOCK_FILE="${STOCK_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'stock-lifecycle-demo-*.public.md' | sort | tail -n 1)}"
PLAID_FILE="${PLAID_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'plaid-balance-demo-*.public.md' | sort | tail -n 1)}"
PERSONA_FILE="${PERSONA_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'persona-identity-demo-*.public.md' | sort | tail -n 1)}"
CUSTODY_FILE="${CUSTODY_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'holdings-custody-demo-*.public.md' | sort | tail -n 1)}"
CUSTOMER_FILE="${CUSTOMER_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f \\( -name 'customer-owned-dual-asset-latest.public.md' -o -name 'customer-dual-asset-demo-*.public.md' \\) | sort | tail -n 1)}"
SLA_FILE="${SLA_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'issuer-sla-reconcile-demo-*.public.md' | sort | tail -n 1)}"
CERT_FILE="${CERT_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'partner-adapter-certification-demo-*.public.md' | sort | tail -n 1)}"
ZKTLS_FILE="${ZKTLS_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'zktls-source-collect-demo-*.md' | sort | tail -n 1)}"
ZKTLS_BANK_FILE="${ZKTLS_BANK_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'zktls-bank-source-collect-demo-*.md' | sort | tail -n 1)}"
ZK_RUNTIME_FILE="${ZK_RUNTIME_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'zk-o1js-runtime-demo-*.md' | sort | tail -n 1)}"
INCREASE_FILE="${INCREASE_FILE:-$(find "${PUBLIC_DIR}" -maxdepth 1 -type f -name 'increase-balance-demo-*.md' | sort | tail -n 1)}"

basename_or_na() {
  local path="${1:-}"
  if [[ -n "${path}" && -f "${path}" ]]; then
    basename "${path}"
  else
    echo "not included"
  fi
}

{
  echo "# Public Pack"
  echo
  echo "This folder contains redacted demo artifacts that are safe to share externally."
  echo
  echo "## Read First"
  echo
  echo "- \`$(basename_or_na "${FLAGSHIP_FILE}")\`"
  echo
  echo "This is the headline artifact."
  echo
  echo "It shows the dual-asset market story:"
  echo
  echo "- stablecoin as the private cash leg"
  echo "- tokenized stock as the private risk-asset leg"
  echo "- one shared policy, proof, approval, and settlement control plane"
  echo
  echo "## Supporting Artifacts"
  echo
  echo "- policy linkage: \`$(basename_or_na "${POLICY_FILE}")\`"
  echo "- stablecoin maker-checker: \`$(basename_or_na "${MAKER_FILE}")\`"
  echo "- stock lifecycle: \`$(basename_or_na "${STOCK_FILE}")\`"
  echo "- plaid reference adapter: \`$(basename_or_na "${PLAID_FILE}")\`"
  if [[ -n "${PERSONA_FILE}" && -f "${PERSONA_FILE}" ]]; then
    echo "- identity reference adapter: \`$(basename_or_na "${PERSONA_FILE}")\`"
  fi
  if [[ -n "${CUSTODY_FILE}" && -f "${CUSTODY_FILE}" ]]; then
    echo "- holdings reference adapter: \`$(basename_or_na "${CUSTODY_FILE}")\`"
  fi
  if [[ -n "${CUSTOMER_FILE}" && -f "${CUSTOMER_FILE}" ]]; then
    echo "- customer-owned sandbox path: \`$(basename_or_na "${CUSTOMER_FILE}")\`"
  fi
  echo "- issuer sla and reconcile: \`$(basename_or_na "${SLA_FILE}")\`"
  echo "- partner adapter certification: \`$(basename_or_na "${CERT_FILE}")\`"
  echo "- zkTLS source collect: \`$(basename_or_na "${ZKTLS_FILE}")\`"
  echo "- zkTLS bank source collect: \`$(basename_or_na "${ZKTLS_BANK_FILE}")\`"
  echo "- real o1js runtime: \`$(basename_or_na "${ZK_RUNTIME_FILE}")\`"
  if [[ -n "${INCREASE_FILE}" && -f "${INCREASE_FILE}" ]]; then
    echo "- bank-style reference adapter: \`$(basename_or_na "${INCREASE_FILE}")\`"
  fi
  echo
  echo "## How To Use This Folder"
  echo
  echo "1. Start with the flagship transcript."
  echo "2. Then read the customer-owned sandbox path if someone asks how TAP maps onto a real bank integration."
  echo "3. Use the other supporting artifacts only if someone wants to drill into a specific subsystem."
  echo "4. For customer conversations, pair this folder with:"
  echo "   - \`docs/flagship-demo-plan.md\`"
  echo "   - \`docs/flagship-runbook.md\`"
  echo "   - \`docs/provider-strategy.md\`"
  echo
  echo "## Commercial Position"
  echo
  echo "These are reference artifacts."
  echo
  echo "The repo is provider-agnostic. The flagship file shows the product. The customer-owned sandbox file shows the integration path. The real next step with a bank or partner is to wire the PoC to their own sandbox or internal systems."
} >"${README_FILE}"

echo "public pack readme written: ${README_FILE}"
