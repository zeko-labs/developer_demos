# API And SDK Reference

## Core APIs

- `GET /api/darkpool/markets`
- `GET /api/darkpool/book?marketId=...&levels=20`
- `GET /api/darkpool/book?pair=sETH/sZEKO&levels=20`
- `GET /api/darkpool/book/hash?marketId=...`
- `GET /api/darkpool/trades`
- `GET /api/darkpool/candles`
- `GET /api/darkpool/activity?wallet=...&limit=150`
- `GET /api/darkpool/status`
- `GET /api/darkpool/fairness/audit?limit=200`
- `GET /api/darkpool/frontends/fees?frontendId=...`

The status response exposes `server.userConfirmation`. The hosted Sepolia
runtime uses `model: "zeko-sequencer"`; `ethereumFinalityRequired` is false
for ordinary deposits, notes, orders, and trades. Ethereum settlement/finality
belongs to bridge and rollup settlement assurance, not the user execution path.

## Account / Balance APIs

- `POST /api/darkpool/accounts/sync-onchain`
- `GET /api/darkpool/accounts/balance?wallet=...`
- `GET /api/darkpool/accounts/onchain-diagnostics?wallet=...`
- `GET /api/darkpool/accounts/pretrade?wallet=...&marketId=...&side=...`

## Order APIs

- `POST /api/darkpool/orders/place`
- `POST /api/darkpool/orders/:id/cancel`
- `POST /api/darkpool/orders/:id/replace`
- `GET /api/darkpool/orders/:id?token=...`

## Settlement APIs

- `GET /api/darkpool/settlement/batches`
- `POST /api/darkpool/settlement/mark-committed`
- `POST /api/darkpool/settlement/cache-payout-proofs`
- `POST /api/darkpool/settlement/cache-private-state-proof`
- `GET /api/darkpool/settlement/payout-requirements?batchId=...`
- `POST /api/darkpool/settlement/commit-next-local`
- `GET /api/darkpool/settlement/proof-job/next`

## Vault / Note APIs

- `POST /api/darkpool/vault/deposit`
- `POST /api/darkpool/vault/deposit/find-latest`
- `POST /api/darkpool/vault/deposit/build-transaction`
- `POST /api/darkpool/vault/deposit/submit-signed`
- `POST /api/darkpool/vault/deposit-intent`
- `POST /api/darkpool/vault/deposit-recover`
- `POST /api/darkpool/vault/deposit-auto`
- `POST /api/darkpool/vault/withdraw`
- `GET /api/darkpool/vault/pool`
- `GET /api/darkpool/notes/status?note=...`
- `GET /api/darkpool/notes/portfolio?wallet=...`

`deposit-intent` records a short-lived wallet/vault balance snapshot before the wallet signs.
If Auro times out without returning a transaction hash, the client polls `deposit-recover`.
Recovery mints exactly once only after Zeko shows the expected wallet decrease and vault increase;
it does not resend the transfer or require Ethereum finality. This is a sequencer-state recovery
mechanism, not a substitute for cryptographic transaction lookup when an indexed transaction hash
is available.

On Sepolia, the browser asks Auro to sign the deposit command with `onlySign: true`; the server
then submits the signed command to the Sepolia `sendZkapp` mutation. This avoids making Auro wait
for the full sequencer broadcast path and keeps the submission retry/recovery boundary in the app.

## Operator APIs

- `POST /api/darkpool/operator/zkapp-state`
- `POST /api/darkpool/operator/private-state-witness`
- `POST /api/darkpool/operator/private-state-merkle`
- `POST /api/darkpool/operator/private-state-proof`

## Maker APIs

- `POST /api/darkpool/maker/quote`
- `POST /api/darkpool/maker/cancel-all`

## SDK

SDK path:
- `/sdk/shadowbook-sdk.js`

Useful methods:
- `getMarkets()`
- `getBook()`
- `getTrades()`
- `getCandles()`
- `getStatus()`
- `getActivity(wallet)`
- `syncOnchainBalance(payload)`
- `placeOrder(payload)`
- `cancelOrder(orderId, cancelToken)`
- `replaceOrder(orderId, payload)`
- `deposit(payload)`
- `depositAuto(payload)`
- `withdraw(payload)`
- `getNotesPortfolio(wallet)`
- `getSettlementBatches(limit)`
- `getOperatorZkappState(adminKey)`
- `getPrivateStateWitness(adminKey)`
- `getPrivateStateMerkle(adminKey)`
- `provePrivateState(adminKey)`

## Fee Routing

Demo fee model:
- taker fee: `TAKER_FEE_BPS`
- frontend revenue share: `FRONTEND_FEE_SHARE_BPS`
- protocol accrues the remainder
- if `frontendId` is absent, the full fee accrues to protocol balances
