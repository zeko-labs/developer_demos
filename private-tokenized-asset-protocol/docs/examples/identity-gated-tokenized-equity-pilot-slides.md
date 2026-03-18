# Identity-Gated Tokenized Equity Pilot

## Slide 1

### Identity-Gated Tokenized Equity Pilot

Private investor eligibility and transfer controls for tokenized securities

Speaker notes:
- This pilot focuses on tokenized securities and private-market style controls.
- The objective is to show a stronger capital-markets use case than public token issuance with simple allowlists.

## Slide 2

### The Problem

- public-chain tokenized securities rely on shallow allowlisting
- investor data needs stronger privacy
- regulated products need richer transfer and suitability controls

Speaker notes:
- For tokenized equities or funds, eligibility is more complex than “is this wallet approved.”

## Slide 3

### The Pilot Thesis

- prove identity, suitability, and holdings from off-chain sources
- tie transfer and access rules to active policy state
- run the system in a self-hosted environment aligned with private-rollup deployment

Speaker notes:
- The value is in combining private evidence with deterministic governance.

## Slide 4

### Data Sources

- identity and KYC provider
- suitability or accredited investor HTTPS source
- custody holdings API

Speaker notes:
- This pilot is intentionally mixed-mode.
- It shows both adapter-based integrations and zkTLS-based source verification.

## Slide 5

### System Flow

1. collect identity and holdings through adapter mode
2. collect suitability through zkTLS mode
3. generate proof linked to policy version and hash
4. enforce transfer compliance
5. retain transcript and release bundle artifacts

Speaker notes:
- This is the core tokenized-securities control loop.

## Slide 6

### What Stays Private

- raw investor identity data
- raw suitability or accreditation records
- raw holdings and custody data
- internal consortium operating logic

Speaker notes:
- This is where a private operating model becomes materially better than public-chain issuance.

## Slide 7

### What Becomes Auditable

- policy version and policy hash
- proof hash and settlement metadata
- eligibility and transfer decision artifacts
- transcript and bundle hashes

Speaker notes:
- Regulators and operators need evidence.
- They do not need unrestricted public disclosure of raw investor data.

## Slide 8

### Why This Beats Public Tokenized Security Issuance

- better investor privacy
- stronger transfer restrictions
- better fit for regulated securities workflows
- better foundation for consortium-operated tokenized markets

Speaker notes:
- The product advantage is not only on-chain distribution.
- It is privacy-preserving control over who can hold and transfer the asset.

## Slide 9

### Success Criteria

- successful identity transcript
- successful suitability zkTLS transcript
- successful holdings transcript
- successful policy-linked settlement
- successful transfer compliance flow

Speaker notes:
- These outputs create a usable proof point for banks, brokers, custodians, and transfer agents.

## Slide 10

### Expansion Path

- issuer allocation workflows
- transfer-agent integrations
- multi-jurisdiction rule packs
- consortium cross-institution holdings verification

Speaker notes:
- The pilot establishes the control plane for a broader tokenized markets system.
