#!/usr/bin/env bash
set -euo pipefail

SERVICE_ZKAPP="AIImageVerdictZK_ZKAPP_PRIVATE_KEY"
SERVICE_SUBMITTER="AIImageVerdictZK_SUBMITTER_PRIVATE_KEY"

read -r -p "ZKAPP_PRIVATE_KEY: " ZKAPP_PRIVATE_KEY
read -r -p "SUBMITTER_PRIVATE_KEY (fee payer): " SUBMITTER_PRIVATE_KEY

security add-generic-password -a "$USER" -s "$SERVICE_ZKAPP" -w "$ZKAPP_PRIVATE_KEY" -U >/dev/null
security add-generic-password -a "$USER" -s "$SERVICE_SUBMITTER" -w "$SUBMITTER_PRIVATE_KEY" -U >/dev/null

echo "Stored keys in macOS Keychain."
