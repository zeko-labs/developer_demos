# Asset Lifecycle

## Purpose

TAP needs a clear lifecycle model for both cash-like and security-like tokenized assets. This is required to simulate a private market where stablecoins and tokenized stocks coexist.

This spec defines the control-plane states and workflow expectations for:

- stablecoin issuance and redemption
- tokenized stock issuance, allocation, holding, transfer, and redemption

## Asset Classes

### Stablecoin

Primary use:
- private settlement cash

Primary controls:
- customer eligibility
- issuer mint approval
- transfer compliance
- burn or redemption approval

### Tokenized Stock

Primary use:
- private risk asset

Primary controls:
- investor identity and suitability
- issuance or subscription approval
- allocation state
- holding and transfer restrictions
- redemption or corporate action exit path

## Common Lifecycle States

These states are shared conceptually across asset classes:

- `draft`
- `requested`
- `approved`
- `issued`
- `active`
- `restricted`
- `redeem_requested`
- `redeemed`
- `rejected`
- `cancelled`

## Stablecoin Lifecycle

### 1. Eligibility

- collect balance and KYC evidence
- generate eligibility proof linked to active policy
- reject if balance, KYC, or policy linkage fails

### 2. Mint Request

- issuer maker creates mint request
- request includes:
  - assetId
  - issuerId
  - recipient commitment
  - amount
  - policy linkage

### 3. Mint Approval

- issuer checker approves or rejects
- self-approval is blocked
- approval metadata records checker identity and policy snapshot

### 4. Mint Settlement

- approved mint is settled
- settlement verifies policy version and policy hash
- record becomes auditable artifact

### 5. Active Holding

- customer can hold stablecoin subject to transfer rules
- transfers require compliance proof where configured

### 6. Burn or Redemption

- issuer or authorized workflow requests burn
- checker approves where required
- burn settlement records the final policy-linked state transition

## Tokenized Stock Lifecycle

### 1. Investor Eligibility

- collect identity evidence
- collect suitability or accredited-investor evidence
- optionally collect holdings or certificate evidence
- generate proof linked to active policy

### 2. Issuance or Subscription Request

- issuer or allocator creates issuance request
- request includes:
  - assetId
  - investor commitment
  - quantity
  - issuance type
  - policy linkage

### 3. Approval

- checker approves or rejects allocation or issuance
- approval records policy snapshot and approver identity

### 4. Allocation

- approved quantity is allocated to investor commitment
- allocation status becomes part of the asset audit trail

### 5. Active Holding

- investor can hold the tokenized stock
- transfers are allowed only if:
  - identity remains valid
  - suitability remains valid
  - transfer restrictions are satisfied

### 6. Restricted State

- asset can move into restricted state if:
  - policy changes
  - investor eligibility expires
  - corporate action or compliance hold applies

### 7. Redemption or Exit

- redemption, cancellation, or exit event is requested
- approvals are recorded as needed
- final settlement records the terminal asset state

## Required Workflow Dimensions

Both asset classes should support:

- maker-checker approval
- policy-linked proof settlement
- tenant isolation
- auditable state transitions
- replay-safe workflow identifiers

## Demo Requirements

The demo should explicitly simulate:

- stablecoin mint
- stablecoin transfer compliance
- stablecoin burn or redemption
- tokenized stock issuance or subscription
- tokenized stock transfer restriction
- tokenized stock redemption or exit

## Non-Goals

This lifecycle spec does not define:

- exchange matching
- order books
- rollup sequencing
- public market data feeds

Those belong to adjacent systems, not TAP itself.
