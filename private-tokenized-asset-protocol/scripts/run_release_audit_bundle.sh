#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRANSCRIPTS_DIR="${TRANSCRIPTS_DIR:-${ROOT_DIR}/output/demo-transcripts}"
PUBLIC_PACK_DIR="${PUBLIC_PACK_DIR:-${TRANSCRIPTS_DIR}/public-pack}"
CERT_DIR="${CERT_DIR:-${ROOT_DIR}/output/certification}"
BUNDLES_DIR="${BUNDLES_DIR:-${ROOT_DIR}/output/release-bundles}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
BUNDLE_ID="release-audit-${STAMP}"
BUNDLE_DIR="${BUNDLES_DIR}/${BUNDLE_ID}"
INCLUDE_PRIVATE_TRANSCRIPTS="${INCLUDE_PRIVATE_TRANSCRIPTS:-0}"

if [[ ! -d "${PUBLIC_PACK_DIR}" ]]; then
  echo "error: missing public transcript pack dir: ${PUBLIC_PACK_DIR}" >&2
  echo "hint: run ./scripts/run_enterprise_demo_pack.sh first" >&2
  exit 1
fi

if [[ ! -d "${CERT_DIR}" ]]; then
  echo "error: missing certification dir: ${CERT_DIR}" >&2
  echo "hint: run ./scripts/run_partner_adapter_certification.sh first" >&2
  exit 1
fi

mkdir -p "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}/transcripts/public-pack"
mkdir -p "${BUNDLE_DIR}/certification"

echo "[1/5] Verifying certification manifest..."
"${ROOT_DIR}/scripts/verify_certification_manifest.sh" "${CERT_DIR}"

echo "[2/5] Copying public transcripts..."
cp -R "${PUBLIC_PACK_DIR}/." "${BUNDLE_DIR}/transcripts/public-pack/"

if [[ "${INCLUDE_PRIVATE_TRANSCRIPTS}" == "1" ]]; then
  echo "[3/5] Including private transcripts..."
  mkdir -p "${BUNDLE_DIR}/transcripts/private"
  find "${TRANSCRIPTS_DIR}" -maxdepth 1 -type f -name '*.md' ! -name '*.public.md' -exec cp {} "${BUNDLE_DIR}/transcripts/private/" \;
else
  echo "[3/5] Skipping private transcripts (INCLUDE_PRIVATE_TRANSCRIPTS=${INCLUDE_PRIVATE_TRANSCRIPTS})..."
fi

echo "[4/5] Copying certification artifacts..."
cp -R "${CERT_DIR}/." "${BUNDLE_DIR}/certification/"

echo "[5/5] Building manifest + tarball..."
node - <<'NODE' "${BUNDLE_DIR}" "${BUNDLE_ID}"
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const bundleDir = process.argv[2];
const bundleId = process.argv[3];

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'MANIFEST.json' || entry.name === 'MANIFEST.sha256') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = await walk(bundleDir);
files.sort();
const entries = [];
for (const filePath of files) {
  const rel = path.relative(bundleDir, filePath);
  const bytes = await fs.readFile(filePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  entries.push({
    path: rel,
    bytes: bytes.length,
    sha256
  });
}
const manifest = {
  bundleId,
  generatedAtUtc: new Date().toISOString(),
  fileCount: entries.length,
  entries
};
const manifestPath = path.join(bundleDir, 'MANIFEST.json');
const manifestJson = JSON.stringify(manifest, null, 2);
await fs.writeFile(manifestPath, manifestJson, 'utf8');
const manifestSha = crypto.createHash('sha256').update(manifestJson).digest('hex');
await fs.writeFile(path.join(bundleDir, 'MANIFEST.sha256'), `${manifestSha}  MANIFEST.json\n`, 'utf8');
NODE

TARBALL="${BUNDLES_DIR}/${BUNDLE_ID}.tar.gz"
tar -czf "${TARBALL}" -C "${BUNDLES_DIR}" "${BUNDLE_ID}"

echo "release audit bundle ready:"
echo "  bundle dir: ${BUNDLE_DIR}"
echo "  tarball: ${TARBALL}"
echo "  manifest: ${BUNDLE_DIR}/MANIFEST.json"
