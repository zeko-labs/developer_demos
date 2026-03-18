#!/bin/bash
set -euo pipefail

export POC_SOURCE_PROFILE="bank"
export RUN_POC_TLSN_ENDPOINT_OVERRIDE="${RUN_POC_BANK_ENDPOINT:-/api/v1/accounts/balance?account_id=BANK-001}"

echo "[run-poc-bank] source profile: ${POC_SOURCE_PROFILE}"
echo "[run-poc-bank] endpoint: ${RUN_POC_TLSN_ENDPOINT_OVERRIDE}"

./run-poc.sh
