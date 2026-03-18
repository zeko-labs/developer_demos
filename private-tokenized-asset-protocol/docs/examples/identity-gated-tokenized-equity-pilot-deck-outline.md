# Deck Outline: Identity-Gated Tokenized Equity Pilot

## Slide 1: Title

- Identity-Gated Tokenized Equity Pilot
- Private investor eligibility and transfer controls for tokenized securities

## Slide 2: Market Problem

- public-chain tokenized securities rely on shallow allowlisting
- investor data and operating controls need stronger privacy
- regulated products need richer eligibility and transfer controls than public issuance usually provides

## Slide 3: Pilot Thesis

- use TAP to prove identity, suitability, and holdings off-chain
- keep transfer restrictions and policy enforcement deterministic and auditable
- deploy in a self-hosted environment aligned with a private rollup or consortium network

## Slide 4: Data Sources

- identity and KYC provider
- suitability or accredited investor HTTPS source
- custody holdings API

## Slide 5: System Flow

- collect identity and holdings via adapter mode
- collect suitability via zkTLS mode
- generate proof linked to active policy
- enforce transfer compliance
- retain transcript and release bundle artifacts

## Slide 6: What Is Private

- raw investor identity data
- raw suitability or accreditation records
- raw holdings and custody data
- internal transfer governance and consortium operating data

## Slide 7: What Is Auditable

- policy version and hash
- proof hash and settlement metadata
- eligibility and transfer decision artifacts
- transcript pack and release bundle hashes

## Slide 8: Why This Beats Public Tokenized Security Issuance

- better investor privacy
- stronger transfer restrictions
- better fit for regulated capital-markets controls
- better foundation for consortium-operated tokenized markets

## Slide 9: Pilot Success Criteria

- successful identity transcript
- successful suitability zkTLS transcript
- successful holdings transcript
- successful policy-linked settlement
- successful transfer compliance flow

## Slide 10: Expansion Path

- issuer allocation workflows
- transfer-agent integrations
- multi-jurisdiction rule packs
- consortium cross-institution holdings verification
