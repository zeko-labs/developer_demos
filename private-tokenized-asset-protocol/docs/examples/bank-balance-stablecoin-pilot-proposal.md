# Pilot Proposal: Permissioned Stablecoin Access via Balance and KYC Proofs

## Objective

Launch a narrow pilot that proves a consortium bank can gate access to a permissioned stablecoin using off-chain balance and KYC checks, while keeping issuance and transfer policy enforcement inside a private rollup-oriented architecture.

## Why This Pilot

- moves beyond public-chain gatekeeping toward private, policy-linked issuance
- proves that bank-controlled customer data can drive mint access without exposing raw customer records on-chain
- gives the bank a realistic first deployment path that can later expand to issuer reserve checks, consortium minting, and bridge rails

## Pilot Scope

- product: consortium stablecoin
- users: approved customers inside a permissioned ecosystem
- control surfaces:
  - customer balance threshold
  - KYC pass state
  - maker-checker mint approval
  - transfer compliance proof

## Operating Model

- customer balance API and KYC API are integrated through TAP adapter mode
- TAP generates or verifies proof artifacts tied to policy version and policy hash
- issuer-side mint requests require maker-checker approval
- transfers are gated by `transfer_compliance_v1`
- deployment remains self-hosted for the bank or consortium operator

## What the Pilot Demonstrates

- private, permissioned customer onboarding for tokenized money
- off-chain data verification without relying on public-chain transparency
- deterministic policy enforcement at settlement time
- auditable issuance governance for regulated operators

## Minimal Data Sources

- deposit account balance API
- KYC status API

## Success Criteria

- successful balance source transcript
- successful KYC source transcript
- successful policy-linked settlement
- successful maker-checker mint transcript
- successful transfer compliance transcript

## Deliverables

- tenant and provider configuration
- canonical field mapping
- policy version 1
- demo transcript pack
- release bundle with hashes and public redacted artifacts

## Expansion Path After Pilot

- issuer reserve verification
- consortium multi-issuer controls
- bridge path to public Ethereum stablecoin rails
- stronger privacy controls around customer and inter-institution balances
