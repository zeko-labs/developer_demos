# Policy and Governance

## Policy Lifecycle

1. Admin upserts policy versions.
2. Active policy resolved by `(tenantId, policyId, asOf)`.
3. Proof generation includes active policy linkage.
4. Settlement re-validates linkage against active snapshot.

## Settlement-Time Guarantee

Settlement is accepted only if:
- linkage exists,
- active policy exists,
- `policyVersion` matches,
- `policyHash` matches.

This prevents stale or tampered policy usage.

## Issuance Governance

- `ISSUER_MAKER` creates mint/burn requests.
- `ISSUER_CHECKER` approves/rejects.
- self-approval blocked.
- settlement requires approved request linkage.

## Operational Governance

- Credential lifecycle gates block expired/rotation-overdue profiles.
- Admin diagnostics endpoint reports credential risk posture before outages.
