# Customer Memo: Permissioned Stablecoin Pilot

## Summary

This pilot is designed for a bank or consortium that wants to issue and operate a permissioned stablecoin in a private ecosystem, rather than exposing customer and operational data on a public chain. TAP uses off-chain balance and KYC verification, policy-linked proofs, and maker-checker issuance controls to demonstrate how regulated tokenized money can be managed in a private rollup-oriented environment.

## The Problem

Most tokenized stablecoin deployments today are issued publicly and rely on coarse gatekeeping. That model has three weaknesses for regulated institutions:

- customer financial and identity data is too exposed
- issuer workflows are not tied tightly enough to approval and policy state
- ecosystem value accrues to public-chain infrastructure rather than to the bank or consortium operating the product

## The Proposed Pilot

The bank integrates two source systems:

- a deposit account balance API
- a KYC status API

TAP uses those sources to prove that a customer is eligible to access or receive the stablecoin, without pushing raw customer records on-chain. Mint requests remain permissioned and require maker-checker approval. Transfers remain gated by compliance proofs.

## What This Demonstrates

- private customer onboarding for tokenized money
- deterministic policy enforcement tied to policy version and hash
- auditable issuance controls for regulated operators
- a self-hosted operating model suitable for consortium or sovereign-rollup deployment

## Why It Matters

This is not just a wallet demo. It shows how a bank can preserve privacy, governance, and infrastructure control while still benefiting from programmable tokenized assets and interoperability with public rails where needed.

## Pilot Deliverables

- tenant and provider configuration
- source mappings for balance and KYC
- policy version 1 for stablecoin access
- maker-checker issuance flow
- transfer compliance proof flow
- transcript pack and release bundle for internal review

## Recommended Next Step

Use this pilot as the first customer-facing proof point for a bank-run stablecoin program, then expand to issuer reserve verification, consortium multi-issuer controls, and bridge flows to public Ethereum stablecoins.
