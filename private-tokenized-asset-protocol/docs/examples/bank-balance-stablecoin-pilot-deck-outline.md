# Deck Outline: Permissioned Stablecoin Pilot

## Slide 1: Title

- Permissioned Stablecoin Pilot
- Private consortium issuance with off-chain balance and KYC proofs

## Slide 2: Market Problem

- public-chain tokenization leaks too much customer and operational data
- compliance is often bolted on instead of embedded into issuance and transfer flows
- institutions lose ecosystem control when value accrues to public-chain infrastructure only

## Slide 3: Pilot Thesis

- use TAP to prove eligibility from bank-controlled off-chain data
- keep mint and transfer policy enforcement private and auditable
- deploy in a self-hosted environment aligned with a private rollup or consortium app-chain

## Slide 4: Data Sources

- deposit account balance API
- KYC status API
- optional future source: issuer reserve or treasury account verification

## Slide 5: System Flow

- collect off-chain source data
- generate proof linked to active policy
- require maker-checker approval for mint
- enforce transfer compliance
- retain transcript and release bundle artifacts

## Slide 6: What Is Private

- raw customer balances
- raw KYC records
- internal approval and operating data
- inter-institution operating logic in a consortium setting

## Slide 7: What Is Auditable

- policy version and policy hash
- proof hash and settlement metadata
- maker-checker approvals
- transcript pack and release bundle hashes

## Slide 8: Why This Beats Public Token Issuance

- better privacy
- stronger issuer controls
- more credible compliance story
- better fit for sovereign-rollup or consortium deployment

## Slide 9: Pilot Success Criteria

- successful balance transcript
- successful KYC transcript
- successful policy-linked settlement
- successful maker-checker mint flow
- successful transfer compliance flow

## Slide 10: Expansion Path

- issuer reserve verification
- consortium multi-bank issuance
- private B2B settlement flows
- bridge to public Ethereum stablecoin rails
