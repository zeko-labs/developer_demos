#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <report.json>" >&2
  exit 1
fi

REPORT="$1"
if [[ ! -f "${REPORT}" ]]; then
  echo "error: report not found: ${REPORT}" >&2
  exit 1
fi

SHA_FILE="${REPORT}.sha256"
SIG_FILE="${REPORT}.sig"
SIGNING_KEY="${CERT_SIGNING_KEY:-${TAP_CERTIFICATION_SIGNING_KEY:-}}"

if [[ ! -f "${SHA_FILE}" ]]; then
  echo "error: missing checksum file: ${SHA_FILE}" >&2
  exit 1
fi

if command -v openssl >/dev/null 2>&1; then
  ACTUAL_SHA="$(openssl dgst -sha256 -r "${REPORT}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "${REPORT}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "${REPORT}" | awk '{print $1}')"
else
  echo "error: no sha256 tool available" >&2
  exit 1
fi

EXPECTED_SHA="$(awk '{print $1}' "${SHA_FILE}")"
if [[ -z "${EXPECTED_SHA}" ]]; then
  echo "error: malformed checksum file: ${SHA_FILE}" >&2
  exit 1
fi

if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
  echo "error: checksum mismatch" >&2
  echo "expected: ${EXPECTED_SHA}" >&2
  echo "actual:   ${ACTUAL_SHA}" >&2
  exit 1
fi

if [[ -f "${SIG_FILE}" ]]; then
  if [[ -z "${SIGNING_KEY}" ]]; then
    echo "error: signature file present but signing key not provided (CERT_SIGNING_KEY or TAP_CERTIFICATION_SIGNING_KEY)" >&2
    exit 1
  fi
  EXPECTED_SIG="$(tr -d '\n\r' < "${SIG_FILE}")"
  ACTUAL_SIG="$(printf '%s' "${ACTUAL_SHA}" | openssl dgst -sha256 -hmac "${SIGNING_KEY}" -r | awk '{print $1}')"
  if [[ "${EXPECTED_SIG}" != "${ACTUAL_SIG}" ]]; then
    echo "error: signature mismatch" >&2
    exit 1
  fi
  echo "verified: ${REPORT}"
  echo "sha256: ${ACTUAL_SHA}"
  echo "signature: valid"
  exit 0
fi

echo "verified: ${REPORT}"
echo "sha256: ${ACTUAL_SHA}"
echo "signature: not present"
