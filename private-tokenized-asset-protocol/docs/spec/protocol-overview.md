# Protocol Overview

## Purpose

TAP enables regulated banks or consortiums to:
- collect off-chain evidence (identity, balances, holdings/certificates),
- evaluate policy/risk controls privately,
- generate proofs and policy-linked settlement records,
- control permissioned mint/burn/transfer workflows,
- integrate with a private/permissioned rollup runtime.

## Non-Goals

- TAP does not implement a rollup or sequencer.
- TAP does not prescribe a public hosted UI.

## Core Components

- API Gateway: role-scoped workflow orchestration.
- Source Adapters: partner API ingestion (OAuth2, mTLS, lifecycle gates).
- Policy Engine: versioned policy with deterministic hash.
- Prover Service: proof generation and local verification.
- Settlement Registry: immutable settlement records and state transitions.
- Auditor/Diagnostics: evidence, health, credential risk posture.

## Primary Flows

1. Stablecoin issuance:
   - collect bank balance + identity evidence
   - generate eligibility proof linked to active policy
   - maker submits mint request, checker approves
   - settle issuance with policy snapshot linkage

2. Tokenized stock issuance:
   - collect identity, suitability, and holdings evidence
   - evaluate equity-specific policy set
   - approve issuance or allocation
   - enforce transfer restrictions and lifecycle state transitions
   - follow same maker-checker + settlement guard path

3. Consortium operation:
   - tenant-scoped configs and credentials
   - common policy/governance controls
   - isolated audit trail per tenant/provider/profile

## Market Thesis

TAP is designed to simulate and control a private two-way market structure:

- stablecoin provides the cash leg
- tokenized stock provides the risk-asset leg
- policy-linked proofs and approvals govern both
