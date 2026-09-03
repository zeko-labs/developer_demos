# Sepolia Settlement Relay Diagnosis

## Purpose

This is a focused diagnosis of the current ShadowBook deployment on Zeko Ethereum Sepolia. It records verified observations and the shortest path for restoring zkApp deployment and settlement batch commits.

Do not add private keys, wallet secrets, Render secret values, or local absolute filesystem paths to this document.

## Executive Diagnosis

The order book matcher is working, but settlement is not reaching Zeko.

- Orders can be accepted and matched.
- Settlement batches are being formed and persisted.
- Sepolia GraphQL read queries are reachable and report `SYNCED`.
- Sepolia `sendZkapp` submissions return an HTML Cloudflare `504 Gateway Time-out` after about 30 seconds.
- No deployment transaction was accepted during the verified attempts.
- The settlement zkApp account is still absent on Sepolia.
- The hosted status reports `autoSettlement: false`.

Result: the system is matching trades into pending batches, but no batch has an on-chain commitment.

## Verified Runtime Snapshot

Captured from the hosted status endpoint on 2026-08-31:

```text
buildId: matcher-debug-v3
wallet network: Zeko Ethereum Sepolia
network id: testnet
GraphQL: https://sepolia.zeko.io/graphql
autoSettlement: false
localSettlementEnabled: false
realFundsMode: true
current execution mode: lean
DA mode: disabled
```

Sepolia directly reported:

```text
syncStatus: SYNCED
networkID: zeko:testnet
chainId: 69420
```

The hosted settlement status reported:

```text
pendingSettlementCount: 8
committedSettlementCount: 0
pendingPayoutBatches: 8
latest batch id: 8
latest batch status: pending
latest batch txHash: null
```

The latest batch contained one matched `sETH/sZEKO` trade. This confirms matching and batch formation, not chain settlement.

## Fault Boundary

### 1. GraphQL read path is available

These checks have succeeded:

- `syncStatus`
- `networkID`
- `daemonStatus.chainId`
- account lookup for the funded deployer
- account balance and nonce lookup

This means “the endpoint is synced” is not sufficient evidence that transaction submission is healthy.

### 2. GraphQL transaction path is failing

Direct zkApp deployment attempts reached:

```text
POST https://sepolia.zeko.io/graphql
sendZkapp(...)
```

The response was:

```text
HTTP 504
content-type: text/html; charset=UTF-8
body: Cloudflare 504 Gateway time-out page
```

This is not a JSON GraphQL error. The frontend error `Unexpected token '<'` is the client trying to parse that HTML error page as JSON.

The same class of timeout has appeared in Auro transaction submission. Auro can display the transaction and the user can press **Confirm**, but the transaction may then time out or have no observable on-chain inclusion. This matches the direct ShadowBook `sendZkapp` failures: wallet confirmation completes, while Sepolia relay acceptance or inclusion remains unverified.

### 3. The deployment was not accepted

The corrected deployer private key was validated locally and derived to the supplied funded deployer public key. The existing zkApp private key was also valid and derived to the configured zkApp address.

After the deployment attempts:

- deployer nonce remained unchanged at `9`
- deployer balance remained unchanged
- zkApp account lookup returned `null`
- no deployment transaction hash was returned

Therefore the 504 was not an “accepted but slow” deployment in the checks performed. The command correctly stopped without blindly retrying.

The published Sepolia account-creation fee was `2500` base units. The deployer balance was sufficient for account creation and the configured transaction fee; insufficient account-creation funds are not the primary diagnosis.

## Important Configuration Findings

### `readyToDeploy` and `readyToCommit` are too optimistic

The hosted status currently reports the zkApp as ready because the required environment variables are present. It does not verify that the configured zkApp public key has an account on Sepolia.

Change the preflight semantics so readiness requires:

1. valid key parsing
2. private/public key derivation match
3. successful deployer account lookup
4. successful zkApp account lookup
5. correct Sepolia network identity

Until the zkApp account exists, `readyToCommit` should be `false`.

### `autoSettlement: false`

The hosted service is not advertising an enabled automatic settlement scheduler. Confirm which model is intended:

- If the web service owns the settlement loop, enable and verify its scheduler.
- If a separate worker owns settlement, keep this flag false but verify that the worker is running and is invoking the correct commit command.

Do not treat a successful “no pending batches” worker response as proof of settlement. The worker must log the batch id, submission result, transaction hash, and post-submit account/nonce state.

### Network signing domain

The Sepolia o1js/Auro signing domain is `testnet`. The deployment script previously hard-coded `networkId: 'zeko'`; it was aligned locally to:

```text
ZEKO_O1JS_NETWORK_ID=testnet
```

The deployment still timed out after this correction, so the signing-domain mismatch was a real configuration defect but not the remaining relay failure.

### Settlement batch path

The commit worker previously defaulted to a generic settlement file while the server persisted Sepolia state under the Sepolia data directory. That caused the worker to report no pending batches even when the server had formed them.

The worker path was aligned to `DARKPOOL_DATA_DIR` and the Sepolia settlement state directory. The current status now proves the worker can see persisted batches: eight are pending.

## Observed Auro Pattern

The relevant user-facing sequence is:

1. Auro shows the transaction on the Sepolia Zeko network.
2. The user presses **Confirm**.
3. Auro waits for submission or inclusion.
4. The request times out, or no transaction hash/account-state change becomes observable.

This is consistent with the ShadowBook deployment and settlement failures. It does not by itself prove that Auro signed an invalid transaction. The failure boundary is after wallet confirmation and before verified Sepolia inclusion.

For diagnosis, separate these stages:

1. transaction construction
2. wallet authorization
3. GraphQL relay acceptance
4. sequencer inclusion
5. account/nonce visibility

Only stages 3–5 prove that the transaction reached Zeko.

## Developer Resolution Runbook

### Step 1: Verify the relay, not only health

Ask the Sepolia operator to inspect the exact `sendZkapp` request window and confirm:

- whether the request reaches the sequencer
- whether it enters a transaction queue
- whether it is rejected before queueing
- why the GraphQL gateway returns HTML `504`
- whether the upstream timeout is Cloudflare, GraphQL, or sequencer-side
- whether a request/transaction identifier exists despite the 504

The health query returning `SYNCED` does not close this investigation.

### Step 2: Deploy the zkApp once the relay accepts writes

Use the corrected deployer and existing zkApp key through the repository deployment command. Verify before sending:

```text
ZEKO_GRAPHQL=https://sepolia.zeko.io/graphql
ZEKO_O1JS_NETWORK_ID=testnet
ZKAPP_DEPLOY_USE_ADVANCED=false
```

Then verify all of the following:

- deployment returns a transaction hash, or the account becomes visible after a timeout
- deployer nonce advances from the pre-submit value
- zkApp account exists
- market configuration transaction returns a hash or the configured state becomes readable

If submission returns an unknown timeout, check nonce and account state before retrying.

### Step 3: Make hosted configuration match the deployed account

After deployment, verify that Render uses:

- the same Sepolia GraphQL endpoint
- `networkId: testnet` for o1js/Auro transaction signing
- the deployed zkApp public key
- the intended operator public key
- the corrected deployer private key for the settlement sender
- Sepolia-scoped data paths
- the correct `sETH/sZEKO` market and token contract map

Never copy private keys into this diagnosis or into Git.

### Step 4: Run one settlement smoke test

Use one small matched trade and verify this sequence:

1. trade is accepted
2. a pending batch is formed
3. settlement worker selects that exact batch id
4. `sendZkapp` returns a transaction hash
5. the zkApp account becomes readable
6. the batch changes to committed
7. pending count decreases
8. the committed root matches the submitted batch root

The acceptance criterion is a non-null transaction hash and a committed batch, not merely `ok: true` from a worker endpoint.

## Observability Changes Recommended

Add structured logs with no private payloads:

```text
settlement.batch.selected { batchId, batchHash, tradeCount }
settlement.zkapp.submit.started { batchId, sender, zkappAddress }
settlement.zkapp.submit.result { batchId, httpStatus, txHash, responseType }
settlement.zkapp.submit.unknown { batchId, httpStatus, requestId }
settlement.zkapp.reconcile { batchId, deployerNonce, zkappVisible, committed }
```

For 502/503/504 responses:

- preserve the batch as pending
- mark submission state as unknown
- do not automatically resend
- reconcile nonce, transaction status, and zkApp state
- expose a concise operator-facing error

## Current Bottom Line

Matching and local batch persistence are functioning. Sepolia read health is functioning. The unresolved production blocker is the Sepolia `sendZkapp` relay path, compounded by the fact that automatic settlement is currently reported as disabled and the zkApp account has not been deployed.

Do not debug trade matching or Ethereum finality until one minimal zkApp deployment and one settlement commit are observed on the Sepolia chain.
