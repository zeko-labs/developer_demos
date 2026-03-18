#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <bundle_dir>" >&2
  exit 1
fi

BUNDLE_DIR="$1"
if [[ ! -d "${BUNDLE_DIR}" ]]; then
  echo "error: bundle dir not found: ${BUNDLE_DIR}" >&2
  exit 1
fi

MANIFEST_JSON="${BUNDLE_DIR}/MANIFEST.json"
MANIFEST_SHA="${BUNDLE_DIR}/MANIFEST.sha256"

if [[ ! -f "${MANIFEST_JSON}" ]]; then
  echo "error: missing manifest: ${MANIFEST_JSON}" >&2
  exit 1
fi
if [[ ! -f "${MANIFEST_SHA}" ]]; then
  echo "error: missing manifest checksum: ${MANIFEST_SHA}" >&2
  exit 1
fi

if command -v openssl >/dev/null 2>&1; then
  ACTUAL_MANIFEST_SHA="$(openssl dgst -sha256 -r "${MANIFEST_JSON}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_MANIFEST_SHA="$(shasum -a 256 "${MANIFEST_JSON}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_MANIFEST_SHA="$(sha256sum "${MANIFEST_JSON}" | awk '{print $1}')"
else
  echo "error: no sha256 tool available" >&2
  exit 1
fi
EXPECTED_MANIFEST_SHA="$(awk '{print $1}' "${MANIFEST_SHA}")"

if [[ "${ACTUAL_MANIFEST_SHA}" != "${EXPECTED_MANIFEST_SHA}" ]]; then
  echo "error: manifest checksum mismatch" >&2
  exit 1
fi

node - <<'NODE' "${BUNDLE_DIR}" "${MANIFEST_JSON}"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const bundleDir = process.argv[2];
const manifestPath = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.entries)) {
  console.error('error: malformed MANIFEST.json');
  process.exit(2);
}

for (const entry of manifest.entries) {
  if (!entry || typeof entry !== 'object') continue;
  const rel = entry.path;
  const expected = entry.sha256;
  if (typeof rel !== 'string' || typeof expected !== 'string') {
    console.error('error: malformed manifest entry');
    process.exit(3);
  }
  const filePath = path.join(bundleDir, rel);
  if (!fs.existsSync(filePath)) {
    console.error(`error: missing file from manifest: ${rel}`);
    process.exit(4);
  }
  const bytes = fs.readFileSync(filePath);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    console.error(`error: file checksum mismatch: ${rel}`);
    process.exit(5);
  }
}
NODE

if [[ -f "${BUNDLE_DIR}/certification/index.json" ]]; then
  node - <<'NODE' "${BUNDLE_DIR}/certification/index.json"
const fs = require('fs');
const p = process.argv[2];
const index = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!index?.latest) {
  console.error('error: certification index missing latest');
  process.exit(2);
}
if (index.latest.status !== 'pass') {
  console.error(`error: certification latest status is not pass: ${String(index.latest.status)}`);
  process.exit(3);
}
NODE
fi

if [[ -d "${BUNDLE_DIR}/transcripts/public-pack" ]]; then
  FAILED=0
  while IFS= read -r file; do
    if grep -q "^- failed: " "${file}"; then
      count="$(awk -F': ' '/^- failed: /{print $2}' "${file}" | tail -n 1)"
      if [[ -n "${count}" && "${count}" != "0" ]]; then
        echo "error: transcript failed count not zero: ${file}" >&2
        FAILED=1
      fi
    fi
  done < <(find "${BUNDLE_DIR}/transcripts/public-pack" -maxdepth 1 -type f -name '*.md' | sort)
  if [[ "${FAILED}" != "0" ]]; then
    exit 1
  fi
fi

echo "verified bundle: ${BUNDLE_DIR}"
