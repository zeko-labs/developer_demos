# Privacy and Trust Boundaries

## Privacy Model

- Raw partner data stays off-chain.
- Proof/public input carries minimal required assertions.
- Settlement metadata stores hashes/commitments and policy linkage.

## Trust Boundaries

- Partner APIs and webhooks are external trust domains.
- Adapter runtime enforces host allowlists, auth profile policy, mTLS options.
- Credential values are referenced by env key names; values are never returned by diagnostics APIs.

## zkTLS Position

- zkTLS artifacts can be ingested and mapped into TAP proof envelopes.
- TAP currently treats external proof validity via integration contracts and local verification path.
- Additional cryptographic in-circuit verification can be layered in future hardening.

## Auditability

- Immutable adapter and settlement audit logs.
- Transcript generation with integrity verification and sha256 fingerprints.
