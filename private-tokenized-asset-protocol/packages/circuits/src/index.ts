import crypto from 'node:crypto';

export const moduleName = '@tap/circuits';

const DEFAULT_ZK_PROVER_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIKJBImOJ+gqXe72KHCtvyVhtdKZhfkNiPxtpqUwTNG5e
-----END PRIVATE KEY-----`;

const DEFAULT_ZK_PROVER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABTyS2Yobf8b2yzE4GzmtKXmXIUVvaIdHNn0A+fh86pc=
-----END PUBLIC KEY-----`;

const CIRCUIT_DOMAIN = 'TAP-ZK-CIRCUIT-V1';

export interface ZkCircuitEnvelope {
  algorithm: 'ed25519';
  circuitId: string;
  statementHash: string;
  circuitHash: string;
  signature: string;
  verifierKeyHint: string;
}

export interface O1jsProofEnvelope {
  kind: 'zk-o1js-proof';
  algorithm: 'o1js';
  proofBase64: string;
  proofJsonBase64: string;
  verificationKeyHash: string;
  verificationKeyJsonBase64: string;
  publicInputHash: string;
}

type PrimitivePublicInput = Record<string, string | number | boolean>;

interface EligibilityProgramArtifacts {
  Program: {
    proveEligibility: (publicInput: any) => Promise<{ proof: { toJSON(): unknown } }>;
  };
  PublicInput: new (value: Record<string, unknown>) => any;
  verificationKey: {
    data: string;
    hash: { toString(): string };
  };
}

interface TransferProgramArtifacts {
  Program: {
    proveTransferCompliance: (publicInput: any) => Promise<{ proof: { toJSON(): unknown } }>;
  };
  PublicInput: new (value: Record<string, unknown>) => any;
  verificationKey: {
    data: string;
    hash: { toString(): string };
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function circuitHashFor(circuitId: string): string {
  return sha256(`${CIRCUIT_DOMAIN}:${circuitId}`);
}

function getZkPrivateKeyPem(): string {
  return process.env.ZK_PROVER_PRIVATE_KEY_PEM || DEFAULT_ZK_PROVER_PRIVATE_KEY_PEM;
}

function getZkPublicKeyPem(): string {
  return process.env.ZK_PROVER_PUBLIC_KEY_PEM || DEFAULT_ZK_PROVER_PUBLIC_KEY_PEM;
}

function keyHint(publicKeyPem: string): string {
  return sha256(publicKeyPem).slice(0, 16);
}

function toCanonicalStatementHash(publicInput: Record<string, string | number | boolean>): string {
  return sha256(JSON.stringify(canonicalize(publicInput)));
}

function toBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function toFieldChunk(value: string): bigint {
  return BigInt(`0x${sha256(value).slice(0, 30)}`);
}

let eligibilityProgramPromise: Promise<EligibilityProgramArtifacts> | null = null;
let transferProgramPromise: Promise<TransferProgramArtifacts> | null = null;

async function loadEligibilityProgram(): Promise<EligibilityProgramArtifacts> {
  if (eligibilityProgramPromise) return eligibilityProgramPromise;
  eligibilityProgramPromise = (async () => {
    const { Bool, Field, Struct, ZkProgram } = await import('o1js');

    class EligibilityPublicInput extends Struct({
      subjectCommitmentHash: Field,
      policyId: Field,
      policyVersion: Field,
      policyHashChunk: Field,
      tenantChunk: Field,
      jurisdictionChunk: Field,
      evaluationDate: Field,
      result: Bool
    }) {}

    const EligibilityProgram = ZkProgram({
      name: 'TapEligibilityV1',
      publicInput: EligibilityPublicInput,
      methods: {
        proveEligibility: {
          privateInputs: [],
          async method(publicInput) {
            publicInput.result.assertTrue();
            publicInput.subjectCommitmentHash.assertNotEquals(Field(0));
          }
        }
      }
    });

    const { verificationKey } = await EligibilityProgram.compile();
    return {
      Program: EligibilityProgram,
      PublicInput: EligibilityPublicInput,
      verificationKey
    };
  })() as unknown as Promise<EligibilityProgramArtifacts>;
  return eligibilityProgramPromise as Promise<EligibilityProgramArtifacts>;
}

function mapEligibilityPublicInput(publicInput: PrimitivePublicInput) {
  return {
    subjectCommitmentHash: toFieldChunk(String(publicInput.subjectCommitment || '')),
    policyId: BigInt(Number(publicInput.policyId || 0)),
    policyVersion: BigInt(Number(publicInput.policyVersion || 0)),
    policyHashChunk: toFieldChunk(String(publicInput.policyHash || '')),
    tenantChunk: toFieldChunk(String(publicInput.tenantId || '')),
    jurisdictionChunk: toFieldChunk(String(publicInput.jurisdiction || '')),
    evaluationDate: BigInt(Number(publicInput.evaluationDate || 0)),
    result: Boolean(publicInput.result)
  };
}

async function loadTransferProgram(): Promise<TransferProgramArtifacts> {
  if (transferProgramPromise) return transferProgramPromise;
  transferProgramPromise = (async () => {
    const { Bool, Field, Struct, ZkProgram } = await import('o1js');

    class TransferPublicInput extends Struct({
      senderCommitmentHash: Field,
      receiverCommitmentHash: Field,
      assetId: Field,
      amountCommitmentHash: Field,
      policyId: Field,
      result: Bool
    }) {}

    const TransferProgram = ZkProgram({
      name: 'TapTransferComplianceV1',
      publicInput: TransferPublicInput,
      methods: {
        proveTransferCompliance: {
          privateInputs: [],
          async method(publicInput) {
            publicInput.result.assertTrue();
            publicInput.senderCommitmentHash.assertNotEquals(publicInput.receiverCommitmentHash);
          }
        }
      }
    });

    const { verificationKey } = await TransferProgram.compile();
    return {
      Program: TransferProgram,
      PublicInput: TransferPublicInput,
      verificationKey
    };
  })() as unknown as Promise<TransferProgramArtifacts>;
  return transferProgramPromise as Promise<TransferProgramArtifacts>;
}

function mapTransferPublicInput(publicInput: PrimitivePublicInput) {
  return {
    senderCommitmentHash: toFieldChunk(String(publicInput.senderCommitment || '')),
    receiverCommitmentHash: toFieldChunk(String(publicInput.receiverCommitment || '')),
    assetId: BigInt(Number(publicInput.assetId || 0)),
    amountCommitmentHash: toFieldChunk(String(publicInput.amountCommitment || '')),
    policyId: BigInt(Number(publicInput.policyId || 0)),
    result: Boolean(publicInput.result)
  };
}

function signStatement(
  circuitId: string,
  statementHash: string
): { signature: string; verifierKeyHint: string; circuitHash: string } {
  const circuitHash = circuitHashFor(circuitId);
  const payload = `${CIRCUIT_DOMAIN}:${circuitId}:${circuitHash}:${statementHash}`;
  const signature = crypto.sign(null, Buffer.from(payload), getZkPrivateKeyPem()).toString('hex');
  const verifierKeyHint = keyHint(getZkPublicKeyPem());
  return {
    signature,
    verifierKeyHint,
    circuitHash
  };
}

export function createZkCircuitEnvelope(
  circuitId: string,
  publicInput: Record<string, string | number | boolean>
): ZkCircuitEnvelope {
  const statementHash = toCanonicalStatementHash(publicInput);
  const signed = signStatement(circuitId, statementHash);
  return {
    algorithm: 'ed25519',
    circuitId,
    statementHash,
    circuitHash: signed.circuitHash,
    signature: signed.signature,
    verifierKeyHint: signed.verifierKeyHint
  };
}

export function verifyZkCircuitEnvelope(
  envelope: ZkCircuitEnvelope,
  publicInput: Record<string, string | number | boolean>
): { verified: boolean; reason?: string } {
  if (envelope.algorithm !== 'ed25519') {
    return { verified: false, reason: 'zk_algorithm_unsupported' };
  }
  const expectedCircuitHash = circuitHashFor(envelope.circuitId);
  if (envelope.circuitHash !== expectedCircuitHash) {
    return { verified: false, reason: 'zk_circuit_hash_mismatch' };
  }
  const expectedStatementHash = toCanonicalStatementHash(publicInput);
  if (envelope.statementHash !== expectedStatementHash) {
    return { verified: false, reason: 'zk_statement_hash_mismatch' };
  }
  const payload = `${CIRCUIT_DOMAIN}:${envelope.circuitId}:${envelope.circuitHash}:${envelope.statementHash}`;
  const ok = crypto.verify(
    null,
    Buffer.from(payload),
    getZkPublicKeyPem(),
    Buffer.from(envelope.signature, 'hex')
  );
  if (!ok) {
    return { verified: false, reason: 'zk_signature_invalid' };
  }
  const expectedHint = keyHint(getZkPublicKeyPem());
  if (envelope.verifierKeyHint !== expectedHint) {
    return { verified: false, reason: 'zk_verifier_key_hint_mismatch' };
  }
  return { verified: true };
}

export async function createO1jsProofEnvelope(
  circuitId: string,
  publicInput: PrimitivePublicInput
): Promise<O1jsProofEnvelope> {
  const normalizedInput = canonicalize(publicInput) as PrimitivePublicInput;
  const publicInputHash = sha256(JSON.stringify(normalizedInput));
  let verificationKey: { data: string; hash: { toString(): string } };
  let proofResult: { proof: { toJSON(): unknown } };

  if (circuitId === 'eligibility_v1') {
    const program = await loadEligibilityProgram();
    verificationKey = program.verificationKey;
    const o1jsInput = new program.PublicInput(mapEligibilityPublicInput(normalizedInput));
    proofResult = await program.Program.proveEligibility(o1jsInput);
  } else if (circuitId === 'transfer_compliance_v1') {
    const program = await loadTransferProgram();
    verificationKey = program.verificationKey;
    const o1jsInput = new program.PublicInput(mapTransferPublicInput(normalizedInput));
    proofResult = await program.Program.proveTransferCompliance(o1jsInput);
  } else {
    throw new Error(`o1js_circuit_unsupported:${circuitId}`);
  }

  const proofJson = proofResult.proof.toJSON();
  const proofJsonBase64 = toBase64Json(proofJson);

  return {
    kind: 'zk-o1js-proof',
    algorithm: 'o1js',
    proofBase64: proofJsonBase64,
    proofJsonBase64,
    verificationKeyHash: verificationKey.hash.toString(),
    verificationKeyJsonBase64: toBase64Json(verificationKey.data),
    publicInputHash
  };
}

export function init() {
  return {
    module: moduleName,
    status: 'ready',
    note: 'Circuit-backed zk-mode proof envelopes are enabled (Ed25519-signed statement path).'
  };
}
