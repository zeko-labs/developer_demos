# Pilot Proposal: Identity-Gated Tokenized Equity Access

## Objective

Launch a narrow pilot that proves a consortium can gate subscription, holding, and transfer of a tokenized equity or fund product using identity, suitability, and holdings proofs inside a permissioned environment.

## Why This Pilot

- demonstrates a stronger tokenized asset use case than simple public issuance
- shows how private eligibility and transfer rules can be enforced without leaking raw investor data on-chain
- provides a credible path for regulated capital-markets products inside a consortium-controlled ecosystem

## Pilot Scope

- product: tokenized private fund or equity certificate
- users: approved investor wallets only
- control surfaces:
  - KYC and identity pass state
  - accredited investor or suitability status
  - settled holdings state
  - transfer compliance restrictions

## Operating Model

- identity and holdings sources run through TAP adapter mode
- suitability or accreditation source runs through TAP zkTLS mode
- TAP binds all proof artifacts to active policy version and hash
- transfers are allowed only for approved investors and settled positions
- deployment remains self-hosted for the consortium or operator

## What the Pilot Demonstrates

- private investor eligibility gating for tokenized securities
- mixed integration model across direct APIs and zkTLS HTTPS sources
- transfer restrictions enforced with auditable policy linkage
- a path toward consortium-operated tokenized markets infrastructure

## Minimal Data Sources

- identity and KYC provider
- suitability or accreditation HTTPS source
- custody holdings API

## Success Criteria

- successful identity source transcript
- successful suitability zkTLS transcript
- successful holdings source transcript
- successful policy-linked settlement
- successful transfer compliance transcript

## Deliverables

- tenant and provider configuration
- canonical source mappings
- policy version 1 for investor eligibility and transfer restriction
- demo transcript pack
- release bundle with hashes and public redacted artifacts

## Expansion Path After Pilot

- issuer allocation workflows
- multi-jurisdiction policy packs
- transfer-agent and fund-admin integrations
- consortium cross-institution holdings proofs
