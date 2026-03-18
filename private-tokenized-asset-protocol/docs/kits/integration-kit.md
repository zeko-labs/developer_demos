# Integration Kit

## Adapter Contract

Each partner integration must define:
- source schema
- auth profile type
- mTLS requirements
- extraction mapping to canonical fields
- retry/error semantics

## Bank Customer Intake

Before building a new provider, collect:
- sandbox base URL
- auth method and secret delivery path
- one deterministic resource ID
- one sample success payload
- one sample error payload
- required outbound allowlist entries
- whether the source should run in adapter mode or zkTLS mode
- policy fields required from the source

Map the answers as follows:
- clean server-to-server JSON API -> adapter mode
- HTTPS source without stable partner API contract -> zkTLS mode
- customer balance or KYC eligibility -> `source/collect`
- issuer-side mint or burn controls -> issuer workflow plus settlement

Recommended first bank pilot:
- one balance source
- one KYC or identity source
- one maker-checker mint flow
- one transfer compliance proof

## Priority Integrations for v1

1. Identity/KYC provider (sandbox).
   - Persona adapter path (`provider=persona`) plus signed webhook verification endpoint.
2. Bank balance provider (Plaid already integrated).
3. Holdings/certificate provider for tokenized equities.
   - Custody adapter path (`provider=custody-holdings`) plus signed webhook verification endpoint.

## Security Requirements

- outbound host allowlist
- no raw secrets in payloads
- env-referenced credentials only
- lifecycle metadata for rotation/expiry enforcement
- credential provenance diagnostics before live runs
- mTLS and webhook signing validation where applicable

## Test Requirements

- contract tests for response schema mapping
- negative tests for auth failures and stale credentials
- deterministic transcript generation for each integration
- one live sandbox transcript for the first provider
- one policy-linked settlement transcript for the first provider
