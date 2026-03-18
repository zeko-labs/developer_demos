#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_API_KEY="${TENANT_API_KEY:-tenant_a_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
POLICY_ID="${POLICY_ID:-1}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_partner_cert_001}"
CERT_OUTPUT_DIR="${CERT_OUTPUT_DIR:-${ROOT_DIR}/output/certification}"
CERT_SIGNING_KEY="${CERT_SIGNING_KEY:-${TAP_CERTIFICATION_SIGNING_KEY:-}}"
CERT_INDEX_MAX="${CERT_INDEX_MAX:-200}"

echo "[1/5] Health check..."
curl -s "${API_BASE_URL}/api/v1/health"
echo

echo "[2/5] Bootstrap policy/provider baseline..."
ADMIN_API_KEY="${ADMIN_API_KEY}" "${ROOT_DIR}/scripts/bootstrap_policy_seed.sh" >/dev/null

echo "[3/5] Ensure generic-rest provider config..."
curl -s -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H 'content-type: application/json' \
  -d '{
    "provider":"generic-rest",
    "enabled":true,
    "allowedHosts":["partner.example.com"],
    "quotaPerHour":1000,
    "mappingVersion":"v1",
    "authProfiles":{},
    "failoverProviders":[],
    "routingStrategy":"ordered",
    "routingWeight":0
  }'
echo

echo "[4/5] Running certification cases..."
pnpm --filter @tap/sdk build >/dev/null
node - <<'NODE'
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const base = process.env.API_BASE_URL || 'http://localhost:7001';
const tenantApiKey = process.env.TENANT_API_KEY || 'tenant_a_key';
const { TapClient, buildGenericRestCertificationCases, runPartnerAdapterCertification } = await import(
  './packages/sdk/dist/index.js'
);

const tenantId = process.env.TENANT_ID || 'tenant-a';
const policyId = Number(process.env.POLICY_ID || 1);
const subjectCommitment = process.env.SUBJECT_COMMITMENT || 'subj_partner_cert_001';
const certOutputDir = process.env.CERT_OUTPUT_DIR || './output/certification';
const certSigningKey = process.env.CERT_SIGNING_KEY || '';
const certIndexMax = Number(process.env.CERT_INDEX_MAX || 200);

const client = new TapClient(base, { apiKey: tenantApiKey });
const cases = buildGenericRestCertificationCases({
  tenantId,
  policyId,
  subjectCommitment,
  goodUrl: 'https://partner.example.com/unavailable'
});
const summary = await runPartnerAdapterCertification(cases, async (request) => {
  return client.collectSourceAttestation(request);
});
console.log(JSON.stringify(summary, null, 2));
await fs.mkdir(certOutputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = {
  generatedAtUtc: new Date().toISOString(),
  schemaVersion: 1,
  apiBaseUrl: base,
  tenantId,
  policyId,
  subjectCommitment,
  harness: 'sdk.partnerAdapterKit',
  summary,
  checks: summary.results.map((r) => ({
    id: r.id,
    passed: r.passed,
    detail: r.detail || null
  }))
};
const reportJson = JSON.stringify(report, null, 2);
const reportPath = path.join(certOutputDir, `partner-adapter-certification-${stamp}.json`);
await fs.writeFile(reportPath, reportJson, 'utf8');

const digest = crypto.createHash('sha256').update(reportJson).digest('hex');
const shaPath = `${reportPath}.sha256`;
await fs.writeFile(shaPath, `${digest}  ${path.basename(reportPath)}\n`, 'utf8');

let sigPath = null;
if (certSigningKey) {
  const sig = crypto.createHmac('sha256', certSigningKey).update(digest).digest('hex');
  sigPath = `${reportPath}.sig`;
  await fs.writeFile(sigPath, `${sig}\n`, 'utf8');
}

const indexPath = path.join(certOutputDir, 'index.json');
let existingIndex = { generatedAtUtc: null, latest: null, entries: [] };
try {
  const rawIndex = await fs.readFile(indexPath, 'utf8');
  const parsed = JSON.parse(rawIndex);
  if (parsed && typeof parsed === 'object') existingIndex = parsed;
} catch {}

const relReportPath = path.relative(certOutputDir, reportPath);
const relShaPath = path.relative(certOutputDir, shaPath);
const relSigPath = sigPath ? path.relative(certOutputDir, sigPath) : null;
const entry = {
  id: `cert_${stamp}`,
  generatedAtUtc: report.generatedAtUtc,
  tenantId,
  policyId,
  subjectCommitment,
  status: summary.summary.status,
  scorePercent: summary.summary.scorePercent,
  totals: {
    total: summary.summary.total,
    passed: summary.summary.passed,
    failed: summary.summary.failed
  },
  reportPath: relReportPath,
  sha256Path: relShaPath,
  signaturePath: relSigPath,
  sha256: digest
};
const priorEntries = Array.isArray(existingIndex.entries) ? existingIndex.entries : [];
const mergedEntries = [entry, ...priorEntries]
  .filter((v, idx, arr) => {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string') return false;
    return arr.findIndex((x) => x && typeof x === 'object' && x.id === v.id) === idx;
  })
  .slice(0, Number.isFinite(certIndexMax) && certIndexMax > 0 ? certIndexMax : 200);
const newIndex = {
  generatedAtUtc: new Date().toISOString(),
  latest: entry,
  entries: mergedEntries
};
await fs.writeFile(indexPath, JSON.stringify(newIndex, null, 2), 'utf8');
await fs.writeFile(path.join(certOutputDir, 'latest.json'), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      artifactReport: reportPath,
      artifactSha256: shaPath,
      artifactSignature: sigPath,
      artifactIndex: indexPath,
      artifactLatest: path.join(certOutputDir, 'latest.json'),
      digest
    },
    null,
    2
  )
);
if (summary.failed > 0) process.exit(1);
NODE

echo "[5/5] Certification passed."
