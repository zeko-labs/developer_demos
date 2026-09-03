# Deploying a Trading Strategy on ShadowBook

This guide is for an agent or developer building a trading strategy against the
ShadowBook private order book DEX on Zeko Ethereum Sepolia.

It covers the current hosted demo integration. It does not claim that the demo
is a trustless, decentralized matching network or a production-ready strategy
hosting platform.

## Start Here

The recommended first deployment is a client-side strategy process:

```text
strategy process -> ShadowBook SDK or HTTP API -> hosted matcher
                                               -> asynchronous Zeko settlement
```

The strategy does **not** deploy a new zkApp, run the canonical matcher, or
hold the DEX operator keys. It reads the market, computes signals, signs order
intent with its own wallet or signing service, and submits orders to the shared
market service.

Deploy protocol infrastructure only if you intentionally want to operate a
separate market service, settlement authority, or zkApp. That is a different
project with key management, uptime, reconciliation, and security requirements.

## Current Network

ShadowBook is currently configured for Zeko Ethereum Sepolia only.

| Item | Value |
| --- | --- |
| GraphQL endpoint | `https://sepolia.zeko.io/graphql` |
| Network label | Zeko Sepolia / Zeko Ethereum Testnet |
| GraphQL network identifier | Verify from `/api/darkpool/status`; the chain commonly reports `zeko:testnet` |
| Signing domain | `testnet` for the current o1js/Auro-compatible message signer |
| Native gas asset | `sETH` |
| Supported fungible token | `sZEKO` |
| Current market | `sETH/sZEKO` |

Do not infer the signing domain from the word `Sepolia`. In this deployment,
the GraphQL network identifier and the o1js message-signing domain are related
but are not the same string.

For ordinary deposits, orders, fills, and settlement processing, the relevant
confirmation boundary is the Zeko sequencer/runtime. Ethereum L1 finality is
not part of the normal strategy execution loop; it matters to bridge or rollup
assurance flows, not to every order decision.

### Assets

`sETH` is native on Zeko Sepolia. It is used for transaction fees and must use a
native payment path when funding or paying out.

`sZEKO` is a whitelisted fungible token. It uses a token contract transfer path
for funding and payouts.

The current token identifiers are:

```text
sETH native token id:
wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf

sZEKO token id:
xpAptwG79jEStACsCv9C6yXUBmKbvurUo8GsTPYapn9QWB5zE5

sZEKO token contract:
B62qpCuSDoTuL8dUcNfuoLoas8A77gRHJTp4WVe5NF2phXbQUNwNZ3W
```

Treat those values as deployment configuration, not permanent protocol
constants. The strategy should call `GET /api/darkpool/markets` and use the
returned market and token metadata instead of hard-coding a market id.

## System Model

```text
1. Wallet owns on-chain sETH/sZEKO.
2. Wallet funds the ShadowBook vault.
3. ShadowBook verifies the deposit and issues private note collateral.
4. Strategy signs an off-chain order authorization.
5. Matcher validates, reserves notes, and matches orders off-chain.
6. Fills are journaled and queued into a settlement batch.
7. Settlement worker commits the batch to the Zeko settlement zkApp.
8. Received assets are issued as note collateral after settlement processing.
9. Wallet owner redeems notes to an on-chain balance when needed.
```

The ordinary order path is not one on-chain transaction per order. Order
authorization, matching, reservations, fills, and most activity updates happen
at the application layer. Zeko is used for the settlement verification and
root-anchoring path, plus wallet funding and redemption transactions.

### What reaches Zeko

- vault deposits from a wallet
- note redemption / withdrawal transactions
- settlement zkApp batch commits from the service
- any other explicitly configured operator or wallet transaction

### What does not normally reach Zeko per order

- reading the book
- signing an order intent
- placing a limit order
- canceling an order
- matching a fill

The service may submit a later settlement batch after one or more fills. The
strategy should therefore monitor settlement state instead of waiting for a
chain transaction from every order submission.

## Where To Run The Strategy

Run the strategy as its own process or service:

- local machine for development and small tests
- a dedicated worker, VM, or container for unattended operation
- a separate deployment from the ShadowBook web process for production-like
  testing

Do not put a long-running trading loop inside an HTTP request handler. Do not
reuse the DEX server's deployer, zkApp, payout, or operator credentials. The
strategy needs its own wallet and signing boundary.

Minimal client configuration:

```env
DARKPOOL_API=https://your-shadowbook-host
AGENT_WALLET_PUBLIC_KEY=<strategy-wallet-public-key>
FRONTEND_ID=agent.alpha
```

The bot and raw HTTP examples use `DARKPOOL_API` as the deployed ShadowBook
base URL. `AGENT_WALLET_PUBLIC_KEY` identifies the strategy wallet; it is not a
secret.

### Maker Access

`MAKER_API_KEY` is only required when the strategy is authorized to maintain
resting liquidity through `POST /api/darkpool/maker/quote` or cancel maker
quotes through `POST /api/darkpool/maker/cancel-all`.

```env
DARKPOOL_API=https://your-shadowbook-host
MAKER_API_KEY=<deployed-dex-maker-key>
```

Keep `MAKER_API_KEY` server-side. It is an access credential for the deployed
DEX maker route, not a wallet private key and not a substitute for wallet-signed
order authorization. A taker-only strategy does not need it.

Keep the private signing key outside the repository and outside browser code.
For unattended execution, prefer a signer process or KMS/HSM-style boundary
that exposes only the message-signing operation needed by the strategy.

## Account And Note Model

Trading uses private note collateral, not the wallet's raw token balance.

Before trading, the strategy account needs:

- a linked wallet public key
- a recent on-chain balance sync
- enough private notes for the side being submitted
- enough native `sETH` to cover any wallet transaction fees

The received asset is not immediately spendable as a note after a fill. It is
credited through the settlement path. This is why a strategy must distinguish:

- `available note amount`: spendable private collateral now
- `on-chain wallet balance`: balance currently visible to the chain query
- `pending settlement`: matched but not yet reflected as received note collateral
- `locked collateral`: notes reserved by open orders

Never treat a successful match response as proof that the counter-asset note is
already available for a second order. Reconcile the notes portfolio after the
settlement batch advances.

## Funding A Strategy Account

For a first strategy, fund the account manually and keep strategy code focused
on trading. Automating deposits adds wallet signing, transaction recovery, and
native-vs-token branching that is not needed to validate a strategy.

The operational sequence is:

1. Connect or identify the strategy wallet.
2. Call `POST /api/darkpool/accounts/sync-onchain`.
3. Deposit native `sETH` or fungible `sZEKO` into the configured vault.
4. Wait for Zeko sequencer state and note issuance.
5. Call `GET /api/darkpool/notes/portfolio?wallet=...`.
6. Start the strategy only after the required notes are available.

For automated funding, use the documented deposit intent and recovery flow.
Do not resend a deposit just because a wallet or HTTP request timed out. First
check the deposit intent, wallet/vault state, and transaction history. Auro may
have accepted or submitted a transaction even when the browser did not return
the hash.

Native `sETH` and fungible `sZEKO` deposits are different transaction paths:

- `sETH`: native payment to the vault
- `sZEKO`: transfer through the sZEKO token contract, including token-account
  handling where required

## SDK Integration

The browser/Node-friendly SDK is at `/sdk/shadowbook-sdk.js` on the hosted
service and in `public/sdk/shadowbook-sdk.js` in this repo.

Example client setup:

```js
const sdk = window.ShadowBookSDK.createClient({
  baseUrl: process.env.DARKPOOL_API,
  frontendId: 'agent.alpha'
});
```

For Node, use the same module from a local checkout or load the served SDK in a
compatible runtime. The SDK is a thin JSON-over-HTTP client; it does not manage
private keys or sign messages for the strategy.

Useful read methods:

```js
const { markets } = await sdk.getMarkets();
const market = markets.find((item) => item.symbol === 'sETH/sZEKO');

const book = await sdk.getBook(market, 20);
const status = await sdk.getStatus();
const notes = await sdk.getNotesPortfolio(strategyWallet);
const pretrade = await sdk.getPretradeChecklist({
  wallet: strategyWallet,
  marketId: market.marketId,
  side: 'BUY',
  orderType: 'LIMIT',
  quantity: 0.01,
  limitPrice: 20
});
```

Useful write methods:

```js
await sdk.placeOrder({
  wallet: strategyWallet,
  marketId: market.marketId,
  side: 'BUY',
  orderType: 'LIMIT',
  timeInForce: 'GTC',
  limitPrice: 20,
  quantity: 0.01,
  visibility: 'public',
  fundingNoteHashes: selectedQuoteNoteHashes,
  frontendId: 'agent.alpha',
  orderAuthorization
});

await sdk.cancelOrder(orderId, cancelToken);
await sdk.replaceOrder(orderId, replacementPayload);
```

The exact response bodies and endpoint list are in [api.md](./api.md) and the
integration contract is in [sdk-spec.md](./sdk-spec.md).

## Order Authorization

In real-funds mode, the server requires a wallet-signed authorization message.
The message must describe the exact order being submitted.

The signed payload includes:

- `wallet`
- `marketId`
- `baseTokenId`
- `quoteTokenId`
- `side`: `BUY` or `SELL`
- `orderType`: `LIMIT` or `MARKET`
- `timeInForce`: `GTC` or `IOC`
- `limitPrice`, or `null` for a market order
- `quantity`
- `fundingNoteHashes`
- `visibility`: `public` or `private`
- `frontendId`, or `null`
- a fresh `nonce`
- `expiresAtUnixMs`

The server canonicalizes the payload with its stable JSON representation and
verifies the signature with the o1js Mina-compatible signer on the `testnet`
domain. A strategy implementation must use the same canonical field values and
types. A signature over an equivalent-looking but differently serialized JSON
object will fail.

The submitted authorization object has this shape:

```json
{
  "publicKey": "<strategy-wallet-public-key>",
  "payload": "<canonical-json-string>",
  "nonce": "ord_<unique-value>",
  "expiresAtUnixMs": 0,
  "signature": {
    "field": "<field>",
    "scalar": "<scalar>"
  },
  "method": "<wallet-or-signer-method>"
}
```

Do not put private keys in the SDK configuration, browser bundle, logs, or
order metadata. Use Auro, an isolated signer, or a key-management service that
can produce the required message signature.

## Limit And Market Orders

### Limit orders

- `GTC` rests until filled, canceled, or expired.
- `IOC` executes against available opposite liquidity and cancels any remainder.
- limit orders reserve the required note collateral.
- the cancel token and order id must be stored by the strategy.
- a partially filled order retains only its remaining reservation.

### Market orders

- market orders use `IOC` semantics.
- the server derives executable pricing from the opposite side of the book.
- there must be sufficient opposite liquidity before submission.
- slippage protection is deployment-configured; the strategy should still apply
  its own maximum price, quantity, and notional checks.
- a market order may fill partially or fail if the book cannot satisfy it.

For a strategy, a limit order is usually safer for initial testing because it
provides explicit price control and leaves a durable order to reconcile.

## A Minimal Strategy Loop

The first version should be intentionally boring:

```text
load market metadata
  -> read book and recent trades
  -> compute signal
  -> apply risk limits
  -> run pretrade checklist
  -> select note hashes
  -> create fresh authorization
  -> sign exact payload
  -> submit one order
  -> persist order id and cancel token
  -> poll order/activity/settlement state
  -> reconcile notes before submitting the next dependent order
```

Recommended controls:

- maximum order quantity
- maximum quote notional
- maximum position per asset
- maximum open orders
- maximum daily or session loss
- maximum price deviation from the current book
- maximum slippage for market orders
- cooldown after a rejected order
- kill switch that cancels the strategy's open orders
- durable storage for nonces, order ids, cancel tokens, and fills

Do not use a strategy loop that blindly submits on every polling tick. Use a
state machine with explicit `observed`, `authorized`, `submitted`, `accepted`,
`partially_filled`, `filled`, `canceled`, `rejected`, and `unknown` states.

## Reconciliation And Retries

Treat a request timeout as an unknown outcome, not as a rejection.

### Safe retry rules

- GET requests may be retried with bounded backoff.
- Never reuse an expired order authorization.
- Never reuse a consumed authorization nonce for a new order.
- After an ambiguous order POST, query the order, activity, and book before
  creating a replacement order.
- Store the response's order id and cancel token immediately.
- If the service reports stale on-chain state, sync before another real-funds
  order.
- Do not assume the counter-asset note exists until settlement reconciliation
  shows it.

The current public Sepolia GraphQL endpoint may return non-JSON 502/520-style
responses during an outage or overloaded interval. SDK code should preserve the
HTTP status and a short response excerpt, retry only where the operation is
safe, and report the network dependency separately from an order rejection.

## Monitoring

At minimum, poll these surfaces:

```text
GET /api/darkpool/status
GET /api/darkpool/markets
GET /api/darkpool/book?marketId=<id>&levels=20
GET /api/darkpool/trades
GET /api/darkpool/activity?wallet=<wallet>&limit=150
GET /api/darkpool/notes/portfolio?wallet=<wallet>
GET /api/darkpool/settlement/batches?limit=100
```

Record locally:

- strategy decision and signal inputs
- submitted authorization nonce, but not private keys
- order id and cancel token
- server response status
- fills and remaining quantity
- settlement batch id and commit status
- note balances before and after settlement
- errors with endpoint and retry classification

Do not log full private note payloads, note secrets, wallet private keys, or
unredacted order intent in production telemetry.

## Privacy Boundary

The current hosted demo has meaningful privacy properties, but they are limited:

- public anonymous orders expose price and size without exposing the wallet in
  the public book
- private orders are not placed on the public book
- the server needs live order information to match the market
- default server activity is redacted, while detailed user activity is kept in
  the user's browser
- the current hosted path is lean root anchoring, not the full private-state
  proof path
- confidential matching from the operator is not provided by this client-only
  strategy integration

Do not market a strategy as operator-confidential solely because it uses note
collateral or a private order visibility mode. A TEE, MPC, wallet-side matcher,
or a future secure execution boundary is needed for that stronger claim.

## Fees

Trading fees are application-level configuration, not a per-order Zeko network
transaction fee. The current demo fee model has:

- taker fee in `TAKER_FEE_BPS`
- frontend share in `FRONTEND_FEE_SHARE_BPS`
- remaining fee attributed to protocol balances
- Sepolia sequencer fee mode is currently static in the hosted profile; do not
  build a strategy around a dynamic fee quote until the deployment exposes one

Set a stable `frontendId` such as `agent.alpha` if the strategy is integrated
through a frontend and needs fee attribution. If the strategy submits without a
`frontendId`, the protocol keeps the full configured fee share.

The strategy should obtain the active fee configuration from the deployment
owner or integration contract rather than silently assuming example defaults.

## Deployment Checklist

### Before coding

- [ ] Confirm the service URL and that it is the intended hosted market.
- [ ] Read `/api/darkpool/status` and verify the Sepolia network.
- [ ] Load markets and select `sETH/sZEKO` by returned metadata.
- [ ] Confirm the strategy wallet and signer are on the same intended network.
- [ ] Decide whether the strategy needs public or private order visibility.
- [ ] Confirm the active trading and sequencer fee configuration with the
  deployment owner.

### Before the first order

- [ ] Sync the wallet on-chain balance.
- [ ] Confirm the required private note collateral exists.
- [ ] Confirm open-order reservations are included in available collateral checks.
- [ ] Read the book and apply price, size, and slippage limits.
- [ ] Generate a fresh authorization nonce and expiry.
- [ ] Sign the exact canonical payload.
- [ ] Persist the request id or local decision record before submission.

### After submission

- [ ] Persist order id and cancel token.
- [ ] Reconcile the order status and remaining quantity.
- [ ] Reconcile fills through activity and the order detail endpoint.
- [ ] Track the settlement batch created by fills.
- [ ] Wait for received-asset notes before using them as funding.
- [ ] Cancel stale or undesired GTC orders through the stored cancel token.

### Before real unattended operation

- [ ] Run with a small notional and a hard kill switch.
- [ ] Test timeout, duplicate-submit, stale-sync, partial-fill, and cancel paths.
- [ ] Persist state outside process memory.
- [ ] Alert on repeated HTTP 5xx, GraphQL outage, rejected orders, and stalled
  settlement batches.
- [ ] Keep signing isolated from the strategy process where possible.
- [ ] Review the service's privacy and operator trust assumptions.

## Agent Skills To Load

If the strategy is being developed by a tool-using coding agent, these are the
relevant skills and why they matter:

- `zeko-sepolia`: endpoint, `sETH` native handling, `sZEKO` FT handling,
  explorer/history, and Sepolia-specific wallet behavior.
- `zeko`: Zeko GraphQL, sequencer/archive roles, o1js, bridge/faucet, and
  terminal-first workflows.
- `zeko-auro-zkapp-debug`: Auro-compatible signing, wallet authorization,
  nonce handling, and browser-to-wallet failures.
- `zeko-non-magic-tx`: explicit transaction construction and inspection rather
  than opaque wallet assumptions.
- `shared-liquidity-sdk`: stable `frontendId` attribution and integration
  patterns for multiple clients using one market service.
- `prod-runbook-debugger`: status-driven diagnosis, safe restarts, and
  reconciliation when the service or GraphQL endpoint is degraded.

The reusable repo copies are under `agent-skills/`. The protocol-level API and
SDK references are [api.md](./api.md) and [sdk-spec.md](./sdk-spec.md).

## What To Build First

The highest-value first milestone is not a sophisticated strategy. It is a
reliable adapter with:

1. market discovery
2. book and trade reads
3. note-aware pretrade checks
4. exact wallet message signing
5. one limit-order path
6. durable reconciliation
7. settlement-aware note accounting
8. a kill switch

Once those are correct, add signal logic, market orders, replacement logic, and
multi-market support one at a time. Keep the strategy independent from the
canonical matcher and settlement keys.
