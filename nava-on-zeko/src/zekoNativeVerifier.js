import { Field, Poseidon, PublicKey, Signature } from 'o1js';

export const MAX_ZEKO_NATIVE_VERIFIERS = 5;
export const ZEKO_NATIVE_APPROVAL_AUTHORITY = 'zeko_native_verifiers';
export const EXTERNAL_WALLET_APPROVAL_AUTHORITY = 'external_wallet_signatures';

const PLACEHOLDER_PUBLIC_KEY = PublicKey.fromBase58(
  'B62qnC85bdScpiH8LqBq5kouhuAnk88dF8PPXXT9wvPmnPQdh1JXkTQ'
);

function normalizePublicKey(value) {
  try {
    return PublicKey.fromBase58(String(value || '').trim()).toBase58();
  } catch {
    return '';
  }
}

function fieldFromHex(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  if (!normalized) return Field(0);
  const entries = [];
  for (let index = 0; index < normalized.length; index += 2) {
    const chunk = normalized.slice(index, index + 2).padEnd(2, '0');
    entries.push(Field(Number.parseInt(chunk, 16)));
  }
  return Poseidon.hash(entries);
}

function padPublicKeys(publicKeys) {
  const padded = [...publicKeys].slice(0, MAX_ZEKO_NATIVE_VERIFIERS);
  while (padded.length < MAX_ZEKO_NATIVE_VERIFIERS) padded.push(PLACEHOLDER_PUBLIC_KEY);
  return padded;
}

export function computeZekoVerifierSetRoot(publicKeys) {
  const normalized = padPublicKeys(publicKeys.map((item) => (typeof item === 'string' ? PublicKey.fromBase58(item) : item)));
  return Poseidon.hash(normalized.flatMap((key) => key.toFields())).toString();
}

export function buildZekoApprovalDomainCommitment({ verifierSetRoot }) {
  return Poseidon.hash([Field(verifierSetRoot)]).toString();
}

export function normalizeZekoNativeVerifierRecord(input = {}, index = 0) {
  const zekoPublicKey = normalizePublicKey(input.zekoPublicKey || input.publicKey || input.address || '');
  if (!zekoPublicKey) return null;
  return {
    verifierId: String(input.verifierId || `zeko-verifier-${index + 1}`).trim(),
    zekoPublicKey,
    ethereumAddress: typeof input.ethereumAddress === 'string' ? input.ethereumAddress : null,
    role: String(input.role || 'independent_verifier').trim()
  };
}

function parseRegistryConfig(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function getZekoNativeVerifierRegistry() {
  const configured = parseRegistryConfig(process.env.ZEKO_NATIVE_VERIFIERS || '');
  const verifiers = configured
    .map((item, index) => normalizeZekoNativeVerifierRecord(item, index))
    .filter(Boolean)
    .slice(0, MAX_ZEKO_NATIVE_VERIFIERS);
  const unique = [];
  const seen = new Set();
  for (const verifier of verifiers) {
    if (seen.has(verifier.zekoPublicKey)) continue;
    seen.add(verifier.zekoPublicKey);
    unique.push(verifier);
  }
  return {
    active: unique.length > 0,
    maxVerifiers: MAX_ZEKO_NATIVE_VERIFIERS,
    verifiers: unique,
    verifierPublicKeys: unique.map((item) => item.zekoPublicKey),
    verifierSetRoot: computeZekoVerifierSetRoot(unique.map((item) => item.zekoPublicKey))
  };
}

export function buildZekoNativeVerifierRegistrySnapshot() {
  const registry = getZekoNativeVerifierRegistry();
  if (!registry.active) return null;
  return {
    maxVerifiers: registry.maxVerifiers,
    verifierSetRoot: registry.verifierSetRoot,
    verifiers: registry.verifiers
  };
}

export function findRegisteredZekoNativeVerifier(publicKey, registry = getZekoNativeVerifierRegistry()) {
  const normalized = normalizePublicKey(publicKey);
  if (!normalized) return null;
  return registry.verifiers.find((item) => item.zekoPublicKey === normalized) || null;
}

export function buildZekoNativeApprovalFields({
  intentHash,
  quorumThreshold,
  approvalDomainCommitment
}) {
  return [
    Field(typeof intentHash === 'string' && /^\d+$/.test(intentHash) ? intentHash : fieldFromHex(intentHash)),
    Field(1),
    Field(quorumThreshold),
    Field(approvalDomainCommitment)
  ];
}

export function verifyZekoNativeApprovalSignature({ verifierPublicKey, signature, fields }) {
  try {
    const publicKey = PublicKey.fromBase58(String(verifierPublicKey));
    const parsedSignature = Signature.fromBase58(String(signature));
    return parsedSignature.verify(publicKey, fields).toBoolean();
  } catch {
    return false;
  }
}
