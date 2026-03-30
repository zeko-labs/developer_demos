import 'reflect-metadata';
import { Bool, Field, MerkleMap, Poseidon, UInt64 } from 'o1js';
import {
  CancelOrderWitness,
  OnchainOrderBookAccountLeaf,
  OnchainOrderBookOrderLeaf,
  OnchainOrderBookRoots,
  OnchainOrderBookTransitionPublicInput,
  ORDER_OP_CANCEL,
  ORDER_OP_PLACE,
  PlaceOrderWitness,
  notionalFor
} from './onchain-orderbook.js';
import { OnchainOrderBookTransitionProgram, compileOnchainOrderBookTransitionProgram } from './onchain-orderbook-prover.js';
import { hashStringToField } from './utils.js';

async function main() {
  await compileOnchainOrderBookTransitionProgram();

  const orderMap = new MerkleMap();
  const accountMap = new MerkleMap();
  const emptyOrder = OnchainOrderBookOrderLeaf.empty();
  const marketIdHash = hashStringToField('shadowbook:onchain-orderbook:reference');
  const buyerHash = hashStringToField('buyer');
  const buyAccountSlot = Field(1);
  const buyOrderSlot = Field(101);

  const buyerAccount0 = new OnchainOrderBookAccountLeaf({
    freeBase: UInt64.zero,
    freeQuote: UInt64.from(1000),
    reservedBase: UInt64.zero,
    reservedQuote: UInt64.zero
  });
  accountMap.set(buyAccountSlot, buyerAccount0.hash());
  const roots0 = new OnchainOrderBookRoots({ orderRoot: orderMap.getRoot(), accountRoot: accountMap.getRoot() });

  const buyOrder1 = new OnchainOrderBookOrderLeaf({
    ownerHash: buyerHash,
    sideIsBuy: Bool(true),
    priceTicks: UInt64.from(10),
    originalQuantityLots: UInt64.from(5),
    remainingQuantityLots: UInt64.from(5),
    sequence: UInt64.from(1),
    active: Bool(true)
  });
  const buyerAccount1 = new OnchainOrderBookAccountLeaf({
    freeBase: UInt64.zero,
    freeQuote: UInt64.from(950),
    reservedBase: UInt64.zero,
    reservedQuote: UInt64.from(50)
  });
  const placeInput = new OnchainOrderBookTransitionPublicInput({
    marketIdHash,
    operationKind: ORDER_OP_PLACE,
    sequence: UInt64.from(1),
    prevRoots: roots0,
    nextRoots: new OnchainOrderBookRoots({ orderRoot: Field(0), accountRoot: Field(0) }),
    orderSlotA: buyOrderSlot,
    orderSlotB: Field(0),
    accountSlotA: buyAccountSlot,
    accountSlotB: Field(0),
    priceTicks: UInt64.from(10),
    quantityLots: UInt64.from(5)
  });
  const placeWitness = new PlaceOrderWitness({
    accountWitness: accountMap.getWitness(buyAccountSlot),
    oldAccount: buyerAccount0,
    newAccount: buyerAccount1,
    orderWitness: orderMap.getWitness(buyOrderSlot),
    oldOrder: emptyOrder,
    newOrder: buyOrder1
  });
  orderMap.set(buyOrderSlot, buyOrder1.hash());
  accountMap.set(buyAccountSlot, buyerAccount1.hash());
  placeInput.nextRoots = new OnchainOrderBookRoots({ orderRoot: orderMap.getRoot(), accountRoot: accountMap.getRoot() });
  await OnchainOrderBookTransitionProgram.placeOrder(placeInput, placeWitness);

  const buyOrder2 = new OnchainOrderBookOrderLeaf({ ...buyOrder1, remainingQuantityLots: UInt64.zero, active: Bool(false) });
  const refundNotional = notionalFor(UInt64.from(10), UInt64.from(5));
  const buyerAccount2 = new OnchainOrderBookAccountLeaf({
    freeBase: UInt64.zero,
    freeQuote: buyerAccount1.freeQuote.add(refundNotional),
    reservedBase: UInt64.zero,
    reservedQuote: UInt64.zero
  });
  const cancelInput = new OnchainOrderBookTransitionPublicInput({
    marketIdHash,
    operationKind: ORDER_OP_CANCEL,
    sequence: UInt64.from(2),
    prevRoots: placeInput.nextRoots,
    nextRoots: new OnchainOrderBookRoots({ orderRoot: Field(0), accountRoot: Field(0) }),
    orderSlotA: buyOrderSlot,
    orderSlotB: Field(0),
    accountSlotA: buyAccountSlot,
    accountSlotB: Field(0),
    priceTicks: UInt64.from(10),
    quantityLots: UInt64.from(5)
  });
  const cancelWitness = new CancelOrderWitness({
    accountWitness: accountMap.getWitness(buyAccountSlot),
    oldAccount: buyerAccount1,
    newAccount: buyerAccount2,
    orderWitness: orderMap.getWitness(buyOrderSlot),
    oldOrder: buyOrder1,
    newOrder: buyOrder2
  });
  orderMap.set(buyOrderSlot, buyOrder2.hash());
  accountMap.set(buyAccountSlot, buyerAccount2.hash());
  cancelInput.nextRoots = new OnchainOrderBookRoots({ orderRoot: orderMap.getRoot(), accountRoot: accountMap.getRoot() });
  await OnchainOrderBookTransitionProgram.cancelOrder(cancelInput, cancelWitness);

  console.log(JSON.stringify({
    ok: true,
    proofFlow: ['place-buy', 'cancel-buy'],
    finalRoots: {
      orderRoot: cancelInput.nextRoots.orderRoot.toString(),
      accountRoot: cancelInput.nextRoots.accountRoot.toString(),
      settlementPreviewRoot: Poseidon.hash([
        marketIdHash,
        cancelInput.nextRoots.orderRoot,
        cancelInput.nextRoots.accountRoot,
        ...UInt64.from(2).toFields()
      ]).toString()
    }
  }, null, 2));
}

main().catch((error) => {
  console.error('[zkapp:smoke:onchain-orderbook] failed', error);
  process.exit(1);
});
