---
name: shared-liquidity-sdk
description: Design and implement a frontend + SDK architecture where many clients share one liquidity engine and fee routing layer. Use when building multi-frontend protocol ecosystems.
---

# Shared Liquidity SDK

Use this skill for "many frontends, one book" architecture.

## Goals
- Any frontend can place/cancel/query orders through one protocol API.
- Frontend attribution is explicit (`frontendId`) for fee routing and analytics.
- SDK wraps every public API used by UI and bots.

## Architecture Rules
- Match/settlement logic lives server-side.
- SDK is a thin transport + validation layer.
- UI never forks protocol logic; it only composes SDK calls.

## Required SDK Methods
- market discovery (`getMarkets`, `getBook`, `getTrades`)
- account sync (`syncOnchain`, `getBalance`, `getActivity`)
- trading (`placeOrder`, `cancelOrder`, `getOrder`)
- protocol status (`getStatus`, `getAudit`, `getSettlementBatches`)

## Fee Attribution
- Include `frontendId` on order placement.
- Track per-frontend fee accrual server-side.
- Expose read endpoint for fee stats.

## Compatibility Contract
When changing API payloads:
1. keep backward compatibility where possible,
2. version or soft-deprecate old fields,
3. update SDK and UI together,
4. update runbook examples.
