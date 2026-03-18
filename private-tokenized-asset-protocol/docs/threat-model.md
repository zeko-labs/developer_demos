# Threat Model (Starter)

## Primary threats

- Key provenance drift across shell/env/hosted runtime
- Nonce race leading to rejected transactions
- Auth-kind mismatch between circuit expectation and tx authorization
- Attestation spoofing / untrusted notary keys
- Bridge replay/finality confusion across domains

## Required controls

- Startup key derivation diagnostics
- Non-magic fee payer tx construction pattern
- Explicit contract permission assertions and redeploy checks
- Trusted notary key pinning
- Bridge operation IDs + replay protection + event confirmation
