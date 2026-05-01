# Zeko zkApp Boundary

`PrivateComputeAccess.ts` is the contract boundary for the live Zeko version of the demo.

The current local app runs the same shape in mock-audit mode. This zkApp is the next hardening step:

- `datasetRoot`: commitments to private datasets that agents may compute over
- `authRoot`: commitments to ZK-backed OAuth authorizations
- `receiptRoot`: commitments to completed private-compute outputs and payment receipts
- `beneficiary`: settlement recipient expected by the x402 Zeko rail

The intended live call sequence is:

1. Enterprise OAuth provider issues claims.
2. Server or wallet derives a ZK OAuth authorization commitment.
3. App updates `authRoot`.
4. Private dataset owner registers a dataset commitment into `datasetRoot`.
5. Agent pays through the Zeko x402 settlement rail.
6. Private compute runs off-chain.
7. App records a `PrivateComputeReceipt` commitment into `receiptRoot`.

This keeps raw OAuth claims, private records, and raw compute context off-chain while giving agents and auditors a Zeko-verifiable trail.

For this local Codex workspace, the scaffold imports `o1js` from the sibling `../zeko-x402` checkout so it can build without installing a second copy of the Zeko toolchain.
