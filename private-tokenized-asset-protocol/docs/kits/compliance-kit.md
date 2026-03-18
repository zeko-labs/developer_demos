# Compliance Kit

## Policy Governance

- versioned policy registry
- deterministic `policyHash`
- explicit effective dates and jurisdiction tags
- settlement-time policy linkage enforcement
- risk controls per tenant/operation (`eligibility`, `mint`, `burn`) with pre-settlement enforcement

## Issuance Governance

- maker-checker approvals for mint/burn
- role-scoped API keys
- immutable approval and settlement metadata linkage

## Evidence Artifacts

- transcript bundles (`output/demo-transcripts`)
- transcript verifier (`scripts/verify_transcript.sh`)
- audit trails:
  - `output/source-adapter-audit.ndjson`
  - `output/policy-settlement-audit.ndjson`

## Audit Narratives

- stablecoin issuance under policy controls
- tokenized equity issuance with holdings attestations
- consortium multi-tenant policy isolation
