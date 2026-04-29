# Credits Balance Operator

## Purpose

Use this skill when the runtime is acting as a metered service and you need balance checks, spend intents, queue visibility, or the fast-path credits experience.

## When To Use It

- You are charging builders or users for inference or routing work.
- You want a lean UX that does not wait on heavy proof work for every spend.
- You need an operator-visible queue for settlement and recovery.

## Primary Interfaces

- SDK:
  - `CoordinatorClient.getCreditsBalance()`
  - `CoordinatorClient.enqueueCreditsSpendAndWait()`
  - `CoordinatorClient.enqueueCreditsSpendFast()`
  - `CoordinatorClient.enqueueCreditsSpendFastAndWait()`
  - `CoordinatorClient.getCreditsOperatorQueue()`
  - `CoordinatorClient.getCreditsOperatorItem()`
- HTTP:
  - `POST /api/credits/spend-intent`
  - `POST /api/credits/spend-intent/fast`
  - `GET /api/credits/balance`
  - `GET /api/credits/operator/queue`
  - `GET /api/credits/operator/queue/:id`

## Workflow

1. Check the current balance for the owner public key.
2. Create a spend intent with a unique `requestId` and `idempotencyKey`.
3. Choose the standard or fast path depending on UX needs.
4. If the spend is async, monitor the queue item until it is `settled` or `failed`.
5. Reconcile queue state with the ledger and nullifier records when debugging or auditing.

## Success Criteria

- Credits spending remains cheap and fast on the builder path.
- Operators have enough queue state to recover, retry, or fail over safely.
- Heavy settlement work is pushed into the background when the fast path is enabled.

## Boundaries

This skill meters runtime usage. It is not the place for broader payment marketplace logic, invoicing, or cross-protocol escrow.
