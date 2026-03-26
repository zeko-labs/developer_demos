---
name: zeko-auro-zkapp-debug
description: Debug browser-to-Auro wallet flows for Zeko zkApps, including wallet connection, unsigned transaction building, Auro sendTransaction usage, nonce and authorization mismatches, and proof-related failures. Use when a Zeko app can connect to Auro but zkApp transactions fail, stall, show nonce errors, or behave differently from message-signing flows.
---

# Zeko Auro zkApp Debug

Use this skill when an app on Zeko can detect or connect Auro, but a real zkApp transaction still fails or behaves inconsistently.

## Core Rule

Separate the problem into three layers before changing code:
- Wallet transport: Auro detection, account access, `sendTransaction()` input shape
- Fee payer state: wallet account, fee, fee payer nonce handling
- zkApp state: zkApp authorization kind, proof status, zkApp account nonce

Do not treat every `Account_nonce_precondition_unsatisfied` error as a wallet nonce bug.

## Working Flow

Follow this sequence unless there is a strong reason not to:
1. Read runtime config from the server.
2. In the browser, call `window.mina.requestAccounts()`.
3. Immediately call `window.mina.getAccounts()` and use the first account as the active wallet.
4. Build the unsigned zkApp transaction server-side.
5. If the tx includes proved account updates, call `await tx.prove()` server-side before returning JSON.
6. Sign server-side only with keys the app controls, such as the zkApp private key.
7. Return `tx.toJSON()` and the exact fee string used to build the tx.
8. In the browser, call:

```js
await window.mina.sendTransaction({
  transaction: txData.tx,
  feePayer: { fee: txData.fee }
});
```

Keep the browser `sendTransaction()` call as plain as possible. Do not improvise extra fields unless a known-good example requires them.

## First Checks

Check these first because they explain most failures quickly:
- Auro is present as `window.mina`
- `requestAccounts()` succeeds
- `getAccounts()` returns the same public key the UI thinks is connected
- the server and wallet are targeting the same Zeko network
- the tx builder returns the same fee string the browser passes to Auro
- the server returns a fully built zkApp command, not a half-built intent

## High-Value Fixes

### 1. Match a known-good Auro flow exactly

If the repo has a successful Auro integration, compare against that first. Look for:
- wallet connect pattern: `requestAccounts()` then `getAccounts()`
- `sendTransaction()` shape
- whether the tx is proved server-side
- whether the browser sends the exact server-built fee

Small transport mismatches matter.

### 2. Prove server-side when the tx needs proofs

If the wallet path throws errors like `remote tx prover unavailable` or behaves as if Auro is expected to prove the tx, make sure the server calls:

```ts
await tx.prove();
```

before returning the transaction JSON.

### 3. Handle fee payer updates conservatively

If working examples do this, copy the pattern exactly:
- clear fee payer nonce preconditions when appropriate
- set `useFullCommitment = true`

Example:

```ts
const feePayerUpdate = (tx as any).feePayer;
if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
  feePayerUpdate.body.preconditions.account.nonce = {
    isSome: Bool(false),
    value: UInt32.from(0)
  };
}
if (feePayerUpdate?.body) {
  feePayerUpdate.body.useFullCommitment = Bool(true);
}
```

Do not assume this alone fixes nonce failures.

### 4. Check the zkApp account nonce when using signature-authorized zkApp updates

If the contract method uses `requireSignature()` or otherwise creates a signed zkApp account update, the zkApp account update can carry its own nonce precondition.

In that case, fetch the latest on-chain zkApp account and require its nonce explicitly before calling the method:

```ts
const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
const zkappNonce = zkappAccount.account.nonce;

const tx = await Mina.transaction({ sender: feePayerKey, fee }, async () => {
  zkapp.account.nonce.requireEquals(zkappNonce);
  await zkapp.someMethod(...);
});
```

This is a critical check. A wallet nonce can be correct while the tx still fails because the zkApp account nonce is stale.

## Error Guide

### `Account_nonce_precondition_unsatisfied`

Check in this order:
1. wallet public key matches the fee payer key used by the server
2. browser sends the exact fee from the server
3. fee payer nonce precondition handling matches the known-good app
4. zkApp account nonce is fetched fresh and required explicitly if the zkApp update is signature-authorized

If the wallet nonce shown in the UI matches the suggested nonce and the error persists, suspect the zkApp account nonce next.

### `remote tx prover unavailable`

Usually means the transaction still expects proving work that was not done before handing the tx to the wallet. Prove server-side first.

### Wallet connect works but tx send fails

That usually means message signing and zkApp transaction flow have diverged. Compare the full browser/server transaction path against a known-good app instead of debugging connect code in isolation.

## UI and Data Sanity Checks

If users say queued items disappeared, check storage before changing chain logic.
- verify the pending queue file or table directly
- verify the prayer or request record exists separately
- verify the UI is rendering the actual pending source, not a stale duplicate panel or derived flag

Treat storage, queue membership, and UI rendering as separate checks.

## Good Outcome

Aim to return one of these, not a vague “wallet issue”:
- connected wallet state with the active public key
- accepted zkApp tx hash
- precise failing step: connect, tx build, prove, send, confirm, or UI render
