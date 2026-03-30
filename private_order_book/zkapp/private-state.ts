import { Bool, Field, MerkleMapWitness, Poseidon, Provable, PublicKey, Struct, UInt64 } from 'o1js';

export const NOTE_TREE_HEIGHT = 32;
export const NULLIFIER_TREE_HEIGHT = 32;
export const MAX_NOTE_SPEND_UPDATES = 16;
export const MAX_NOTE_OUTPUT_UPDATES = 16;
export const MAX_NULLIFIER_UPDATES = 16;

export class PrivateNoteCommitment extends Struct({
  ownerAccountCommitment: Field,
  assetId: Field,
  amount: UInt64,
  salt: Field
}) {
  hash(): Field {
    return Poseidon.hash([
      this.ownerAccountCommitment,
      this.assetId,
      this.amount.value,
      this.salt
    ]);
  }
}

export class PrivateNoteSpend extends Struct({
  noteCommitment: Field,
  noteNullifier: Field,
  assetId: Field,
  amount: UInt64,
  ownerAccountCommitment: Field
}) {
  hash(): Field {
    return Poseidon.hash([
      this.noteCommitment,
      this.noteNullifier,
      this.assetId,
      this.amount.value,
      this.ownerAccountCommitment
    ]);
  }
}

export class PrivateStateRoots extends Struct({
  noteRoot: Field,
  nullifierRoot: Field,
  settlementRoot: Field
}) {}

export class PrivateStateTransitionPublicInput extends Struct({
  prevRoots: PrivateStateRoots,
  nextRoots: PrivateStateRoots,
  transitionHash: Field,
  batchHash: Field
}) {}

export class PrivateStateTransitionPublicOutput extends Struct({
  appliedSpendCount: UInt64,
  appliedOutputCount: UInt64,
  nextRoots: PrivateStateRoots
}) {}

export class PrivateStateTransitionWitness extends Struct({
  spendRoot: Field,
  outputRoot: Field,
  sequencingReceiptHash: Field,
  bookRoot: Field
}) {
  transitionHash(): Field {
    return Poseidon.hash([
      this.spendRoot,
      this.outputRoot,
      this.sequencingReceiptHash,
      this.bookRoot
    ]);
  }
}

export class NoteMapUpdateWitness extends Struct({
  enabled: Bool,
  key: Field,
  oldValue: Field,
  newValue: Field,
  witness: MerkleMapWitness
}) {}

export class NullifierMapUpdateWitness extends Struct({
  enabled: Bool,
  key: Field,
  oldValue: Field,
  newValue: Field,
  witness: MerkleMapWitness
}) {}

export class PrivateStateMerkleTransitionWitness extends Struct({
  noteSpendWitnesses: Provable.Array(NoteMapUpdateWitness, MAX_NOTE_SPEND_UPDATES),
  noteOutputWitnesses: Provable.Array(NoteMapUpdateWitness, MAX_NOTE_OUTPUT_UPDATES),
  nullifierWitnesses: Provable.Array(NullifierMapUpdateWitness, MAX_NULLIFIER_UPDATES),
  sequencingReceiptHash: Field,
  bookRoot: Field
}) {
  transitionHash(): Field {
    const spendHashes = this.noteSpendWitnesses.map((item) =>
      Poseidon.hash([item.enabled.toField(), item.key, item.oldValue, item.newValue])
    );
    const outputHashes = this.noteOutputWitnesses.map((item) =>
      Poseidon.hash([item.enabled.toField(), item.key, item.oldValue, item.newValue])
    );
    const nullifierHashes = this.nullifierWitnesses.map((item) =>
      Poseidon.hash([item.enabled.toField(), item.key, item.oldValue, item.newValue])
    );
    return Poseidon.hash([
      Poseidon.hash(spendHashes),
      Poseidon.hash(outputHashes),
      Poseidon.hash(nullifierHashes),
      this.sequencingReceiptHash,
      this.bookRoot
    ]);
  }
}

export class SequencingReceipt extends Struct({
  orderCommitment: Field,
  sequenceNumber: UInt64,
  operator: PublicKey,
  timestampBucket: UInt64
}) {
  hash(): Field {
    return Poseidon.hash([
      this.orderCommitment,
      this.sequenceNumber.value,
      ...this.operator.toFields(),
      this.timestampBucket.value
    ]);
  }
}

export function hashAccountCommitment(accountId: string): Field {
  const fields = Array.from(accountId || '').map((ch) => Field(ch.charCodeAt(0)));
  return Poseidon.hash(fields.length ? fields : [Field(0)]);
}

export function computePrivateNoteNullifier(noteCommitment: Field, ownerAccountCommitment: Field): Field {
  return Poseidon.hash([noteCommitment, ownerAccountCommitment, Field(1)]);
}

export function computePrivateStateTransitionHash(
  spends: PrivateNoteSpend[],
  outputs: PrivateNoteCommitment[],
  sequencingReceipt: SequencingReceipt,
  includeBookRoot: Field
): Field {
  const spendHashes = spends.map((item) => item.hash());
  const outputHashes = outputs.map((item) => item.hash());
  return Poseidon.hash([
    Poseidon.hash(spendHashes.length ? spendHashes : [Field(0)]),
    Poseidon.hash(outputHashes.length ? outputHashes : [Field(0)]),
    sequencingReceipt.hash(),
    includeBookRoot
  ]);
}

export function assertNoDuplicateNullifier(currentNullifier: Field, previousNullifier: Field): Bool {
  return currentNullifier.equals(previousNullifier).not();
}
