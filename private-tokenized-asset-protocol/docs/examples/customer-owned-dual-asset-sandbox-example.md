# Prefilled Example: Customer-Owned Dual-Asset Sandbox Integration

This example shows what the first real customer engagement should look like when a bank or consortium brings its own sandbox to TAP.

It combines both legs of the target market:

- stablecoin as the private cash leg
- tokenized stock as the private risk-asset leg

The point of this document is not to name a specific vendor. It is to show how a real customer-owned sandbox maps into TAP from intake through transcript generation.

Related documents:

- [customer-sandbox-mapping-kit.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/customer-sandbox-mapping-kit.md)
- [first-customer-integration-template.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/first-customer-integration-template.md)
- [bank-sandbox-onboarding-packet.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/bank-sandbox-onboarding-packet.md)
- [flagship-runbook.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/flagship-runbook.md)

## 1. Customer Profile

- organization: Northstar Bank and Markets
- deployment model: self-hosted TAP stack in customer-controlled environment
- pilot track: dual-asset
- business goal:
  - prove private stablecoin onboarding and mint governance
  - prove tokenized stock gating and restricted transfer lifecycle

## 2. Customer-Owned Sources

### Source A: Deposit Balance API

- source category: balance
- owner: retail/core banking team
- integration mode: adapter
- base URL: `https://sandbox.api.northstarbank.example`
- path: `/v1/accounts/{accountId}/balance`
- auth: OAuth2 client credentials
- purpose: stablecoin access and mint eligibility

### Source B: Customer Identity and KYC API

- source category: identity or KYC
- owner: onboarding and compliance team
- integration mode: adapter
- base URL: `https://sandbox.api.northstarbank.example`
- path: `/v1/customers/{customerId}/kyc-status`
- auth: OAuth2 client credentials
- purpose: stablecoin access and tokenized stock investor gating

### Source C: Brokerage or Custody Holdings API

- source category: holdings or custody
- owner: brokerage operations team
- integration mode: adapter
- base URL: `https://sandbox.brokerage.northstarbank.example`
- path: `/v1/accounts/{accountId}/positions/{securityId}`
- auth: API key or OAuth2 client credentials
- purpose: tokenized stock allocation, restriction, and redemption checks

### Source D: Reserve or Suitability HTTPS Portal

- source category: reserve, suitability, or statement-style eligibility
- owner: treasury or private markets team
- integration mode: zkTLS
- base URL: `https://sandbox.secure.northstarbank.example`
- path: customer-specific HTTPS response
- auth: service credential or portal session
- purpose: prove HTTPS-delivered state without requiring a first-party partner API

## 3. TAP Mapping

### Stablecoin cash leg

- source A maps to:
  - `sourceCategory=balance`
  - `integrationMode=adapter`
  - `settlementOperation=attest_source`
- source B maps to:
  - `sourceCategory=identity`
  - `integrationMode=adapter`
  - `settlementOperation=attest_source`
- downstream TAP workflow:
  - policy-linked eligibility
  - maker-checker mint request
  - mint settlement
  - transfer compliance
  - burn or redemption

### Tokenized stock risk leg

- source B maps to:
  - `sourceCategory=identity`
  - `integrationMode=adapter`
  - `settlementOperation=attest_source`
- source C maps to:
  - `sourceCategory=holdings`
  - `integrationMode=adapter`
  - `settlementOperation=attest_source`
- source D maps to:
  - `sourceCategory=suitability`
  - `integrationMode=zktls`
  - `settlementOperation=attest_source`
- downstream TAP workflow:
  - investor gating
  - stock issue
  - allocation
  - restriction update
  - redeem or exit

## 4. Subject Binding

Every source needs a deterministic subject binding into TAP.

Recommended customer mapping:

- retail customer: `subjectCommitment = hash(customerId + tenantSalt)`
- account-linked checks: link `accountId -> customerId` in customer-owned middleware
- brokerage position checks: link `brokerageAccountId -> subjectCommitment`
- zkTLS sources: bind customer reference in the disclosed fields or authenticated response

## 5. First Policy Set

### Stablecoin policy

- `policyId=1001`
- minimum balance threshold required
- KYC must be passed
- account must be open
- mint requires maker-checker approval

### Tokenized stock policy

- `policyId=2001`
- KYC must be passed
- investor suitability or accredited status required
- holdings state must be settled before transfer
- restriction state enforced before transfer or redemption

## 6. First Customer Deliverable Set

For this first engagement, TAP should deliver:

1. provider bootstrap script for `northstar-balance`
2. provider bootstrap script for `northstar-kyc`
3. provider bootstrap script for `northstar-holdings`
4. zkTLS source config for `northstar-suitability`
5. one dual-asset customer demo runner
6. one customer-specific transcript generator
7. one redacted transcript pack for internal circulation
8. one hardening memo

Current TAP script starting points:

- [bootstrap_customer_balance_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/bootstrap_customer_balance_template.sh)
- [bootstrap_customer_kyc_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/bootstrap_customer_kyc_template.sh)
- [bootstrap_customer_holdings_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/bootstrap_customer_holdings_template.sh)
- [run_customer_balance_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_balance_template.sh)
- [run_customer_kyc_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_kyc_template.sh)
- [run_customer_holdings_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_holdings_template.sh)
- [generate_customer_dual_asset_transcript.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/generate_customer_dual_asset_transcript.sh)
- [run_customer_dual_asset_demo_pack.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_dual_asset_demo_pack.sh)

## 7. Recommended Transcript Pack

The first customer-owned transcript pack should contain:

1. customer balance attestation
2. customer KYC attestation
3. customer holdings attestation
4. customer zkTLS attestation if used
5. stablecoin mint approval and settlement
6. stock issue and allocation flow
7. stock restriction or redemption flow
8. short summary of remaining hardening gaps

## 8. Early Risk Review

Likely first integration risks:

- OAuth credentials issued but sandbox records are nondeterministic
- subject binding not clean across banking and brokerage systems
- webhook payloads differ from documented schema
- holdings API uses decimals or strings that need normalization
- HTTPS portal response is not stable enough for first zkTLS pass

## 9. Definition Of Done

This customer mapping is complete when:

- one customer-owned balance source runs in TAP
- one customer-owned identity source runs in TAP
- one customer-owned holdings source runs in TAP
- one dual-asset transcript pack is verified
- the customer can review a redacted package and decide whether to proceed to pilot hardening

## 10. Why This Is The Right First Customer Shape

This structure matches the actual product story:

- stablecoin is not treated as an isolated token issuance demo
- tokenized stock is not treated as a separate, unrelated pilot
- both are shown as two legs of one private market stack
- the customer sees exactly how its own systems would plug into TAP
