#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${1:-${ROOT_DIR}/output/certification}"
INDEX_FILE="${CERT_DIR}/index.json"
VERIFY_SCRIPT="${ROOT_DIR}/scripts/verify_certification_artifact.sh"
REQUIRE_PASS="${REQUIRE_PASS:-1}"

if [[ ! -f "${INDEX_FILE}" ]]; then
  echo "error: certification index not found: ${INDEX_FILE}" >&2
  exit 1
fi

REPORTS=()
while IFS= read -r line; do
  REPORTS+=("${line}")
done < <(node - <<'NODE' "${INDEX_FILE}" "${CERT_DIR}"
const fs = require('fs');
const path = require('path');
const indexPath = process.argv[2];
const certDir = process.argv[3];
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
if (!index || typeof index !== 'object') {
  process.exit(2);
}
const latest = index.latest;
if (!latest || typeof latest !== 'object') {
  process.exit(3);
}
if (process.env.REQUIRE_PASS !== '0' && latest.status !== 'pass') {
  console.error(`latest certification status is not pass: ${String(latest.status)}`);
  process.exit(4);
}
if (typeof latest.reportPath !== 'string' || !latest.reportPath) {
  process.exit(5);
}
const latestReport = path.join(certDir, latest.reportPath);
console.log(latestReport);
NODE
)

if [[ "${#REPORTS[@]}" -eq 0 ]]; then
  echo "error: no reports resolved from index: ${INDEX_FILE}" >&2
  exit 1
fi

for report in "${REPORTS[@]}"; do
  "${VERIFY_SCRIPT}" "${report}"
done

echo "verified certification manifest: ${INDEX_FILE}"
