#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <transcript.md>" >&2
  exit 1
fi

FILE="$1"
if [[ ! -f "${FILE}" ]]; then
  echo "error: transcript not found: ${FILE}" >&2
  exit 1
fi

FAILED_COUNT="$(awk -F': ' '/^- failed: /{print $2}' "${FILE}" | tail -n 1)"
if [[ -z "${FAILED_COUNT}" ]]; then
  echo "error: transcript missing summary failed count: ${FILE}" >&2
  exit 1
fi

if [[ "${FAILED_COUNT}" != "0" ]]; then
  echo "error: transcript has failed steps (${FAILED_COUNT}): ${FILE}" >&2
  exit 1
fi

NON_ZERO_EXIT_LINES="$(grep -E '\[exit_code=[0-9]+\]' "${FILE}" | grep -v '\[exit_code=0\]' || true)"
if [[ -n "${NON_ZERO_EXIT_LINES}" ]]; then
  echo "error: transcript contains non-zero exit codes: ${FILE}" >&2
  echo "${NON_ZERO_EXIT_LINES}" >&2
  exit 1
fi

SHA256=""
if command -v openssl >/dev/null 2>&1; then
  SHA256="$(openssl dgst -sha256 -r "${FILE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "${FILE}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "${FILE}" | awk '{print $1}')"
fi

echo "verified: ${FILE}"
if [[ -n "${SHA256}" ]]; then
  echo "sha256: ${SHA256}"
fi
