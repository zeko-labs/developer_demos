#!/bin/bash
set -euo pipefail

PIPELINE_CMD_OVERRIDE="${RUN_POC_INELIGIBLE_PIPELINE_CMD:-}"
EXPECTED_FAIL_STEP="${RUN_POC_INELIGIBLE_EXPECTED_FAIL_STEP:-poc:prove}"
INELIGIBLE_ENDPOINT="${TLSN_INELIGIBLE_ENDPOINT:-/api/v1/employee/EMP-002}"
ELIGIBILITY_FAILURE_PATTERN="${RUN_POC_INELIGIBLE_FAILURE_PATTERN:-(salary .* below required minimum|tenure .* below required minimum|status hash mismatch)}"

export TLSN_ENDPOINT="$INELIGIBLE_ENDPOINT"
export RUN_POC_TLSN_ENDPOINT_OVERRIDE="$INELIGIBLE_ENDPOINT"

TMP_LOG="$(mktemp)"
cleanup() {
  rm -f "$TMP_LOG"
}
trap cleanup EXIT

run_pipeline() {
  if [ -z "$PIPELINE_CMD_OVERRIDE" ]; then
    ./run-poc.sh
    return
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[run-poc-ineligible] python3 is required to parse RUN_POC_INELIGIBLE_PIPELINE_CMD overrides with arguments" >&2
    return 127
  fi

  python3 - "$PIPELINE_CMD_OVERRIDE" <<'PY'
import shlex
import subprocess
import sys

command = sys.argv[1]

try:
    argv = shlex.split(command, posix=True)
except ValueError as exc:
    print(f"[run-poc-ineligible] invalid RUN_POC_INELIGIBLE_PIPELINE_CMD: {exc}", file=sys.stderr)
    sys.exit(2)

if not argv:
    print("[run-poc-ineligible] RUN_POC_INELIGIBLE_PIPELINE_CMD must not be empty", file=sys.stderr)
    sys.exit(2)

try:
    result = subprocess.run(argv, check=False)
except FileNotFoundError:
    print(f"[run-poc-ineligible] command not found: {argv[0]}", file=sys.stderr)
    sys.exit(127)

sys.exit(result.returncode)
PY
}

echo "[run-poc-ineligible] endpoint: ${TLSN_ENDPOINT}"
echo "[run-poc-ineligible] expected failure step: ${EXPECTED_FAIL_STEP}"

set +e
run_pipeline >"$TMP_LOG" 2>&1
PIPELINE_EXIT_CODE=$?
set -e

cat "$TMP_LOG"

if [ "$PIPELINE_EXIT_CODE" -eq 0 ]; then
  echo "[run-poc-ineligible] expected pipeline to fail for an ineligible user, but it succeeded" >&2
  exit 1
fi

if ! grep -Fq "[run-poc] failed at step: ${EXPECTED_FAIL_STEP}" "$TMP_LOG"; then
  echo "[run-poc-ineligible] expected failure step: ${EXPECTED_FAIL_STEP}" >&2
  exit 1
fi

if ! grep -Eq "$ELIGIBILITY_FAILURE_PATTERN" "$TMP_LOG"; then
  echo "[run-poc-ineligible] expected prove-stage eligibility rejection diagnostics" >&2
  exit 1
fi

echo "✅ Ineligible-user pipeline complete: proof rejected as expected."
