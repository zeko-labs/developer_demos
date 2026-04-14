import { Field, Poseidon, Struct, ZkProgram } from 'o1js';

class ArtifactPublicInput extends Struct({
  statementHash: Field,
  intentId: Field,
  sourceId: Field,
  sourceKind: Field
}) {}

class ArtifactWitness extends Struct({
  requestCommitment: Field,
  batchRoot: Field,
  attestationHash: Field,
  receiptHash: Field,
  settlementHash: Field,
  treasuryHash: Field,
  actorHash: Field,
  intentId: Field,
  sourceId: Field,
  sourceKind: Field
}) {}

const ArtifactProofProgram = ZkProgram({
  name: 'MagicCityArtifactProof',
  publicInput: ArtifactPublicInput,
  methods: {
    proveArtifact: {
      privateInputs: [ArtifactWitness],
      async method(publicInput, witness) {
        publicInput.intentId.assertEquals(witness.intentId);
        publicInput.sourceId.assertEquals(witness.sourceId);
        publicInput.sourceKind.assertEquals(witness.sourceKind);
        const statementHash = Poseidon.hash([
          witness.requestCommitment,
          witness.batchRoot,
          witness.attestationHash,
          witness.receiptHash,
          witness.settlementHash,
          witness.treasuryHash,
          witness.actorHash,
          witness.intentId,
          witness.sourceId,
          witness.sourceKind
        ]);
        publicInput.statementHash.assertEquals(statementHash);
      }
    }
  }
});

let compiled = null;

function fieldFromText(value) {
  const text = String(value || '');
  if (!text) return Field(0);
  const chunks = [];
  for (let i = 0; i < text.length; i += 1) {
    chunks.push(Field(text.charCodeAt(i)));
  }
  return Poseidon.hash(chunks);
}

function fieldFromRecordId(value, prefix = null) {
  const text = String(value || '');
  const match = prefix
    ? text.match(new RegExp(`^${prefix}-(\\d+)$`))
    : text.match(/^[a-z]+-(\d+)$/i);
  if (match) return Field(Number(match[1]));
  return fieldFromText(text || prefix);
}

function fieldToString(field) {
  return field.toString();
}

function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function fieldFromStableObject(value) {
  if (value === null || value === undefined) return Field(0);
  return fieldFromText(canonicalize(value));
}

function buildReceiptHash(receiptLike) {
  const material = [
    receiptLike?.id ?? '',
    receiptLike?.proofType ?? '',
    receiptLike?.proofHash ?? '',
    receiptLike?.settlementRef ?? ''
  ].join(':');
  return fieldFromText(material);
}

function normalizeProofJson(json = {}) {
  if (typeof json === 'string') {
    return {
      publicInput: [],
      publicOutput: [],
      maxProofsVerified: 0,
      proof: json
    };
  }
  return {
    ...json,
    publicInput: Array.isArray(json.publicInput) ? json.publicInput : [],
    publicOutput: Array.isArray(json.publicOutput) ? json.publicOutput : []
  };
}

export function buildProofInputs(proofArtifact = {}) {
  const publicInputs = proofArtifact.publicInputs ?? {};
  const attestation = proofArtifact.attestation ?? {};
  const sourceId = publicInputs.sourceId ?? proofArtifact.sourceId ?? publicInputs.receiptId ?? publicInputs.intentId ?? null;
  const sourceKind = publicInputs.sourceKind ?? proofArtifact.sourceKind ?? (publicInputs.receiptId ? 'receipt' : 'intent');
  const sourceIdField = fieldFromRecordId(sourceId);
  const sourceKindField = fieldFromText(sourceKind);

  const witness = new ArtifactWitness({
    requestCommitment: fieldFromText(publicInputs.requestCommitment),
    batchRoot: fieldFromText(publicInputs.batchRoot),
    attestationHash: fieldFromText(attestation.attestationHash ?? publicInputs.proofHash),
    receiptHash: buildReceiptHash({
      id: publicInputs.receiptId,
      proofType: publicInputs.proofType,
      proofHash: publicInputs.proofHash,
      settlementRef: proofArtifact.settlementRef
    }),
    settlementHash: fieldFromStableObject(proofArtifact.settlement ?? null),
    treasuryHash: fieldFromStableObject(proofArtifact.treasury ?? null),
    actorHash: fieldFromStableObject(proofArtifact.actor ?? attestation ?? null),
    intentId: fieldFromRecordId(publicInputs.intentId, 'intent'),
    sourceId: sourceIdField,
    sourceKind: sourceKindField
  });

  const statementHash = Poseidon.hash([
    witness.requestCommitment,
    witness.batchRoot,
    witness.attestationHash,
    witness.receiptHash,
    witness.settlementHash,
    witness.treasuryHash,
    witness.actorHash,
    witness.intentId,
    witness.sourceId,
    witness.sourceKind
  ]);

  const publicInput = new ArtifactPublicInput({
    statementHash,
    intentId: witness.intentId,
    sourceId: witness.sourceId,
    sourceKind: witness.sourceKind
  });

  return {
    publicInput,
    witness,
    export: {
      statementHash: fieldToString(statementHash),
      intentId: fieldToString(witness.intentId),
      sourceId: fieldToString(witness.sourceId),
      sourceKind: fieldToString(witness.sourceKind),
      requestCommitmentHash: fieldToString(witness.requestCommitment),
      batchRootHash: fieldToString(witness.batchRoot),
      attestationHashField: fieldToString(witness.attestationHash),
      receiptHashField: fieldToString(witness.receiptHash),
      settlementHashField: fieldToString(witness.settlementHash),
      treasuryHashField: fieldToString(witness.treasuryHash),
      actorHashField: fieldToString(witness.actorHash)
    }
  };
}

export async function compileArtifactProofProgram() {
  if (!compiled) {
    compiled = await ArtifactProofProgram.compile();
  }
  return compiled;
}

export async function generateArtifactProof(proofArtifact = {}) {
  await compileArtifactProofProgram();
  const { publicInput, witness, export: inputExport } = buildProofInputs(proofArtifact);
  const result = await ArtifactProofProgram.proveArtifact(publicInput, witness);
  const proof = result?.proof ?? result;
  return {
    schema: 'magic-city-zk-proof-v1',
    program: 'MagicCityArtifactProof',
    provingSystem: 'o1js',
    publicInput: {
      statementHash: fieldToString(publicInput.statementHash),
      intentId: fieldToString(publicInput.intentId),
      sourceId: fieldToString(publicInput.sourceId),
      sourceKind: fieldToString(publicInput.sourceKind)
    },
    witness: inputExport,
    proof: normalizeProofJson(proof.toJSON())
  };
}

export async function verifyArtifactProof(zkProof = {}) {
  await compileArtifactProofProgram();
  const rawProofJson =
    zkProof?.proof && typeof zkProof.proof === 'object'
      ? zkProof.proof
      : zkProof;
  const proofJson = normalizeProofJson(rawProofJson);
  const proof = await ArtifactProofProgram.Proof.fromJSON(proofJson);
  const verified = await ArtifactProofProgram.verify(proof);
  return {
    verified,
    publicInput: {
      statementHash: fieldToString(proof.publicInput.statementHash),
      intentId: fieldToString(proof.publicInput.intentId),
      sourceId: fieldToString(proof.publicInput.sourceId),
      sourceKind: fieldToString(proof.publicInput.sourceKind)
    }
  };
}

export async function buildAnchorPayload({ proofArtifact = {}, zkProof = {}, network = 'zeko:testnet' } = {}) {
  const compiledProgram = await compileArtifactProofProgram();
  const verification = await verifyArtifactProof(zkProof);
  return {
    schema: 'magic-city-anchor-v1',
    network,
    proofSystem: 'o1js',
    program: 'MagicCityArtifactProof',
    verificationKeyHash: compiledProgram.verificationKey?.hash?.toString?.() ?? null,
    statementHash: zkProof.publicInput?.statementHash ?? verification.publicInput.statementHash,
    statementKind: proofArtifact.statementKind ?? null,
    sourceKind: proofArtifact.sourceKind ?? proofArtifact.publicInputs?.sourceKind ?? null,
    sourceId: proofArtifact.sourceId ?? proofArtifact.publicInputs?.sourceId ?? null,
    publicInputs: proofArtifact.publicInputs ?? {},
    actor: proofArtifact.actor ?? null,
    attestation: proofArtifact.attestation ?? null,
    settlement: proofArtifact.settlement ?? null,
    treasury: proofArtifact.treasury ?? null,
    settlementRef: proofArtifact.settlementRef ?? null,
    requestCommitment: proofArtifact.publicInputs?.requestCommitment ?? null,
    batchRoot: proofArtifact.publicInputs?.batchRoot ?? null,
    batchWindowId: proofArtifact.publicInputs?.batchWindowId ?? null,
    proofType: proofArtifact.publicInputs?.proofType ?? null,
    proofHash: proofArtifact.publicInputs?.proofHash ?? null,
    receiptId: proofArtifact.publicInputs?.receiptId ?? null,
    intentId: proofArtifact.publicInputs?.intentId ?? null,
    zkProof: {
      schema: zkProof.schema ?? 'magic-city-zk-proof-v1',
      provingSystem: zkProof.provingSystem ?? 'o1js',
      proof: zkProof.proof ?? null,
      publicInput: zkProof.publicInput ?? verification.publicInput
    }
  };
}
