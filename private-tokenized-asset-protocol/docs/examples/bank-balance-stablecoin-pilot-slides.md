# Permissioned Stablecoin Pilot

## Slide 1

### Permissioned Stablecoin Pilot

Private consortium issuance with off-chain balance and KYC proofs

Speaker notes:
- This pilot is about tokenized money for a private, permissioned ecosystem.
- The goal is to show how a bank can issue and govern a stablecoin without exposing customer or operational data on a public chain.

## Slide 2

### The Problem

- public-chain tokenization exposes too much customer and operational data
- compliance is often external to issuance and transfer logic
- institutions lose ecosystem control when infrastructure value accrues elsewhere

Speaker notes:
- Public issuance is easy to explain, but it is not the right operating model for many regulated institutions.
- The missing piece is privacy plus deterministic operational control.

## Slide 3

### The Pilot Thesis

- use off-chain bank data to prove customer eligibility
- tie issuance and transfers to active policy state
- keep the operating model self-hosted and private-rollup ready

Speaker notes:
- This is not just a front-end gating system.
- The objective is to link source data, proofs, policy, and approvals into one auditable flow.

## Slide 4

### Data Sources

- deposit account balance API
- KYC status API
- future expansion: issuer reserve verification

Speaker notes:
- We start narrow with two customer-side sources.
- This is enough to prove the core permissioned stablecoin access story.

## Slide 5

### System Flow

1. collect balance and KYC data from bank-controlled APIs
2. generate proof linked to policy version and hash
3. require maker-checker approval for mint
4. enforce transfer compliance
5. retain transcript and release bundle artifacts

Speaker notes:
- The important feature is that policy linkage survives all the way to settlement and audit output.

## Slide 6

### What Stays Private

- raw customer balances
- raw KYC data
- internal issuer approvals
- inter-institution consortium logic

Speaker notes:
- The system is designed around minimizing what becomes public or broadly shared.

## Slide 7

### What Becomes Auditable

- policy version and policy hash
- proof hash and settlement metadata
- maker-checker approvals
- transcript and bundle hashes

Speaker notes:
- Privacy does not remove accountability.
- It changes what is revealed and where the evidence lives.

## Slide 8

### Why This Beats Public Stablecoin Issuance

- stronger privacy for customers and operators
- stronger issuer control and governance
- better fit for consortium or sovereign-rollup deployment
- clearer path to B2B and bank-grade operating models

Speaker notes:
- The moat is not only the token.
- The moat is the operating model, proof system, and control plane.

## Slide 9

### Success Criteria

- successful balance source transcript
- successful KYC source transcript
- successful policy-linked settlement
- successful maker-checker mint flow
- successful transfer compliance flow

Speaker notes:
- These are the concrete artifacts a bank team can review, rerun, and validate.

## Slide 10

### Expansion Path

- issuer reserve verification
- multi-bank consortium issuance
- private B2B settlement flows
- bridge path to public Ethereum stablecoin rails

Speaker notes:
- The pilot is deliberately narrow.
- The long-term target is a bank-run, private tokenization stack with optional public bridge rails.
