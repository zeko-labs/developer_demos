# On-Chain Order Book Reference Path

This document describes the **fully on-chain order book reference implementation**
that lives alongside the lean demo runtime.

It is intentionally isolated from the hosted/demo path.

Use this path when:

- you want a code-level reference for a fully verified on-chain order state model
- you are willing to run heavier proving infrastructure
- you are comfortable with a much slower and more operationally expensive system
- you are evaluating higher-trust-minimization builds for skilled teams

Do **not** use this path for the current demo, Render deployment, or primary
showcase runtime.

## What This Path Adds

The lean path keeps:

- off-chain matching
- off-chain order book maintenance
- note-backed private balances
- batched on-chain settlement anchoring

This reference path adds a different architecture:

- an on-chain zkApp that stores:
  - `orderRoot`
  - `accountRoot`
  - `settlementRoot`
  - `lastSequence`
- a proof program that verifies order book state transitions for:
  - order placement
  - order cancellation
  - order matching
- explicit account collateral movement inside the proof statements

That means the chain can verify not just settlement anchoring, but the order
state transition itself.

## Files

Core reference files:

- `../zkapp/onchain-orderbook.ts`
- `../zkapp/onchain-orderbook-prover.ts`
- `../zkapp/onchain-orderbook-contract.ts`

Supporting scripts:

- `../zkapp/deploy-onchain-orderbook.ts`
- `../zkapp/get-onchain-orderbook-state.ts`
- `../zkapp/smoke-onchain-orderbook.ts`

## State Model

This reference path uses two MerkleMap-backed state roots:

1. `orderRoot`
- one leaf per order slot
- leaf includes:
  - owner hash
  - side
  - price ticks
  - original quantity lots
  - remaining quantity lots
  - sequence number
  - active flag

2. `accountRoot`
- one leaf per account slot
- leaf includes:
  - free base
  - free quote
  - reserved base
  - reserved quote

The contract also maintains a rolling `settlementRoot` that hashes the
transition history and a monotonic `lastSequence`.

## Proved Operations

### Place order

The proof verifies:

- the old order leaf was empty/inactive
- the new order leaf is active and matches the declared sequence/price/size
- the account leaf moved the correct collateral from `free` to `reserved`
- the resulting `orderRoot` and `accountRoot` are correct

### Cancel order

The proof verifies:

- the old order leaf existed and was active
- the new order leaf is inactive
- unfilled collateral is released from `reserved` back to `free`
- the resulting `orderRoot` and `accountRoot` are correct

### Match orders

The proof verifies:

- both resting leaves existed and were active
- buyer/seller sides are consistent
- quantities are decremented correctly
- order leaves are deactivated when remaining size reaches zero
- buyer/seller account balances are updated correctly
- the resulting `orderRoot` and `accountRoot` are correct

## What This Reference Path Does Not Do

This is still a reference path, not a full production exchange stack.

It does **not** currently include:

- a production matching engine wired into this contract path
- public API routing from the existing server into the on-chain path
- fee logic
- order replacement convenience flows
- liquidations / perp logic
- private order flow
- note-backed privacy semantics

That is intentional. This path is meant to be a higher-trust-minimization,
code-level on-chain order state reference for advanced teams, not a drop-in
replacement for the lean private demo.

## Scripts

Build and smoke test:

```bash
pnpm zkapp:smoke:onchain-orderbook
```

Deploy isolated reference contract:

```bash
pnpm zkapp:deploy:onchain-orderbook
```

Read isolated reference state:

```bash
pnpm zkapp:get-state:onchain-orderbook
```

## Env Separation

Use dedicated env vars for this path:

- `ONCHAIN_OB_ZKAPP_PRIVATE_KEY`
- `ONCHAIN_OB_ZKAPP_PUBLIC_KEY`
- `ONCHAIN_OB_MARKET_SYMBOL`
- `ONCHAIN_OB_BASE_TOKEN_ID`
- `ONCHAIN_OB_QUOTE_TOKEN_ID`

This keeps the path isolated from:

- `ZKAPP_PUBLIC_KEY`
- `ZKAPP_PRIVATE_KEY`
- the lean settlement contract
- the Render demo runtime

## Recommendation

Treat this as:

- a reference implementation
- a partner path
- a higher-infra / higher-skill option

Do not merge this into the default runtime path.
The lean private exchange remains the product and demo default.
