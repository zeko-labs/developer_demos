import { Bool, Field, MerkleMapWitness, Poseidon, Provable, Struct, UInt64 } from 'o1js';

export const ORDER_OP_PLACE = Field(1);
export const ORDER_OP_CANCEL = Field(2);
export const ORDER_OP_MATCH = Field(3);

export class OnchainOrderBookRoots extends Struct({
  orderRoot: Field,
  accountRoot: Field
}) {}

export class OnchainOrderBookAccountLeaf extends Struct({
  freeBase: UInt64,
  freeQuote: UInt64,
  reservedBase: UInt64,
  reservedQuote: UInt64
}) {
  hash(): Field {
    return Poseidon.hash([
      this.freeBase.value,
      this.freeQuote.value,
      this.reservedBase.value,
      this.reservedQuote.value
    ]);
  }

  static empty(): OnchainOrderBookAccountLeaf {
    return new OnchainOrderBookAccountLeaf({
      freeBase: UInt64.zero,
      freeQuote: UInt64.zero,
      reservedBase: UInt64.zero,
      reservedQuote: UInt64.zero
    });
  }
}

export class OnchainOrderBookOrderLeaf extends Struct({
  ownerHash: Field,
  sideIsBuy: Bool,
  priceTicks: UInt64,
  originalQuantityLots: UInt64,
  remainingQuantityLots: UInt64,
  sequence: UInt64,
  active: Bool
}) {
  hash(): Field {
    const packed = Poseidon.hash([
      this.ownerHash,
      this.sideIsBuy.toField(),
      this.priceTicks.value,
      this.originalQuantityLots.value,
      this.remainingQuantityLots.value,
      this.sequence.value,
      this.active.toField()
    ]);
    return Provable.if(this.active, packed, Field(0));
  }

  static empty(): OnchainOrderBookOrderLeaf {
    return new OnchainOrderBookOrderLeaf({
      ownerHash: Field(0),
      sideIsBuy: Bool(false),
      priceTicks: UInt64.zero,
      originalQuantityLots: UInt64.zero,
      remainingQuantityLots: UInt64.zero,
      sequence: UInt64.zero,
      active: Bool(false)
    });
  }
}

export class OnchainOrderBookTransitionPublicInput extends Struct({
  marketIdHash: Field,
  operationKind: Field,
  sequence: UInt64,
  prevRoots: OnchainOrderBookRoots,
  nextRoots: OnchainOrderBookRoots,
  orderSlotA: Field,
  orderSlotB: Field,
  accountSlotA: Field,
  accountSlotB: Field,
  priceTicks: UInt64,
  quantityLots: UInt64
}) {}

export class OnchainOrderBookTransitionPublicOutput extends Struct({
  nextRoots: OnchainOrderBookRoots,
  sequence: UInt64
}) {}

export class PlaceOrderWitness extends Struct({
  accountWitness: MerkleMapWitness,
  oldAccount: OnchainOrderBookAccountLeaf,
  newAccount: OnchainOrderBookAccountLeaf,
  orderWitness: MerkleMapWitness,
  oldOrder: OnchainOrderBookOrderLeaf,
  newOrder: OnchainOrderBookOrderLeaf
}) {}

export class CancelOrderWitness extends Struct({
  accountWitness: MerkleMapWitness,
  oldAccount: OnchainOrderBookAccountLeaf,
  newAccount: OnchainOrderBookAccountLeaf,
  orderWitness: MerkleMapWitness,
  oldOrder: OnchainOrderBookOrderLeaf,
  newOrder: OnchainOrderBookOrderLeaf
}) {}

export class MatchOrdersWitness extends Struct({
  buyAccountWitness: MerkleMapWitness,
  oldBuyAccount: OnchainOrderBookAccountLeaf,
  newBuyAccount: OnchainOrderBookAccountLeaf,
  sellAccountWitness: MerkleMapWitness,
  oldSellAccount: OnchainOrderBookAccountLeaf,
  newSellAccount: OnchainOrderBookAccountLeaf,
  buyOrderWitness: MerkleMapWitness,
  oldBuyOrder: OnchainOrderBookOrderLeaf,
  newBuyOrder: OnchainOrderBookOrderLeaf,
  sellOrderWitness: MerkleMapWitness,
  oldSellOrder: OnchainOrderBookOrderLeaf,
  newSellOrder: OnchainOrderBookOrderLeaf
}) {}

export function applyOrderRootUpdate(
  currentRoot: Field,
  expectedSlot: Field,
  witness: MerkleMapWitness,
  oldLeaf: OnchainOrderBookOrderLeaf,
  newLeaf: OnchainOrderBookOrderLeaf
): Field {
  const [rootBefore, keyBefore] = witness.computeRootAndKey(oldLeaf.hash());
  rootBefore.assertEquals(currentRoot);
  keyBefore.assertEquals(expectedSlot);
  const [rootAfter] = witness.computeRootAndKey(newLeaf.hash());
  return rootAfter;
}

export function applyAccountRootUpdate(
  currentRoot: Field,
  expectedSlot: Field,
  witness: MerkleMapWitness,
  oldLeaf: OnchainOrderBookAccountLeaf,
  newLeaf: OnchainOrderBookAccountLeaf
): Field {
  const [rootBefore, keyBefore] = witness.computeRootAndKey(oldLeaf.hash());
  rootBefore.assertEquals(currentRoot);
  keyBefore.assertEquals(expectedSlot);
  const [rootAfter] = witness.computeRootAndKey(newLeaf.hash());
  return rootAfter;
}

export function notionalFor(priceTicks: UInt64, quantityLots: UInt64): UInt64 {
  return UInt64.Unsafe.fromField(priceTicks.value.mul(quantityLots.value));
}

export function conditionalActive(remainingQuantityLots: UInt64): Bool {
  return remainingQuantityLots.equals(UInt64.zero).not();
}

export function assertOrderIdentityPreserved(oldLeaf: OnchainOrderBookOrderLeaf, newLeaf: OnchainOrderBookOrderLeaf) {
  oldLeaf.ownerHash.assertEquals(newLeaf.ownerHash);
  oldLeaf.sideIsBuy.assertEquals(newLeaf.sideIsBuy);
  oldLeaf.priceTicks.assertEquals(newLeaf.priceTicks);
  oldLeaf.originalQuantityLots.assertEquals(newLeaf.originalQuantityLots);
  oldLeaf.sequence.assertEquals(newLeaf.sequence);
}
