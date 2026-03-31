# ShadowBook Fee Model

This document formalizes the fee model implemented by the lean ShadowBook runtime.

## Summary

ShadowBook currently uses a simple taker-fee model with optional frontend revenue sharing.

The high-level rule is:
- maker fee: `0`
- taker fee: configurable via `TAKER_FEE_BPS`
- frontend share: configurable via `FRONTEND_FEE_SHARE_BPS`
- protocol receives the remainder

## Configuration

Environment variables:
- `TAKER_FEE_BPS`
- `FRONTEND_FEE_SHARE_BPS`

Current implementation references:
- `src/darkpool-server.js:114`
- `src/darkpool-server.js:115`

## Who Pays

Only the taker pays the explicit trading fee in the default model.

Taker identification is based on the aggressing order in the fill path.

Implementation reference:
- `src/darkpool-server.js:2838`

## Fee Asset Rules

When the taker is `BUY`:
- fee is charged in the base asset
- the buyer receives `filled base quantity - fee`

When the taker is `SELL`:
- fee is charged in the quote asset
- the seller receives `quote notional - fee`

This keeps fee extraction aligned with the side that aggressed the book and the asset they are receiving.

## Split Between Protocol And Frontend

Given:
- `feeAmount`
- `FRONTEND_FEE_SHARE_BPS`

Then:
- `frontendShare = feeAmount * FRONTEND_FEE_SHARE_BPS / 10000`
- `protocolShare = feeAmount - frontendShare`

Important rule:
- protocol fees accrue whether or not a `frontendId` is present
- frontend revenue share only accrues when a valid `frontendId` is attached

Implementation reference:
- `src/darkpool-server.js:1763`

## Frontend Attribution

Frontend attribution is keyed by `frontendId` on the originating taker order.

When a taker fill occurs and a valid `frontendId` exists:
- frontend trade count increments
- frontend routed quote volume increments
- frontend earnings accrue in the charged fee asset
- recent fills are recorded for reporting

If no `frontendId` exists:
- no frontend ledger entry is created
- the full fee accrues to protocol balances

## Protocol Fee Ledger

Protocol fees are tracked in-memory by asset:
- `protocolFeeBalances[asset]`

Frontend earnings are tracked in:
- `frontendFeeLedger`

The public reporting endpoint is:
- `GET /api/darkpool/frontends/fees`

Implementation reference:
- `src/darkpool-server.js:4294`

This endpoint returns:
- per-frontend stats when `frontendId` is supplied
- a leaderboard view otherwise
- current config values
- protocol fee balances

## Current Tradeoffs

The current fee system is intentionally lean:
- no maker rebates
- no tiered pricing
- no staking discounts
- no on-chain fee vault accounting
- no fee claim contract for frontends

This is appropriate for the demo and lean hosted path because it keeps settlement, routing, and partner attribution easy to reason about.

## Recommended Operational Semantics

For the lean runtime, treat the fee model as:
- protocol-native accounting on the server
- frontend attribution as a routing ledger
- settlement-side fee realization as part of fill accounting

For future harder deployments, likely extensions are:
- persistent fee ledger storage
- signed frontend payout statements
- on-chain claim or payout rails for protocol and frontend earnings
- multi-frontend affiliate chains if needed

## Agent And Partner Implications

Agents and partner frontends should:
- set a stable `frontendId` at SDK construction or order submission time
- treat `frontendId` as part of order-routing identity
- query `/api/darkpool/frontends/fees` for earnings and routed volume

This creates a simple split:
- protocol earns the default trading fee
- partner frontend earns the configured share on attributed taker flow

That model is already live in the lean runtime and is suitable for partner demos, agent routing, and operator-operated frontends.
