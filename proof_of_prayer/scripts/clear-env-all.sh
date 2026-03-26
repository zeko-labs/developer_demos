#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/Users/evankereiakes/Documents/Codex/app/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "No .env file found."
  exit 0
fi

> "$ENV_FILE"

echo "Cleared all .env keys."
