# ShadowBook SDK Specification

This document formalizes the default client-facing integration surface for ShadowBook's lean runtime. It describes the JavaScript SDK, the underlying HTTP contract, frontend attribution semantics, and how agents or CLI tools should interact with the protocol.

## Scope

This spec covers:
- the browser and Node-friendly SDK at `/sdk/shadowbook-sdk.js`
- the default HTTP APIs exposed by the market server
- frontend attribution via `frontendId`
- wallet-signed order authorization expectations

This spec does not cover:
- the advanced proof-heavy settlement path
- the isolated on-chain order book reference path
- internal background worker RPCs beyond the documented operator endpoints

## SDK Location

Canonical SDK:
- `/sdk/shadowbook-sdk.js`

Primary implementation:
- [public/sdk/shadowbook-sdk.js](/Users/evankereiakes/Documents/Codex/private-order-book/public/sdk/shadowbook-sdk.js)

Public API reference:
- [docs/api.md](/Users/evankereiakes/Documents/Codex/private-order-book/docs/api.md)

## Client Construction

Create a client with:

```js
const sdk = window.ShadowBookSDK.createClient({
  baseUrl: 'https://your-shadowbook-host',
  frontendId: 'partner.alpha',
  headers: {}
});
```

Config fields:
- `baseUrl`: host root for the ShadowBook service
- `frontendId`: optional lowercase identifier used for fee attribution
- `headers`: optional static headers appended to every request

## Transport

- protocol: JSON over HTTP
- content type: `application/json`
- methods: `GET`, `POST`
- error model: non-2xx responses return JSON with `error`; the SDK throws `Error(json.error || 'request failed')`

## Core Read Methods

Market and status:
- `getMarkets()`
- `getBook(market, levels)`
- `getTrades()`
- `getCandles(params)`
- `getStatus()`
- `getAudit(limit)`

Account and risk helpers:
- `getActivity(wallet, limit)`
- `getBalance(wallet)`
- `getPretradeChecklist(params)`
- `syncOnchainBalance(payload)`

Orders:
- `placeOrder(payload)`
- `cancelOrder(orderId, cancelToken)`
- `replaceOrder(orderId, payload)`
- `getOrder(orderId, token)`

Vault and notes:
- `deposit(payload)`
- `findLatestDepositTx(payload)`
- `buildDepositTransaction(payload)`
- `submitSignedDepositTransaction(payload)`
- `depositAuto(payload)`
- `withdraw(payload)`
- `getVaultPool()`
- `getNoteStatus(note)`
- `getNotesPortfolio(wallet)`

Frontend fee stats:
- `getFrontendFees(frontendId)`

Settlement and operator:
- `getSettlementBatches(limit)`
- `markBatchCommitted(payload)`
- `getSettlementPayoutRequirements(batchId)`
- `commitNextLocal()`
- `getOperatorZkappState(adminKey)`
- `getPrivateStateWitness(adminKey)`
- `getPrivateStateMerkle(adminKey)`
- `provePrivateState(adminKey)`

Maker flows:
- `postMakerQuote(payload, makerKey)`
- `cancelMakerOrders(payload, makerKey)`

## Order Submission Contract

The default order flow is:
1. client resolves market metadata
2. client derives funding note selection
3. client builds canonical order authorization payload
4. wallet signs the payload
5. client submits `placeOrder()` or `replaceOrder()`
6. backend validates the signature and nonce before placing the order

Key order fields:
- `marketId` or market-resolvable token pair fields
- `side`
- `orderType`
- `timeInForce`
- `limitPrice` for limit orders
- `quantity`
- `visibility`
- `fundingNoteHashes`
- `frontendId`
- `orderAuthorization`

## Wallet Authorization Expectations

Order placement in real-funds mode requires a wallet-signed authorization payload.

The backend validates:
- wallet public key matches the linked trading wallet
- payload matches the canonical order intent
- authorization is not expired
- authorization nonce is unused
- signature verifies cryptographically

Supported signature shapes:
- Mina/Auro-style structured signature JSON: `{ field, scalar }`
- base58 signature strings from compatible signer flows

The signature is not a convenience hint. It is part of the protocol gate for order placement.

## Frontend Attribution

`frontendId` is the routing identifier used to attribute taker fee share to an integrating frontend.

Rules:
- normalized server-side to lowercase
- must satisfy the server's frontend id validation
- is attached automatically by the SDK if the client was constructed with `frontendId`

If `frontendId` is absent:
- order placement still works
- protocol fees still accrue
- no frontend fee share is booked

## Agent And CLI Usage

Agents do not need the browser UI. They can integrate in two ways:

1. SDK-driven integration
- use the same JS SDK from Node or a browser automation context
- attach a stable `frontendId`
- call market, vault, and order endpoints directly

2. Raw HTTP / CLI integration
- call the documented `/api/darkpool/*` endpoints directly
- construct canonical order authorization payloads
- sign those payloads using a wallet or signing service
- submit the signed authorization to `orders/place` or `orders/:id/replace`

Agents should treat these as first-class responsibilities:
- sync wallet state before trading
- manage funding-note selection explicitly or defer to auto-selection rules
- preserve `frontendId` consistently for fee attribution
- store cancel tokens and order ids durably
- handle retries without reusing expired or consumed auth nonces

## Stability

The current SDK surface is the default integration contract for the lean runtime. It is stable enough for partner and agent integrations, but it is not yet versioned as a formal semver protocol package.

Recommended next step for stricter external integrations:
- publish versioned JSON schemas for request and response bodies
- add an SDK changelog keyed to Git commits or tagged releases
