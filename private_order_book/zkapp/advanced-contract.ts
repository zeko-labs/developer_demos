import {
  Field,
  Permissions,
  PublicKey,
  SmartContract,
  State,
  Struct,
  UInt64,
  method,
  state,
  Poseidon
} from 'o1js';
import { PrivateStateTransitionProof } from './private-state-prover.js';

export class AdvancedSettlementBatchCommittedEvent extends Struct({
  batchId: UInt64,
  batchHash: Field,
  newSettlementRoot: Field,
  newBookRoot: Field,
  newNoteRoot: Field,
  newNullifierRoot: Field,
  newSequencingRoot: Field
}) {}

export class ShadowBookSettlementAdvancedZkApp extends SmartContract {
  @state(Field) marketConfigHash = State<Field>();
  @state(Field) settlementRoot = State<Field>();
  @state(Field) bookRoot = State<Field>();
  @state(Field) noteRoot = State<Field>();
  @state(Field) nullifierRoot = State<Field>();
  @state(Field) sequencingRoot = State<Field>();
  @state(UInt64) lastBatchId = State<UInt64>();

  events = {
    batchCommitted: AdvancedSettlementBatchCommittedEvent
  };

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.signature(),
      setPermissions: Permissions.signature()
    });
    this.marketConfigHash.set(Field(0));
    this.settlementRoot.set(Field(0));
    this.bookRoot.set(Field(0));
    this.noteRoot.set(Field(0));
    this.nullifierRoot.set(Field(0));
    this.sequencingRoot.set(Field(0));
    this.lastBatchId.set(UInt64.from(0));
  }

  @method async configureMarket(marketIdHash: Field, baseTokenIdHash: Field, quoteTokenIdHash: Field, operator: PublicKey) {
    this.requireSignature();
    const configHash = Poseidon.hash([
      marketIdHash,
      baseTokenIdHash,
      quoteTokenIdHash,
      ...operator.toFields()
    ]);
    this.marketConfigHash.set(configHash);
  }

  @method async bootstrapState(
    settlementRoot: Field,
    bookRoot: Field,
    noteRoot: Field,
    nullifierRoot: Field,
    sequencingRoot: Field
  ) {
    const configuredHash = this.marketConfigHash.getAndRequireEquals();
    configuredHash.assertNotEquals(Field(0));
    this.requireSignature();

    const currentSettlementRoot = this.settlementRoot.getAndRequireEquals();
    const currentBookRoot = this.bookRoot.getAndRequireEquals();
    const currentNoteRoot = this.noteRoot.getAndRequireEquals();
    const currentNullifierRoot = this.nullifierRoot.getAndRequireEquals();
    const currentSequencingRoot = this.sequencingRoot.getAndRequireEquals();
    const currentBatch = this.lastBatchId.getAndRequireEquals();

    currentSettlementRoot.assertEquals(Field(0));
    currentBookRoot.assertEquals(Field(0));
    currentNoteRoot.assertEquals(Field(0));
    currentNullifierRoot.assertEquals(Field(0));
    currentSequencingRoot.assertEquals(Field(0));
    currentBatch.assertEquals(UInt64.from(0));

    this.settlementRoot.set(settlementRoot);
    this.bookRoot.set(bookRoot);
    this.noteRoot.set(noteRoot);
    this.nullifierRoot.set(nullifierRoot);
    this.sequencingRoot.set(sequencingRoot);
  }

  @method async commitBatch(
    batchId: UInt64,
    batchHash: Field,
    bookRoot: Field,
    noteRoot: Field,
    nullifierRoot: Field,
    sequencingRoot: Field
  ) {
    const configuredHash = this.marketConfigHash.getAndRequireEquals();
    configuredHash.assertNotEquals(Field(0));
    this.requireSignature();

    const currentRoot = this.settlementRoot.getAndRequireEquals();
    const currentBookRoot = this.bookRoot.getAndRequireEquals();
    const currentNoteRoot = this.noteRoot.getAndRequireEquals();
    const currentNullifierRoot = this.nullifierRoot.getAndRequireEquals();
    const currentSequencingRoot = this.sequencingRoot.getAndRequireEquals();
    const currentBatch = this.lastBatchId.getAndRequireEquals();

    const expected = currentBatch.add(UInt64.from(1));
    expected.assertEquals(batchId);

    const nextRoot = Poseidon.hash([
      currentRoot,
      batchHash,
      ...batchId.toFields(),
      currentBookRoot,
      currentNoteRoot,
      currentNullifierRoot,
      currentSequencingRoot,
      bookRoot,
      noteRoot,
      nullifierRoot,
      sequencingRoot
    ]);

    this.settlementRoot.set(nextRoot);
    this.bookRoot.set(bookRoot);
    this.noteRoot.set(noteRoot);
    this.nullifierRoot.set(nullifierRoot);
    this.sequencingRoot.set(sequencingRoot);
    this.lastBatchId.set(batchId);

    this.emitEvent(
      'batchCommitted',
      new AdvancedSettlementBatchCommittedEvent({
        batchId,
        batchHash,
        newSettlementRoot: nextRoot,
        newBookRoot: bookRoot,
        newNoteRoot: noteRoot,
        newNullifierRoot: nullifierRoot,
        newSequencingRoot: sequencingRoot
      })
    );
  }

  @method async commitBatchWithProof(
    batchId: UInt64,
    batchHash: Field,
    bookRoot: Field,
    noteRoot: Field,
    nullifierRoot: Field,
    sequencingRoot: Field,
    proof: PrivateStateTransitionProof
  ) {
    const configuredHash = this.marketConfigHash.getAndRequireEquals();
    configuredHash.assertNotEquals(Field(0));
    this.requireSignature();

    const currentRoot = this.settlementRoot.getAndRequireEquals();
    const currentBookRoot = this.bookRoot.getAndRequireEquals();
    const currentNoteRoot = this.noteRoot.getAndRequireEquals();
    const currentNullifierRoot = this.nullifierRoot.getAndRequireEquals();
    const currentSequencingRoot = this.sequencingRoot.getAndRequireEquals();
    const currentBatch = this.lastBatchId.getAndRequireEquals();

    const expected = currentBatch.add(UInt64.from(1));
    expected.assertEquals(batchId);

    proof.verify();
    proof.publicInput.batchHash.assertEquals(batchHash);
    proof.publicInput.prevRoots.noteRoot.assertEquals(currentNoteRoot);
    proof.publicInput.prevRoots.nullifierRoot.assertEquals(currentNullifierRoot);
    proof.publicInput.nextRoots.noteRoot.assertEquals(noteRoot);
    proof.publicInput.nextRoots.nullifierRoot.assertEquals(nullifierRoot);
    proof.publicOutput.nextRoots.noteRoot.assertEquals(noteRoot);
    proof.publicOutput.nextRoots.nullifierRoot.assertEquals(nullifierRoot);

    const nextRoot = Poseidon.hash([
      currentRoot,
      batchHash,
      ...batchId.toFields(),
      currentBookRoot,
      currentNoteRoot,
      currentNullifierRoot,
      currentSequencingRoot,
      bookRoot,
      noteRoot,
      nullifierRoot,
      sequencingRoot
    ]);

    this.settlementRoot.set(nextRoot);
    this.bookRoot.set(bookRoot);
    this.noteRoot.set(noteRoot);
    this.nullifierRoot.set(nullifierRoot);
    this.sequencingRoot.set(sequencingRoot);
    this.lastBatchId.set(batchId);

    this.emitEvent(
      'batchCommitted',
      new AdvancedSettlementBatchCommittedEvent({
        batchId,
        batchHash,
        newSettlementRoot: nextRoot,
        newBookRoot: bookRoot,
        newNoteRoot: noteRoot,
        newNullifierRoot: nullifierRoot,
        newSequencingRoot: sequencingRoot
      })
    );
  }
}
