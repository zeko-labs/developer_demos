# Notes: Zeko zkApp + Proof + Wallet Signing (Lessons Learned)

## Zeko zkApp deploy + network
- Zeko Ethereum Sepolia GraphQL endpoint: `https://sepolia.zeko.io/graphql`.
- Network ID matters for signatures. In practice, use `ZEKO_NETWORK_ID=testnet` for deployment/signing on Zeko Ethereum Sepolia.
- Fee must be **integer sETH base units** (e.g. `100000000` for 0.1 sETH). Decimals like `0.1` cause BigInt errors.
- When deploying a zkApp on Zeko Ethereum Sepolia, pre-fund the zkApp account to avoid `Invalid_fee_excess` during account creation.

## Proof generation vs on-chain verification
- Recursive proof verification inside the zkApp can be brittle in practice (e.g. "permutation not constructed correctly").
- A robust alternative is: **off-chain oracle + signature**, and on-chain method verifies the oracle signature.
- This keeps the on-chain circuit small and avoids recursion-related prover failures.

## Permissions & signature-based updates
- If you want signature-based updates (instead of proof), set:
  - `this.account.permissions.set({ ...Permissions.default(), editState: Permissions.proofOrSignature() })` in `init()`.
  - Require signatures in method with `this.requireSignature()`.
- After permission changes, you must **redeploy** the zkApp (permissions are stored on-chain).

## Wallet (Auro) signing pitfalls
- `Account_nonce_precondition_unsatisfied` is about **fee payer nonce** mismatch, not zkApp state.
- Even with matching nonce in UI, the chain may reject if a pending tx updates the nonce between build and submit.
- o1js auto-preconditions can set stale nonce checks on fee payer updates.
- A “non-magic” flow can fix it:
  - Clear fee payer nonce precondition.
  - Force full commitment on fee payer update.

## Non-magic fee payer flow (recommended)
- Clear fee payer nonce precondition:
  - `feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) }`
- Use full commitment:
  - `feePayerUpdate.body.useFullCommitment = Bool(true)`
- This avoids stale nonce preconditions that trigger `Account_nonce_precondition_unsatisfied`.

## Mempool + nonce debugging
- It’s possible to see **no mempool entries** yet still hit nonce precondition errors due to race conditions.
- Use an on-chain nonce fetch immediately before building the tx.
- If needed, retry with nonce+1 (server-side) to handle race windows.

## Practical deployment flow (stable)
- Pre-fund zkApp account.
- Deploy with `ZEKO_NETWORK_ID=testnet` and integer fee.
- Use signature-based state updates for reliability.
- On submit, let the server attach zkApp signature; Auro signs fee payer.

## Merkle root anchoring
- Store image-hash+verdict leaves in a Merkle tree off-chain.
- Anchor only the root on-chain; verify membership with a Merkle proof.
- This supports historical verification without storing all hashes on-chain.
