import crypto from 'node:crypto';

export function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

export function sha256Hex(value) {
  const material = typeof value === 'string' ? value : canonicalize(value);
  return crypto.createHash('sha256').update(material).digest('hex');
}

export function hashHex(value) {
  return `0x${sha256Hex(value)}`;
}

export function buildVerifierSignPayload({
  requestHash,
  statementHash,
  commitmentHash,
  decision,
  verifierId,
  role,
  auditNetwork,
  chainId,
  expiresAt
}) {
  return canonicalize({
    requestHash: requestHash ?? null,
    statementHash: statementHash ?? null,
    commitmentHash: commitmentHash ?? null,
    decision: decision ?? null,
    verifierId: verifierId ?? null,
    role: role ?? null,
    auditNetwork: auditNetwork ?? null,
    chainId: chainId ?? null,
    expiresAt: expiresAt ?? null
  });
}
