# Flagship Demo Plan

## Goal

Demonstrate TAP as the control plane for a private, permissioned tokenized market, not as a single-asset demo.

The flagship story should show two linked asset classes in parallel:

- stablecoin for private cash and settlement rails
- tokenized stock or fund exposure for private asset trading

Together, these form the minimal two-way market story:

- customers can hold private cash on-chain
- customers can hold private assets on-chain
- issuance, access, and transfer are controlled by policy-linked proofs

## Why Both Tracks Matter

Stablecoin alone proves private money movement, but not market structure.

Tokenized stock alone proves private asset access, but not how settlement cash works.

Running both in parallel proves the more important claim:

- TAP can power private issuance and private exchange-like flows across multiple asset classes

## Public Demo Message

The public repo should show:

- reference integrations for source data
- proof generation and verification
- policy-linked settlement
- issuer controls
- parallel stablecoin and tokenized stock workflows

The message to banks is:

- this is the tooling stack
- these are the reference integrations
- this is how the operating model works
- when you are ready, we will wire the PoC to your own sandbox

## Track A: Stablecoin

Core story:

- customer balance and KYC determine eligibility
- issuer maker-checker controls mint and burn
- transfer compliance gates movement
- stablecoin acts as private cash rail inside the permissioned environment

## Track B: Tokenized Stock

Core story:

- identity, suitability, and holdings drive eligibility
- issuer or allocator controls subscription or issuance
- transfer restrictions enforce who can hold and move the asset
- tokenized stock acts as private risk asset inside the same environment

## Shared Infrastructure Across Both Tracks

- tenant-scoped provider configs
- policy engine and policy linkage
- proof runtime
- settlement registry
- audit and transcript pack
- operator runbooks

## Recommended Primary Demo Sequence

1. stablecoin customer eligibility and mint approval
2. stablecoin transfer compliance
3. tokenized stock investor eligibility
4. tokenized stock transfer restriction flow
5. show both assets as components of one private market design

## What the Demo Does Not Need

- public hosted consumer app
- real exchange matching engine
- rollup implementation in this repo
- live customer production credentials

## What the Demo Must Make Obvious

- stablecoin and stock tokenization are complementary, not separate product bets
- privacy and policy linkage are the moat
- the repo is provider-agnostic
- the real next step is customer-owned sandbox integration
