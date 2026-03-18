#!/bin/bash
set -eEuo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -n "${RUN_POC_TLSN_ENDPOINT_OVERRIDE:-}" ]; then
  export TLSN_ENDPOINT="${RUN_POC_TLSN_ENDPOINT_OVERRIDE}"
fi

RUN_ID="$(date +%Y-%m-%dT%H-%M-%S)"
export OUTPUT_DIR="$(pwd)/output/${RUN_ID}"

SERVICE_READY_TIMEOUT_SEC="${RUN_POC_SERVICE_READY_TIMEOUT_SEC:-30}"
SERVICE_READY_POLL_INTERVAL_SEC="${RUN_POC_SERVICE_READY_POLL_INTERVAL_SEC:-1}"
SKIP_READY_CHECK="${RUN_POC_SKIP_READY_CHECK:-0}"
MOCK_SERVER_HOST="${TLSN_SERVER_HOST:-127.0.0.1}"
MOCK_SERVER_PORT="${TLSN_SERVER_PORT:-4443}"
NOTARY_HOST="${TLSN_NOTARY_HOST:-127.0.0.1}"
NOTARY_PORT="${TLSN_NOTARY_PORT:-7047}"
MOON_BIN_CMD="${MOON_BIN:-moon}"
CURRENT_STEP="bootstrap"

wait_for_tcp() {
  local host=$1
  local port=$2
  local label=$3

  if [ "$SKIP_READY_CHECK" = "1" ]; then
    echo "[run-poc] skipping readiness check for ${label} (${host}:${port})"
    sleep 0.1
    return 0
  fi

  local deadline=$((SECONDS + SERVICE_READY_TIMEOUT_SEC))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
      return 0
    fi
    sleep "$SERVICE_READY_POLL_INTERVAL_SEC"
  done

  echo "[run-poc] ${label} did not become ready on ${host}:${port} within ${SERVICE_READY_TIMEOUT_SEC}s" >&2
  return 1
}

is_port_listening() {
  local port=$1

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -Eq "[\\.:]${port}[[:space:]].*LISTEN"
    return $?
  fi

  return 1
}

wait_for_listen_port() {
  local port=$1
  local label=$2

  if [ "$SKIP_READY_CHECK" = "1" ]; then
    echo "[run-poc] skipping readiness check for ${label} (listen port ${port})"
    sleep 0.1
    return 0
  fi

  local deadline=$((SECONDS + SERVICE_READY_TIMEOUT_SEC))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if is_port_listening "$port"; then
      return 0
    fi
    if [ -n "${NOTARY_PID:-}" ] && ! kill -0 "$NOTARY_PID" 2>/dev/null; then
      echo "[run-poc] ${label} exited before opening listen port ${port}" >&2
      return 1
    fi
    sleep "$SERVICE_READY_POLL_INTERVAL_SEC"
  done

  echo "[run-poc] ${label} did not open listen port ${port} within ${SERVICE_READY_TIMEOUT_SEC}s" >&2
  return 1
}

cleanup() {
  local exit_code=$?

  if [ -n "${MOCK_PID:-}" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi

  if [ -n "${NOTARY_PID:-}" ] && kill -0 "$NOTARY_PID" 2>/dev/null; then
    kill "$NOTARY_PID" 2>/dev/null || true
    wait "$NOTARY_PID" 2>/dev/null || true
  fi

  echo "[run-poc] cleanup complete"
  return "$exit_code"
}

on_error() {
  local exit_code=$1
  echo "[run-poc] failed at step: ${CURRENT_STEP}" >&2
  return "$exit_code"
}

trap cleanup EXIT
trap 'on_error $?' ERR

echo ""
echo "========================================="
echo "  zkVerify PoC - End-to-End Pipeline"
echo "  Output: ${OUTPUT_DIR}"
echo "========================================="
echo ""

echo "[1/7] Starting mock employer HTTPS server (TLS 1.2)..."
CURRENT_STEP="mock-server:serve"
"${MOON_BIN_CMD}" run mock-server:serve &
MOCK_PID=$!
wait_for_tcp "$MOCK_SERVER_HOST" "$MOCK_SERVER_PORT" "mock-server:serve"
echo "       -> Listening on https://${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT}"
echo ""

echo "[2/7] Running TLSNotary attestation..."
CURRENT_STEP="tlsnotary:notary"
"${MOON_BIN_CMD}" run tlsnotary:notary &
NOTARY_PID=$!
wait_for_listen_port "$NOTARY_PORT" "tlsnotary:notary"
CURRENT_STEP="tlsnotary:prover"
"${MOON_BIN_CMD}" run tlsnotary:prover
echo "       -> Saved: ${OUTPUT_DIR}/attestation.json"
echo ""

echo "[3/7] Extracting attested fields..."
CURRENT_STEP="poc:extract"
"${MOON_BIN_CMD}" run poc:extract
echo "       -> Saved: ${OUTPUT_DIR}/disclosed-fields.json"
echo ""

echo "[4/7] Generating ZK proof (o1js)..."
echo "       -> Compiling circuit... (this takes ~60-120s)"
CURRENT_STEP="poc:prove"
"${MOON_BIN_CMD}" run poc:prove
echo "       -> Saved: ${OUTPUT_DIR}/proof.json, ${OUTPUT_DIR}/verification-key.json"
echo ""

echo "[5/7] Verifying proof locally..."
CURRENT_STEP="poc:verify"
"${MOON_BIN_CMD}" run poc:verify
echo ""

echo "[6/7] Posting proof to Zeko testnet..."
CURRENT_STEP="poc:settle"
"${MOON_BIN_CMD}" run poc:settle
echo ""

echo "[7/7] Verifying on-chain state via GraphQL node..."
CURRENT_STEP="poc:verify-chain"
"${MOON_BIN_CMD}" run poc:verify-chain
echo ""

echo "✅ End-to-end pipeline complete."
