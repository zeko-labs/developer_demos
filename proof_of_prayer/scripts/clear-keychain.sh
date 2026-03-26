#!/usr/bin/env bash
set -euo pipefail

SERVICE_ZKAPP="AIImageVerdictZK_ZKAPP_PRIVATE_KEY"
SERVICE_SUBMITTER="AIImageVerdictZK_SUBMITTER_PRIVATE_KEY"

security delete-generic-password -a "$USER" -s "$SERVICE_ZKAPP" >/dev/null 2>&1 || true
security delete-generic-password -a "$USER" -s "$SERVICE_SUBMITTER" >/dev/null 2>&1 || true

echo "Cleared Keychain entries for AIImageVerdictZK."
