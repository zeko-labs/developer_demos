import { Field, Permissions, Poseidon, SmartContract, State, Struct, UInt64, method, state } from 'o1js';
import { OnchainOrderBookTransitionProof } from './onchain-orderbook-prover.js';
import { ORDER_OP_CANCEL, ORDER_OP_MATCH, ORDER_OP_PLACE } from './onchain-orderbook.js';

export class OnchainOrderBookTransitionCommittedEvent extends Struct({
  sequence: UInt64,
  operationKind: Field,
  newSettlementRoot: Field,
  newOrderRoot: Field,
  newAccountRoot: Field
}) {}

export class ShadowBookOnchainOrderBookZkApp extends SmartContract {
  @state(Field) marketConfigHash = State<Field>();
  @state(Field) settlementRoot = State<Field>();
  @state(Field) orderRoot = State<Field>();
  @state(Field) accountRoot = State<Field>();
  @state(UInt64) lastSequence = State<UInt64>();

  events = {
    transitionCommitted: OnchainOrderBookTransitionCommittedEvent
  };

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
      setPermissions: Permissions.signature()
    });
    this.marketConfigHash.set(Field(0));
    this.settlementRoot.set(Field(0));
    this.orderRoot.set(Field(0));
    this.accountRoot.set(Field(0));
    this.lastSequence.set(UInt64.zero);
  }

  @method async configureMarket(marketConfigHash: Field) {
    this.requireSignature();
    this.marketConfigHash.set(marketConfigHash);
  }

  @method async bootstrapState(orderRoot: Field, accountRoot: Field) {
    this.requireSignature();
    const configured = this.marketConfigHash.getAndRequireEquals();
    configured.assertNotEquals(Field(0));
    this.settlementRoot.getAndRequireEquals().assertEquals(Field(0));
    this.orderRoot.getAndRequireEquals().assertEquals(Field(0));
    this.accountRoot.getAndRequireEquals().assertEquals(Field(0));
    this.lastSequence.getAndRequireEquals().assertEquals(UInt64.zero);

    const initialSettlementRoot = Poseidon.hash([configured, orderRoot, accountRoot]);
    this.orderRoot.set(orderRoot);
    this.accountRoot.set(accountRoot);
    this.settlementRoot.set(initialSettlementRoot);
  }

  @method async commitTransition(proof: OnchainOrderBookTransitionProof) {
    const configured = this.marketConfigHash.getAndRequireEquals();
    configured.assertNotEquals(Field(0));
    proof.verify();
    const publicInput = proof.publicInput!;
    const publicOutput = proof.publicOutput!;

    const currentOrderRoot = this.orderRoot.getAndRequireEquals();
    const currentAccountRoot = this.accountRoot.getAndRequireEquals();
    const currentSettlementRoot = this.settlementRoot.getAndRequireEquals();
    const currentSequence = this.lastSequence.getAndRequireEquals();
    const expectedSequence = currentSequence.add(UInt64.from(1));

    publicInput.marketIdHash.assertEquals(configured);
    publicInput.sequence.assertEquals(expectedSequence);
    publicInput.prevRoots.orderRoot.assertEquals(currentOrderRoot);
    publicInput.prevRoots.accountRoot.assertEquals(currentAccountRoot);
    publicOutput.nextRoots.orderRoot.assertEquals(publicInput.nextRoots.orderRoot);
    publicOutput.nextRoots.accountRoot.assertEquals(publicInput.nextRoots.accountRoot);
    publicOutput.sequence.assertEquals(expectedSequence);

    const operationKind = publicInput.operationKind;
    operationKind
      .equals(ORDER_OP_PLACE)
      .or(operationKind.equals(ORDER_OP_CANCEL))
      .or(operationKind.equals(ORDER_OP_MATCH))
      .assertTrue('invalid operation kind');

    const nextSettlementRoot = Poseidon.hash([
      currentSettlementRoot,
      configured,
      operationKind,
      ...expectedSequence.toFields(),
      publicInput.prevRoots.orderRoot,
      publicInput.prevRoots.accountRoot,
      publicInput.nextRoots.orderRoot,
      publicInput.nextRoots.accountRoot,
      publicInput.orderSlotA,
      publicInput.orderSlotB,
      publicInput.accountSlotA,
      publicInput.accountSlotB,
      ...publicInput.priceTicks.toFields(),
      ...publicInput.quantityLots.toFields()
    ]);

    this.orderRoot.set(publicInput.nextRoots.orderRoot);
    this.accountRoot.set(publicInput.nextRoots.accountRoot);
    this.settlementRoot.set(nextSettlementRoot);
    this.lastSequence.set(expectedSequence);

    this.emitEvent('transitionCommitted', new OnchainOrderBookTransitionCommittedEvent({
      sequence: expectedSequence,
      operationKind,
      newSettlementRoot: nextSettlementRoot,
      newOrderRoot: publicInput.nextRoots.orderRoot,
      newAccountRoot: publicInput.nextRoots.accountRoot
    }));
  }
}
