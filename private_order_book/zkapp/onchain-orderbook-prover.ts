import { Provable, VerificationKey, ZkProgram } from 'o1js';
import {
  CancelOrderWitness,
  MatchOrdersWitness,
  OnchainOrderBookTransitionPublicInput,
  OnchainOrderBookTransitionPublicOutput,
  ORDER_OP_CANCEL,
  ORDER_OP_MATCH,
  ORDER_OP_PLACE,
  PlaceOrderWitness,
  applyAccountRootUpdate,
  applyOrderRootUpdate,
  assertOrderIdentityPreserved,
  conditionalActive,
  notionalFor
} from './onchain-orderbook.js';

export const OnchainOrderBookTransitionProgram = ZkProgram({
  name: 'OnchainOrderBookTransitionProgram',
  publicInput: OnchainOrderBookTransitionPublicInput,
  publicOutput: OnchainOrderBookTransitionPublicOutput,
  methods: {
    placeOrder: {
      privateInputs: [PlaceOrderWitness],
      async method(publicInput, witness) {
        publicInput.operationKind.assertEquals(ORDER_OP_PLACE);
        witness.oldOrder.active.assertFalse();
        witness.newOrder.active.assertTrue();
        witness.newOrder.sequence.assertEquals(publicInput.sequence);
        witness.newOrder.priceTicks.assertEquals(publicInput.priceTicks);
        witness.newOrder.originalQuantityLots.assertEquals(publicInput.quantityLots);
        witness.newOrder.remainingQuantityLots.assertEquals(publicInput.quantityLots);

        const notional = notionalFor(publicInput.priceTicks, publicInput.quantityLots);
        const isBuy = witness.newOrder.sideIsBuy;

        isBuy
          .and(witness.newAccount.freeBase.equals(witness.oldAccount.freeBase))
          .or(
            isBuy
              .not()
              .and(witness.newAccount.freeBase.add(publicInput.quantityLots).equals(witness.oldAccount.freeBase))
          )
          .assertTrue();
        isBuy
          .and(witness.newAccount.reservedBase.equals(witness.oldAccount.reservedBase))
          .or(
            isBuy
              .not()
              .and(witness.newAccount.reservedBase.equals(witness.oldAccount.reservedBase.add(publicInput.quantityLots)))
          )
          .assertTrue();
        isBuy
          .and(witness.newAccount.freeQuote.add(notional).equals(witness.oldAccount.freeQuote))
          .or(isBuy.not().and(witness.newAccount.freeQuote.equals(witness.oldAccount.freeQuote)))
          .assertTrue();
        isBuy
          .and(witness.newAccount.reservedQuote.equals(witness.oldAccount.reservedQuote.add(notional)))
          .or(isBuy.not().and(witness.newAccount.reservedQuote.equals(witness.oldAccount.reservedQuote)))
          .assertTrue();

        const nextOrderRoot = applyOrderRootUpdate(
          publicInput.prevRoots.orderRoot,
          publicInput.orderSlotA,
          witness.orderWitness,
          witness.oldOrder,
          witness.newOrder
        );
        const nextAccountRoot = applyAccountRootUpdate(
          publicInput.prevRoots.accountRoot,
          publicInput.accountSlotA,
          witness.accountWitness,
          witness.oldAccount,
          witness.newAccount
        );

        publicInput.nextRoots.orderRoot.assertEquals(nextOrderRoot);
        publicInput.nextRoots.accountRoot.assertEquals(nextAccountRoot);

        return {
          publicOutput: new OnchainOrderBookTransitionPublicOutput({
            nextRoots: publicInput.nextRoots,
            sequence: publicInput.sequence
          })
        };
      }
    },
    cancelOrder: {
      privateInputs: [CancelOrderWitness],
      async method(publicInput, witness) {
        publicInput.operationKind.assertEquals(ORDER_OP_CANCEL);
        witness.oldOrder.active.assertTrue();
        witness.newOrder.active.assertFalse();
        witness.newOrder.remainingQuantityLots.assertEquals(witness.newOrder.remainingQuantityLots);
        assertOrderIdentityPreserved(witness.oldOrder, witness.newOrder);

        const refundNotional = notionalFor(witness.oldOrder.priceTicks, witness.oldOrder.remainingQuantityLots);
        const isBuy = witness.oldOrder.sideIsBuy;

        isBuy
          .and(witness.newAccount.freeBase.equals(witness.oldAccount.freeBase))
          .or(
            isBuy
              .not()
              .and(witness.newAccount.freeBase.equals(witness.oldAccount.freeBase.add(witness.oldOrder.remainingQuantityLots)))
          )
          .assertTrue();
        isBuy
          .and(witness.newAccount.reservedBase.equals(witness.oldAccount.reservedBase))
          .or(
            isBuy
              .not()
              .and(witness.newAccount.reservedBase.add(witness.oldOrder.remainingQuantityLots).equals(witness.oldAccount.reservedBase))
          )
          .assertTrue();
        isBuy
          .and(witness.newAccount.freeQuote.equals(witness.oldAccount.freeQuote.add(refundNotional)))
          .or(isBuy.not().and(witness.newAccount.freeQuote.equals(witness.oldAccount.freeQuote)))
          .assertTrue();
        isBuy
          .and(witness.newAccount.reservedQuote.add(refundNotional).equals(witness.oldAccount.reservedQuote))
          .or(isBuy.not().and(witness.newAccount.reservedQuote.equals(witness.oldAccount.reservedQuote)))
          .assertTrue();

        const nextOrderRoot = applyOrderRootUpdate(
          publicInput.prevRoots.orderRoot,
          publicInput.orderSlotA,
          witness.orderWitness,
          witness.oldOrder,
          witness.newOrder
        );
        const nextAccountRoot = applyAccountRootUpdate(
          publicInput.prevRoots.accountRoot,
          publicInput.accountSlotA,
          witness.accountWitness,
          witness.oldAccount,
          witness.newAccount
        );

        publicInput.nextRoots.orderRoot.assertEquals(nextOrderRoot);
        publicInput.nextRoots.accountRoot.assertEquals(nextAccountRoot);

        return {
          publicOutput: new OnchainOrderBookTransitionPublicOutput({
            nextRoots: publicInput.nextRoots,
            sequence: publicInput.sequence
          })
        };
      }
    },
    matchOrders: {
      privateInputs: [MatchOrdersWitness],
      async method(publicInput, witness) {
        publicInput.operationKind.assertEquals(ORDER_OP_MATCH);
        witness.oldBuyOrder.active.assertTrue();
        witness.oldSellOrder.active.assertTrue();
        witness.oldBuyOrder.sideIsBuy.assertTrue();
        witness.oldSellOrder.sideIsBuy.assertFalse();
        witness.oldBuyOrder.priceTicks.assertEquals(publicInput.priceTicks);
        witness.oldSellOrder.priceTicks.assertEquals(publicInput.priceTicks);

        const matchedNotional = notionalFor(publicInput.priceTicks, publicInput.quantityLots);
        const expectedBuyRemaining = witness.oldBuyOrder.remainingQuantityLots.sub(publicInput.quantityLots);
        const expectedSellRemaining = witness.oldSellOrder.remainingQuantityLots.sub(publicInput.quantityLots);
        witness.newBuyOrder.remainingQuantityLots.assertEquals(expectedBuyRemaining);
        witness.newSellOrder.remainingQuantityLots.assertEquals(expectedSellRemaining);
        witness.newBuyOrder.active.assertEquals(conditionalActive(expectedBuyRemaining));
        witness.newSellOrder.active.assertEquals(conditionalActive(expectedSellRemaining));
        assertOrderIdentityPreserved(witness.oldBuyOrder, witness.newBuyOrder);
        assertOrderIdentityPreserved(witness.oldSellOrder, witness.newSellOrder);

        witness.newBuyAccount.freeBase.assertEquals(witness.oldBuyAccount.freeBase.add(publicInput.quantityLots));
        witness.newBuyAccount.freeQuote.assertEquals(witness.oldBuyAccount.freeQuote);
        witness.newBuyAccount.reservedBase.assertEquals(witness.oldBuyAccount.reservedBase);
        witness.newBuyAccount.reservedQuote.assertEquals(witness.oldBuyAccount.reservedQuote.sub(matchedNotional));

        witness.newSellAccount.freeBase.assertEquals(witness.oldSellAccount.freeBase);
        witness.newSellAccount.freeQuote.assertEquals(witness.oldSellAccount.freeQuote.add(matchedNotional));
        witness.newSellAccount.reservedBase.assertEquals(witness.oldSellAccount.reservedBase.sub(publicInput.quantityLots));
        witness.newSellAccount.reservedQuote.assertEquals(witness.oldSellAccount.reservedQuote);

        let nextOrderRoot = applyOrderRootUpdate(
          publicInput.prevRoots.orderRoot,
          publicInput.orderSlotA,
          witness.buyOrderWitness,
          witness.oldBuyOrder,
          witness.newBuyOrder
        );
        nextOrderRoot = applyOrderRootUpdate(
          nextOrderRoot,
          publicInput.orderSlotB,
          witness.sellOrderWitness,
          witness.oldSellOrder,
          witness.newSellOrder
        );

        let nextAccountRoot = applyAccountRootUpdate(
          publicInput.prevRoots.accountRoot,
          publicInput.accountSlotA,
          witness.buyAccountWitness,
          witness.oldBuyAccount,
          witness.newBuyAccount
        );
        nextAccountRoot = applyAccountRootUpdate(
          nextAccountRoot,
          publicInput.accountSlotB,
          witness.sellAccountWitness,
          witness.oldSellAccount,
          witness.newSellAccount
        );

        publicInput.nextRoots.orderRoot.assertEquals(nextOrderRoot);
        publicInput.nextRoots.accountRoot.assertEquals(nextAccountRoot);

        return {
          publicOutput: new OnchainOrderBookTransitionPublicOutput({
            nextRoots: publicInput.nextRoots,
            sequence: publicInput.sequence
          })
        };
      }
    }
  }
});

export class OnchainOrderBookTransitionProof extends ZkProgram.Proof(OnchainOrderBookTransitionProgram) {}

export async function compileOnchainOrderBookTransitionProgram(): Promise<VerificationKey> {
  const { verificationKey } = await OnchainOrderBookTransitionProgram.compile();
  return verificationKey;
}
