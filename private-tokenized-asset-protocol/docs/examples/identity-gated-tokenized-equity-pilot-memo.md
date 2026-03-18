# Customer Memo: Identity-Gated Tokenized Equity Pilot

## Summary

This pilot is designed for a bank, broker, transfer agent, or consortium that wants to issue and operate a permissioned tokenized equity or fund product with stronger privacy and compliance controls than public-chain issuance. TAP combines identity and KYC verification, suitability or accredited investor proofs, holdings data, and transfer compliance to demonstrate a private tokenized securities operating model.

## The Problem

Public-chain tokenized securities are typically limited to wallet allowlists and coarse access control. That is not sufficient for regulated capital-markets products, where issuers need to prove investor eligibility, enforce transfer restrictions, and protect sensitive investor information.

## The Proposed Pilot

The consortium integrates three source systems:

- an identity and KYC provider
- a suitability or accreditation source
- a custody holdings API

TAP uses adapter mode for clean APIs and zkTLS mode for HTTPS sources that are not yet integrated as stable partner APIs. The resulting proofs are tied to active policy state and used to gate access, holdings, and transfers.

## What This Demonstrates

- investor eligibility without exposing raw personal or suitability data on-chain
- mixed integration support across direct APIs and zkTLS-attested HTTPS sources
- policy-linked transfer restrictions for tokenized securities
- a self-hosted operating model that fits consortium or private-rollup deployment

## Why It Matters

This pilot goes beyond simple public issuance. It shows how regulated tokenized assets can preserve privacy, satisfy control expectations, and still support programmable asset logic in a bank-run environment.

## Pilot Deliverables

- tenant and provider configuration
- source mappings for identity, suitability, and holdings
- policy version 1 for investor eligibility and transfer restriction
- transfer compliance proof flow
- transcript pack and release bundle for internal review

## Recommended Next Step

Use this pilot as the first capital-markets proof point, then expand to issuer allocation workflows, multi-jurisdiction policy packs, and consortium-operated tokenized market infrastructure.
