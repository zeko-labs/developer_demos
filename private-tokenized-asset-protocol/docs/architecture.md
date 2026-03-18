# Architecture

## Components

1. Private sovereign rollup execution domain for consortium stablecoin issuance.
2. Proof pipeline (eligibility, transfer compliance, reserve coverage).
3. Attestation pipeline (statement upload, phone ownership, zkTLS adapters).
4. Bridge pipeline to public Ethereum L1 stablecoin rails.
5. Auditor/indexer visibility with selective disclosure semantics.

## Trust Boundaries

- Users are permissioned by proofs, not raw PII exposure.
- Issuers can mint/burn only via role-gated and proof-gated methods.
- Bridge entry/exit is policy-gated and event-audited.
