import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import type {
  EligibilityProofRequest,
  ProofEnvelope,
  ProofMode,
  TransferComplianceProofRequest
} from '@tap/shared-types';
import {
  createZkCircuitEnvelope,
  verifyZkCircuitEnvelope,
  type ZkCircuitEnvelope
} from '@tap/circuits';

const proofStore = new Map<string, ProofEnvelope>();

function nowIso() {
  return new Date().toISOString();
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function signDigest(digest: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(digest).digest('hex');
}

function normalizePublicInput(input: Record<string, string | number | boolean>) {
  const sorted = Object.keys(input)
    .sort()
    .reduce<Record<string, string | number | boolean>>((acc, key) => {
      acc[key] = input[key]!;
      return acc;
    }, {});
  return sorted;
}

function verifyO1jsProofExternal(
  proof: ProofEnvelope,
  normalizedInput: Record<string, string | number | boolean>
): { verified: boolean; reason?: string } {
  const publicInputHash = sha256(JSON.stringify(normalizedInput));
  const providedPublicInputHash = String(proof.proof.publicInputHash || '');
  if (providedPublicInputHash.length === 0) {
    return { verified: false, reason: 'zk_o1js_public_input_hash_missing' };
  }
  if (providedPublicInputHash !== publicInputHash) {
    return { verified: false, reason: 'zk_o1js_public_input_hash_mismatch' };
  }

  const verificationKeyHash = String(proof.proof.verificationKeyHash || '');
  if (verificationKeyHash.length === 0) {
    return { verified: false, reason: 'zk_o1js_verification_key_hash_missing' };
  }
  const expectedVkHash = process.env.ZK_O1JS_VERIFICATION_KEY_HASH;
  if (expectedVkHash && verificationKeyHash !== expectedVkHash) {
    return { verified: false, reason: 'zk_o1js_verification_key_hash_mismatch' };
  }

  const proofBase64 = String(proof.proof.proofBase64 || '');
  if (proofBase64.length === 0) {
    return { verified: false, reason: 'zk_o1js_proof_missing' };
  }
  try {
    Buffer.from(proofBase64, 'base64');
  } catch {
    return { verified: false, reason: 'zk_o1js_proof_malformed' };
  }

  const verifyCmd = process.env.ZK_O1JS_VERIFY_CMD;
  if (!verifyCmd) {
    return { verified: false, reason: 'zk_o1js_verifier_not_configured' };
  }

  try {
    const output = execSync(verifyCmd, {
      input: JSON.stringify({
        circuitId: proof.circuitId,
        publicInput: normalizedInput,
        proof: {
          ...proof.proof,
          proofBase64,
          verificationKeyHash,
          publicInputHash
        }
      }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const parsed = JSON.parse(String(output || '{}')) as { verified?: boolean; reason?: string };
    if (parsed.verified === true) return { verified: true };
    return {
      verified: false,
      reason: parsed.reason || 'zk_o1js_verify_failed'
    };
  } catch {
    return { verified: false, reason: 'zk_o1js_verify_command_failed' };
  }
}

function verifyZkTlsExternalProof(
  proof: ProofEnvelope,
  normalizedInput: Record<string, string | number | boolean>
): { verified: boolean; reason?: string } {
  if (String(proof.proof.source || '') !== 'zk-verify-poc') {
    return { verified: false, reason: 'zktls_source_unsupported' };
  }
  const runId = String(proof.proof.runId || '');
  if (!runId || runId !== String(normalizedInput.runId || '')) {
    return { verified: false, reason: 'zktls_run_id_mismatch' };
  }
  const sourceProfile = String(proof.proof.sourceProfile || '');
  if ((sourceProfile !== 'employment' && sourceProfile !== 'bank') || sourceProfile !== String(normalizedInput.sourceProfile || '')) {
    return { verified: false, reason: 'zktls_source_profile_mismatch' };
  }
  if (!proof.proof.payload || typeof proof.proof.payload !== 'object') {
    return { verified: false, reason: 'zktls_payload_missing' };
  }
  const externalProofHash = String(proof.proof.externalProofHash || '');
  if (!externalProofHash) {
    return { verified: false, reason: 'zktls_external_proof_hash_missing' };
  }
  const expectedExternalProofHash = sha256(JSON.stringify(proof.proof.payload));
  if (externalProofHash !== expectedExternalProofHash) {
    return { verified: false, reason: 'zktls_external_proof_hash_mismatch' };
  }
  return { verified: true };
}

function createO1jsProofExternal(
  circuitId: string,
  normalizedInput: Record<string, string | number | boolean>
) {
  const proveCmd = process.env.ZK_O1JS_PROVE_CMD;
  if (!proveCmd) {
    throw new Error('zk_o1js_prover_not_configured');
  }

  const output = execSync(proveCmd, {
    input: JSON.stringify({
      circuitId,
      publicInput: normalizedInput
    }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const parsed = JSON.parse(String(output || '{}')) as Record<string, unknown>;
  if (String(parsed.kind || '') !== 'zk-o1js-proof') {
    throw new Error(`zk_o1js_prove_invalid_response:${String(parsed.reason || 'missing_kind')}`);
  }
  return parsed;
}

function makeProof(
  circuitId: string,
  mode: ProofMode,
  publicInput: Record<string, string | number | boolean>
): ProofEnvelope {
  const id = `prf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = nowIso();
  const normalizedInput = normalizePublicInput(publicInput);
  const serializedInput = JSON.stringify(normalizedInput);
  const proofHash = sha256(`${circuitId}:${mode}:${serializedInput}`);

  if (mode === 'mock') {
    const envelope: ProofEnvelope = {
      id,
      circuitId,
      mode,
      publicInput: normalizedInput,
      proof: { kind: 'mock', value: `mock-${proofHash}` },
      proofHash,
      verifiedLocal: true,
      createdAt
    };
    proofStore.set(id, envelope);
    return envelope;
  }

  if (mode === 'zk') {
    if ((process.env.ZK_PROVER_BACKEND || '').toLowerCase() === 'o1js') {
      const o1jsProof = createO1jsProofExternal(circuitId, normalizedInput);
      const envelope: ProofEnvelope = {
        id,
        circuitId,
        mode,
        publicInput: normalizedInput,
        proof: o1jsProof,
        proofHash,
        verifiedLocal: false,
        createdAt
      };
      const verified = verifyO1jsProofExternal(envelope, normalizedInput);
      if (!verified.verified) {
        throw new Error(`zk_o1js_local_verify_failed:${verified.reason || 'unknown'}`);
      }
      envelope.verifiedLocal = true;
      proofStore.set(id, envelope);
      return envelope;
    }

    const zkProof = createZkCircuitEnvelope(circuitId, normalizedInput);
    const envelope: ProofEnvelope = {
      id,
      circuitId,
      mode,
      publicInput: normalizedInput,
      proof: {
        kind: 'zk-ed25519-statement',
        ...zkProof
      },
      proofHash,
      verifiedLocal: true,
      createdAt
    };
    proofStore.set(id, envelope);
    return envelope;
  }

  const proverKey = process.env.PROVER_SIGNING_KEY || 'tap-dev-prover-key';
  const signature = signDigest(proofHash, proverKey);
  const envelope: ProofEnvelope = {
    id,
    circuitId,
    mode,
    publicInput: normalizedInput,
    proof: {
      kind: 'crypto-hmac-sha256',
      algorithm: 'HMAC-SHA256',
      signature,
      signerKeyHint: sha256(proverKey).slice(0, 16)
    },
    proofHash,
    verifiedLocal: true,
    createdAt
  };

  proofStore.set(id, envelope);
  return envelope;
}

export function getProofMode(): ProofMode {
  const value = (process.env.PROOF_MODE || 'crypto').toLowerCase();
  if (value === 'mock' || value === 'crypto' || value === 'zk') {
    return value;
  }
  return 'crypto';
}

export function generateEligibilityProof(payload: EligibilityProofRequest): ProofEnvelope {
  const evaluationDate = Number(nowIso().slice(0, 10).replaceAll('-', ''));
  const result = payload.policyId >= 0 && payload.subjectCommitment.length > 0;

  const publicInput: Record<string, string | number | boolean> = {
    subjectCommitment: payload.subjectCommitment,
    policyId: payload.policyId,
    evaluationDate,
    result
  };
  if (payload.tenantId) publicInput.tenantId = payload.tenantId;
  if (payload.policyVersion) publicInput.policyVersion = payload.policyVersion;
  if (payload.policyHash) publicInput.policyHash = payload.policyHash;
  if (payload.jurisdiction) publicInput.jurisdiction = payload.jurisdiction;

  return makeProof('eligibility_v1', getProofMode(), publicInput);
}

export function generateTransferComplianceProof(payload: TransferComplianceProofRequest): ProofEnvelope {
  const result = payload.senderCommitment !== payload.receiverCommitment;

  return makeProof('transfer_compliance_v1', getProofMode(), {
    senderCommitment: payload.senderCommitment,
    receiverCommitment: payload.receiverCommitment,
    assetId: payload.assetId,
    amountCommitment: payload.amountCommitment,
    policyId: payload.policyId,
    result
  });
}

export function verifyProofEnvelope(proof: ProofEnvelope): { verified: boolean; reason?: string } {
  const normalizedInput = normalizePublicInput(proof.publicInput);
  const serializedInput = JSON.stringify(normalizedInput);
  const expectedHash = sha256(`${proof.circuitId}:${proof.mode}:${serializedInput}`);
  if (expectedHash !== proof.proofHash) {
    return { verified: false, reason: 'proof_hash_mismatch' };
  }

  if (proof.mode === 'mock') {
    return { verified: true };
  }

  if (proof.mode === 'zk') {
    const kind = String(proof.proof.kind || '');
    if (kind === 'zk-o1js-proof') {
      return verifyO1jsProofExternal(proof, normalizedInput);
    }
    if (kind === 'zktls-external-proof') {
      return verifyZkTlsExternalProof(proof, normalizedInput);
    }
    if (kind !== 'zk-ed25519-statement') {
      return { verified: false, reason: 'zk_proof_kind_unsupported' };
    }
    const algorithm = String(proof.proof.algorithm || '');
    if (algorithm !== 'ed25519') {
      return { verified: false, reason: 'zk_algorithm_unsupported' };
    }
    const parsed: ZkCircuitEnvelope = {
      algorithm: 'ed25519',
      circuitId: String(proof.proof.circuitId || proof.circuitId),
      statementHash: String(proof.proof.statementHash || ''),
      circuitHash: String(proof.proof.circuitHash || ''),
      signature: String(proof.proof.signature || ''),
      verifierKeyHint: String(proof.proof.verifierKeyHint || '')
    };
    const verified = verifyZkCircuitEnvelope(parsed, proof.publicInput);
    if (!verified.verified) return verified;
    return { verified: true };
  }

  const proverKey = process.env.PROVER_SIGNING_KEY || 'tap-dev-prover-key';
  const expectedSig = signDigest(proof.proofHash, proverKey);
  const providedSig = String(proof.proof.signature || '');
  if (providedSig !== expectedSig) {
    return { verified: false, reason: 'proof_signature_mismatch' };
  }

  return { verified: true };
}

export function getProofById(id: string): ProofEnvelope | null {
  return proofStore.get(id) || null;
}
