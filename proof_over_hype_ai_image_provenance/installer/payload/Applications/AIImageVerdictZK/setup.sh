#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "== AI Image Verdict ZK setup =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node 20 (LTS): https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ required. Please install Node 20 (LTS): https://nodejs.org"
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
  else
    cat > .env <<'ENVEOF'
ZEKO_GRAPHQL=https://sepolia.zeko.io/graphql
ZEKO_NETWORK_ID=testnet
TX_FEE=100000000

# Required for on-chain submit
ZKAPP_PUBLIC_KEY=PASTE_DEPLOYED_ZKAPP_PUBLIC_KEY
ZKAPP_PRIVATE_KEY=PASTE_ZKAPP_PRIVATE_KEY
SUBMITTER_PRIVATE_KEY=PASTE_FEE_PAYER_PRIVATE_KEY

# AI detector (Sightengine)
AI_DETECTOR_PROVIDER=sightengine
AI_DETECTOR_USER=YOUR_API_USER
AI_DETECTOR_SECRET=YOUR_API_SECRET
ENVEOF
    echo "Created .env template"
  fi
fi

echo "Installing dependencies..."

if command -v npm >/dev/null 2>&1; then
  npm install
else
  echo "npm not found. Please install Node.js from https://nodejs.org"
  exit 1
fi

echo "Setup complete."

echo "Next steps:"

echo "1) Edit .env and fill in your keys."

echo "2) Start the app: npm run dev"
