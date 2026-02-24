#!/usr/bin/env bash
set -euo pipefail

APP1_DIR="/Users/evankereiakes/Documents/Codex/app1"
CODEX_DIR="/Users/evankereiakes/Documents/Codex"
TARGET_REPO_URL="https://github.com/zeko-labs/developer_demos.git"
TARGET_REPO_DIR="$CODEX_DIR/developer_demos"
TARGET_SUBDIR="agent_coordination_protocol-financial_intelligence"
BRANCH_NAME="${1:-sync-agent-coordination-protocol}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required but not installed." >&2
  exit 1
fi

echo "[1/8] Updating app1 main..."
cd "$APP1_DIR"
git checkout main
git pull

if [ ! -d "$TARGET_REPO_DIR/.git" ]; then
  echo "[2/8] Cloning developer_demos..."
  cd "$CODEX_DIR"
  git clone "$TARGET_REPO_URL" developer_demos
fi

echo "[3/8] Updating developer_demos main..."
cd "$TARGET_REPO_DIR"
git checkout main
git pull

echo "[4/8] Creating sync branch: $BRANCH_NAME"
git checkout -B "$BRANCH_NAME"

echo "[5/8] Replacing target folder..."
rm -rf "$TARGET_SUBDIR"
mkdir -p "$TARGET_SUBDIR"

echo "[6/8] Syncing files..."
rsync -av \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  "$APP1_DIR/" \
  "$TARGET_SUBDIR/"

echo "[7/8] Committing changes (if any)..."
git add "$TARGET_SUBDIR"
if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "Sync latest agent coordination protocol demo"

echo "[8/8] Pushing branch..."
git push -u origin "$BRANCH_NAME"

echo "Done. Open a PR from '$BRANCH_NAME' into 'main' in zeko-labs/developer_demos."
