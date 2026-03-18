# External zkTLS Adaptations

This repository vendors a locally adapted copy of `zeko-labs/zk-verify-poc` under [`external/zk-verify-poc`](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/external/zk-verify-poc).

The upstream project was a strong starting point for zkTLS-backed attestation on Zeko testnet. For TAP, we extended it so it can support a more bank-oriented, operator-friendly tokenization demo.

## Why this adaptation exists

The upstream PoC focused on employer-data eligibility. TAP needed a broader source-attestation surface:

- a bank-balance-style source profile
- profile-aware disclosure and proving inputs
- better runtime portability for local operators
- tighter trusted-notary handling
- a cleaner bridge into TAP source-collect and settlement flows

Those changes make the external component more useful as a production-adjacent reference, rather than only a narrow single-demo artifact.

## What changed

### 1. Added bank-source mode

The external mock server and runner now support a bank-balance-shaped fixture path in addition to the original employment path.

Key additions:

- `GET /api/v1/accounts/balance?account_id=...`
- deterministic sample bank records
- `run-poc-bank.sh` wrapper for a bank-profile pipeline run

Why it matters:

- lets TAP demonstrate asset-tokenization inputs that look like reserve, balance, or account-eligibility data
- better matches stablecoin and treasury-control narratives than employer-only data

### 2. Added profile-aware extraction and proving

The disclosure and prove-input pipeline no longer assumes a single employer schema.

We added profile-sensitive behavior for:

- `employment`
- `bank`

That includes:

- bank-native disclosed fields such as current balance and available balance
- canonical aliases so existing proving flows still work
- profile-specific policy thresholds

Why it matters:

- one zkTLS pipeline can now support multiple high-value institutional source types
- this is closer to how a real integration platform would behave

### 3. Tightened trusted notary handling

The local copy derives the trusted notary public key from the configured signing key instead of relying on a stale or mismatched static assumption.

Why it matters:

- reduces config drift risk
- better aligns the proving pipeline with the actual runtime key material
- avoids a class of “works locally, mismatches later” problems

### 4. Improved operator portability

The runner now honors `MOON_BIN` and related execution assumptions more cleanly.

Why it matters:

- fewer local environment surprises
- easier to run from TAP orchestration scripts
- closer to a repeatable operator workflow

### 5. Expanded tests around the new source profile

The adapted copy includes additional tests for:

- bank-mode extraction
- bank-mode prove-input behavior
- mock-server support for the new route

Why it matters:

- the new path is not just scaffolded, it is validated
- changes are safer to reuse in future customer integrations

### 6. Updated tlsnotary runtime pieces

The local copy also includes changes in:

- `tlsnotary/Cargo.toml`
- `tlsnotary/Cargo.lock`
- `tlsnotary/src/bin/notary.rs`
- `tlsnotary/src/bin/prover.rs`

These changes were made to keep the local TAP-linked flow working against the adapted source profile and runtime assumptions.

Why it matters:

- the vendored copy reflects the actual code used during TAP integration work
- publishing TAP without these changes would omit part of the working zkTLS path

## Net effect

Compared with the upstream PoC, the vendored copy is more production-ready in the following ways:

- supports more than one attestation profile
- better matches bank/treasury-style data collection
- is easier to operate locally
- is less fragile around key configuration
- is better tested for the added path
- maps more naturally into TAP's source-collect and settlement model

## Provenance note

The upstream project remains the original foundation for this component. TAP vendors a modified local copy because the integration work required functionality and runtime behavior beyond the original PoC scope.
