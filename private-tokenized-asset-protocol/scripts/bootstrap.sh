#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
fi

corepack enable
pnpm install

echo "Bootstrap complete. Run: pnpm dev"
