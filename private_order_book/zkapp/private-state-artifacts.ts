import path from 'node:path';
import { Bool, Field, MerkleMap, Mina, Poseidon, PublicKey, UInt64, fetchAccount } from 'o1js';
import { getNextPending, loadBatchFile, type StoredSettlementBatch } from './batch-store.js';
import { ShadowBookSettlementZkApp } from './contract.js';
import {
  MAX_NOTE_OUTPUT_UPDATES,
  MAX_NOTE_SPEND_UPDATES,
  MAX_NULLIFIER_UPDATES,
  NoteMapUpdateWitness,
  NullifierMapUpdateWitness,
  PrivateStateRoots,
  PrivateStateMerkleTransitionWitness,
  PrivateStateTransitionPublicInput
} from './private-state.js';
import { PrivateStateBatchWitness } from './private-state-prover.js';
import {
  buildMap,
  loadEngineStateSnapshot,
  noteLeaf,
  sequencingReceiptLeaf,
  type EngineStateNote,
  type EngineStateSequencingReceipt
} from './private-state-merkle.js';
import { hashHexToField, readOptionalEnv } from './utils.js';

async function loadLivePrevRoots(): Promise<PrivateStateRoots | null> {
  const graphql = String(process.env.ZEKO_GRAPHQL || '').trim();
  const zkappKey = String(process.env.ZKAPP_PUBLIC_KEY || '').trim();
  if (!graphql || !zkappKey) return null;

  const network = Mina.Network({
    mina: graphql,
    archive: graphql
  });
  Mina.setActiveInstance(network);

  const zkappAddress = PublicKey.fromBase58(zkappKey);
  const account = await fetchAccount({ publicKey: zkappAddress });
  if (account.error) {
    throw new Error(`failed to fetch live zkapp roots for ${zkappKey}: ${account.error}`);
  }

  const zkapp = new ShadowBookSettlementZkApp(zkappAddress);
  return new PrivateStateRoots({
    noteRoot: zkapp.noteRoot.get(),
    nullifierRoot: zkapp.nullifierRoot.get(),
    settlementRoot: zkapp.settlementRoot.get()
  });
}

async function getPrevRootsOverride(overrides: ProofRootOverrides): Promise<PrivateStateRoots | null> {
  if (overrides.prevRoots) return overrides.prevRoots;
  return loadLivePrevRoots();
}

function sequencingHash(receipts: EngineStateSequencingReceipt[]): Field {
  const fields = receipts
    .slice()
    .sort((a, b) => String(a.receiptHash || '').localeCompare(String(b.receiptHash || '')))
    .map((receipt) => sequencingReceiptLeaf(receipt));
  return Poseidon.hash(fields.length ? fields : [Field(0)]);
}

function emptyNoteWitness() {
  return new NoteMapUpdateWitness({
    enabled: Bool(false),
    key: Field(0),
    oldValue: Field(0),
    newValue: Field(0),
    witness: new MerkleMap().getWitness(Field(0))
  });
}

function emptyNullifierWitness() {
  return new NullifierMapUpdateWitness({
    enabled: Bool(false),
    key: Field(0),
    oldValue: Field(0),
    newValue: Field(0),
    witness: new MerkleMap().getWitness(Field(0))
  });
}

function padArray<T>(items: T[], size: number, factory: () => T): T[] {
  const padded = items.slice(0, size);
  while (padded.length < size) padded.push(factory());
  return padded;
}

function normalizeDeltaArray(list: any) {
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export type PendingPrivateStateArtifacts = {
  pending: StoredSettlementBatch;
  spends: Array<any>;
  outputs: Array<any>;
  sequencingReceipts: Array<EngineStateSequencingReceipt>;
  prevRoots: PrivateStateRoots;
  nextRoots: PrivateStateRoots;
  transitionHash: Field;
};

export type PendingPrivateStateProofInputs = PendingPrivateStateArtifacts & {
  witness: PrivateStateMerkleTransitionWitness;
  publicInput: PrivateStateTransitionPublicInput;
  batchWitness: PrivateStateBatchWitness;
};

type ProofRootOverrides = {
  prevRoots?: PrivateStateRoots;
};

export async function buildPendingPrivateStateProofInputs(overrides: ProofRootOverrides = {}): Promise<PendingPrivateStateProofInputs | null> {
  const batchPath = readOptionalEnv(
    'SETTLEMENT_BATCHES_FILE',
    path.resolve(process.cwd(), 'data', 'settlement-batches.json')
  );
  const batchFile = await loadBatchFile(batchPath);
  const pending = getNextPending(batchFile);
  if (!pending) return null;

  const delta = pending?.privateStateDelta || {};
  const spends = normalizeDeltaArray(delta.noteSpends);
  const outputs = normalizeDeltaArray(delta.noteOutputs);
  const sequencingReceipts = normalizeDeltaArray(delta.sequencingReceipts);

  if (spends.length > MAX_NOTE_SPEND_UPDATES) {
    throw new Error(`pending batch ${pending.batchId} has ${spends.length} note spends, exceeds MAX_NOTE_SPEND_UPDATES=${MAX_NOTE_SPEND_UPDATES}`);
  }
  if (outputs.length > MAX_NOTE_OUTPUT_UPDATES) {
    throw new Error(`pending batch ${pending.batchId} has ${outputs.length} note outputs, exceeds MAX_NOTE_OUTPUT_UPDATES=${MAX_NOTE_OUTPUT_UPDATES}`);
  }
  if (spends.length > MAX_NULLIFIER_UPDATES) {
    throw new Error(`pending batch ${pending.batchId} has ${spends.length} nullifiers, exceeds MAX_NULLIFIER_UPDATES=${MAX_NULLIFIER_UPDATES}`);
  }

  const snapshot = await loadEngineStateSnapshot();
  const currentActiveNotes = new Map<string, EngineStateNote>();
  for (const note of snapshot.notes.filter((note) => note && note.spentAtUnixMs === null)) {
    currentActiveNotes.set(String(note.noteHash), note);
  }
  const currentNullifiers = new Set(snapshot.spentNullifiers.map((value) => String(value)));

  const prevActiveNotes = new Map(currentActiveNotes);
  for (const output of outputs) {
    prevActiveNotes.delete(String(output.noteHash || ''));
  }
  for (const spend of spends) {
    prevActiveNotes.set(String(spend.noteHash || ''), {
      noteHash: String(spend.noteHash || ''),
      asset: String(spend.asset || ''),
      amount: Number(spend.amount || 0),
      createdAtUnixMs: Number(spend.createdAtUnixMs || 0),
      spentAtUnixMs: null,
      ownerAccountId: String(spend.ownerAccountId || '')
    });
  }

  const prevNullifiers = new Set(currentNullifiers);
  for (const spend of spends) {
    prevNullifiers.delete(String(spend.nullifier || ''));
  }

  const prevNoteMap = buildMap(
    Array.from(prevActiveNotes.values())
      .sort((a, b) => String(a.noteHash).localeCompare(String(b.noteHash)))
      .map((note) => ({
        key: hashHexToField(String(note.noteHash)),
        value: noteLeaf(note)
      }))
  );
  const prevNullifierMap = buildMap(
    Array.from(prevNullifiers.values())
      .sort()
      .map((nullifier) => ({
        key: hashHexToField(String(nullifier)),
        value: Field(1)
      }))
  );

  const noteSpendWitnesses: NoteMapUpdateWitness[] = [];
  const noteOutputWitnesses: NoteMapUpdateWitness[] = [];
  const nullifierWitnesses: NullifierMapUpdateWitness[] = [];

  for (const spend of spends) {
    const noteKey = hashHexToField(String(spend.noteHash || ''));
    const oldValue = noteLeaf({
      noteHash: String(spend.noteHash || ''),
      asset: String(spend.asset || ''),
      amount: Number(spend.amount || 0),
      createdAtUnixMs: Number(spend.createdAtUnixMs || 0),
      spentAtUnixMs: null,
      ownerAccountId: String(spend.ownerAccountId || '')
    });
    const noteWitness = prevNoteMap.getWitness(noteKey);
    noteSpendWitnesses.push(
      new NoteMapUpdateWitness({
        enabled: Bool(true),
        key: noteKey,
        oldValue,
        newValue: Field(0),
        witness: noteWitness
      })
    );
    prevNoteMap.set(noteKey, Field(0));

    const nullifierKey = hashHexToField(String(spend.nullifier || ''));
    const nullifierWitness = prevNullifierMap.getWitness(nullifierKey);
    nullifierWitnesses.push(
      new NullifierMapUpdateWitness({
        enabled: Bool(true),
        key: nullifierKey,
        oldValue: Field(0),
        newValue: Field(1),
        witness: nullifierWitness
      })
    );
    prevNullifierMap.set(nullifierKey, Field(1));
  }

  for (const output of outputs) {
    const noteKey = hashHexToField(String(output.noteHash || ''));
    const newValue = noteLeaf({
      noteHash: String(output.noteHash || ''),
      asset: String(output.asset || ''),
      amount: Number(output.amount || 0),
      createdAtUnixMs: Number(output.createdAtUnixMs || 0),
      spentAtUnixMs: null,
      ownerAccountId: String(output.ownerAccountId || '')
    });
    const noteWitness = prevNoteMap.getWitness(noteKey);
    noteOutputWitnesses.push(
      new NoteMapUpdateWitness({
        enabled: Bool(true),
        key: noteKey,
        oldValue: Field(0),
        newValue,
        witness: noteWitness
      })
    );
    prevNoteMap.set(noteKey, newValue);
  }

  const prevRootsOverride = await getPrevRootsOverride(overrides);

  const computedPrevRoots = new PrivateStateRoots({
    noteRoot: buildMap(
      Array.from(prevActiveNotes.values())
        .sort((a, b) => String(a.noteHash).localeCompare(String(b.noteHash)))
        .map((note) => ({ key: hashHexToField(String(note.noteHash)), value: noteLeaf(note) }))
    ).getRoot(),
    nullifierRoot: buildMap(
      Array.from(prevNullifiers.values())
        .sort()
        .map((nullifier) => ({ key: hashHexToField(String(nullifier)), value: Field(1) }))
    ).getRoot(),
    settlementRoot: prevRootsOverride?.settlementRoot || hashHexToField(String(pending.batchHash || ''))
  });
  const effectivePrevRoots = prevRootsOverride || computedPrevRoots;

  const computedNextRoots = new PrivateStateRoots({
    noteRoot: prevNoteMap.getRoot(),
    nullifierRoot: prevNullifierMap.getRoot(),
    settlementRoot: hashHexToField(String(pending.batchHash || ''))
  });

  if (prevRootsOverride) {
    if (prevRootsOverride.noteRoot.toString() !== computedPrevRoots.noteRoot.toString()) {
      throw new Error(`prev note root mismatch for pending batch ${pending.batchId}`);
    }
    if (prevRootsOverride.nullifierRoot.toString() !== computedPrevRoots.nullifierRoot.toString()) {
      throw new Error(`prev nullifier root mismatch for pending batch ${pending.batchId}`);
    }
  }

  const witness = new PrivateStateMerkleTransitionWitness({
    noteSpendWitnesses: padArray(noteSpendWitnesses, MAX_NOTE_SPEND_UPDATES, emptyNoteWitness),
    noteOutputWitnesses: padArray(noteOutputWitnesses, MAX_NOTE_OUTPUT_UPDATES, emptyNoteWitness),
    nullifierWitnesses: padArray(nullifierWitnesses, MAX_NULLIFIER_UPDATES, emptyNullifierWitness),
    sequencingReceiptHash: sequencingHash(sequencingReceipts),
    bookRoot: hashHexToField(String((pending as any).bookRootHash || pending.batchHash || ''))
  });

  const transitionHash = witness.transitionHash();
  const publicInput = new PrivateStateTransitionPublicInput({
    prevRoots: effectivePrevRoots,
    nextRoots: computedNextRoots,
    transitionHash,
    batchHash: hashHexToField(String((pending as any).batchHash || ''))
  });

  const batchWitness = new PrivateStateBatchWitness({
    witness,
    appliedSpendCount: UInt64.from(spends.length),
    appliedOutputCount: UInt64.from(outputs.length),
    nextRoots: computedNextRoots
  });

  return {
    pending,
    spends,
    outputs,
    sequencingReceipts,
    prevRoots: effectivePrevRoots,
    nextRoots: computedNextRoots,
    transitionHash,
    witness,
    publicInput,
    batchWitness
  };
}

export async function buildPendingPrivateStateArtifacts(overrides: ProofRootOverrides = {}) {
  return buildPendingPrivateStateProofInputs(overrides);
}
