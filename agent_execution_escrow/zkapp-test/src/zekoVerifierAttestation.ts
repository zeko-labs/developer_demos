import 'reflect-metadata';
import { Bool, Field, Poseidon, PrivateKey, Provable, PublicKey, Signature, Struct } from 'o1js';

export const MAX_ZEKO_VERIFIERS = 5;
export const APPROVED_STATUS_CODE = 1;

const PLACEHOLDER_PRIVATE_KEY = PrivateKey.fromBase58('EKEXmBGnRTmQPfh792kSBzBQBYL7LDudgfcHwKEL1d6YVSwgBP2t');
const PLACEHOLDER_PUBLIC_KEY = PLACEHOLDER_PRIVATE_KEY.toPublicKey();

export class ZekoVerifierQuorum extends Struct({
  publicKeys: Provable.Array(PublicKey, MAX_ZEKO_VERIFIERS),
  signatures: Provable.Array(Signature, MAX_ZEKO_VERIFIERS),
  enabled: Provable.Array(Bool, MAX_ZEKO_VERIFIERS)
}) {}

export function emptyVerifierPublicKey() {
  return PLACEHOLDER_PUBLIC_KEY;
}

export function padVerifierPublicKeys(publicKeys: PublicKey[]) {
  const padded = [...publicKeys].slice(0, MAX_ZEKO_VERIFIERS);
  while (padded.length < MAX_ZEKO_VERIFIERS) padded.push(emptyVerifierPublicKey());
  return padded;
}

export function computeVerifierSetRoot(publicKeys: PublicKey[]) {
  const padded = padVerifierPublicKeys(publicKeys);
  return Poseidon.hash(padded.flatMap((key) => key.toFields()));
}

export function buildApprovalDomainCommitment(input: {
  verifierSetRoot: Field;
}) {
  return Poseidon.hash([input.verifierSetRoot]);
}

export function buildApprovalMessageFields(input: {
  intentHash: Field;
  quorumThreshold: Field;
  approvalDomainCommitment: Field;
}) {
  return [
    input.intentHash,
    Field(APPROVED_STATUS_CODE),
    input.quorumThreshold,
    input.approvalDomainCommitment
  ];
}

export function buildPlaceholderSignature(messageFields: Field[]) {
  return Signature.create(PLACEHOLDER_PRIVATE_KEY, messageFields);
}

export function buildVerifierQuorumInput(input: {
  registeredVerifierPublicKeys: PublicKey[];
  approvalSignatures: Array<{ verifierPublicKey: string; signature: string }>;
  messageFields: Field[];
}) {
  const signatureByPublicKey = new Map(
    input.approvalSignatures.map((item) => [String(item.verifierPublicKey), String(item.signature)])
  );
  const paddedKeys = padVerifierPublicKeys(input.registeredVerifierPublicKeys);
  const enabled = paddedKeys.map((publicKey) => {
    const key = publicKey.toBase58();
    return Bool(signatureByPublicKey.has(key));
  });
  const signatures = paddedKeys.map((publicKey) => {
    const signature = signatureByPublicKey.get(publicKey.toBase58());
    return signature ? Signature.fromBase58(signature) : buildPlaceholderSignature(input.messageFields);
  });
  const observedApprovals = enabled.reduce((count, flag) => count + (flag.toBoolean() ? 1 : 0), 0);
  return {
    quorum: new ZekoVerifierQuorum({
      publicKeys: paddedKeys,
      signatures,
      enabled
    }),
    observedApprovals
  };
}
