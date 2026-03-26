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
  echo "Let's configure your .env now."
  read -r -p "Zeko GraphQL (default https://testnet.zeko.io): " ZEKO_GRAPHQL
  ZEKO_GRAPHQL=${ZEKO_GRAPHQL:-https://testnet.zeko.io}
  read -r -p "Network ID (default testnet): " ZEKO_NETWORK_ID
  ZEKO_NETWORK_ID=${ZEKO_NETWORK_ID:-testnet}
  read -r -p "TX fee in nanomina (default 100000000): " TX_FEE
  TX_FEE=${TX_FEE:-100000000}

  read -r -p "ZKAPP_PUBLIC_KEY: " ZKAPP_PUBLIC_KEY
  read -r -p "ZKAPP_PRIVATE_KEY: " ZKAPP_PRIVATE_KEY
  read -r -p "SUBMITTER_PRIVATE_KEY (fee payer): " SUBMITTER_PRIVATE_KEY

  read -r -p "AI detector provider (default sightengine): " AI_DETECTOR_PROVIDER
  AI_DETECTOR_PROVIDER=${AI_DETECTOR_PROVIDER:-sightengine}
  read -r -p "Sightengine API user (leave blank if not using): " AI_DETECTOR_USER
  read -r -p "Sightengine API secret (leave blank if not using): " AI_DETECTOR_SECRET

  cat > .env <<ENVEOF
ZEKO_GRAPHQL=${ZEKO_GRAPHQL}
ZEKO_NETWORK_ID=${ZEKO_NETWORK_ID}
TX_FEE=${TX_FEE}

# Required for on-chain submit
ZKAPP_PUBLIC_KEY=${ZKAPP_PUBLIC_KEY}
ZKAPP_PRIVATE_KEY=${ZKAPP_PRIVATE_KEY}
SUBMITTER_PRIVATE_KEY=${SUBMITTER_PRIVATE_KEY}

# AI detector
AI_DETECTOR_PROVIDER=${AI_DETECTOR_PROVIDER}
AI_DETECTOR_USER=${AI_DETECTOR_USER}
AI_DETECTOR_SECRET=${AI_DETECTOR_SECRET}
ENVEOF

  echo "Created .env with your entries."
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
