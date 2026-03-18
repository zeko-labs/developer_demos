# Prefilled Example: Identity-Gated Tokenized Equity Pilot

This example shows how a consortium would gate access to a permissioned tokenized equity or fund product using identity and eligibility proofs before allowing holding or transfer inside a private rollup environment.

Related documents:
- `docs/examples/identity-gated-tokenized-equity-pilot-proposal.md`
- `docs/examples/identity-gated-tokenized-equity-pilot-checklist.md`
- `docs/examples/identity-gated-tokenized-equity-pilot-memo.md`
- `docs/examples/identity-gated-tokenized-equity-pilot-deck-outline.md`
- `docs/examples/identity-gated-tokenized-equity-pilot-slides.md`
- `docs/examples/identity-gated-tokenized-equity-pilot-one-pager.md`

## 1. Program Scope

- institution name: Example Markets Consortium
- pilot product: permissioned tokenized private fund or equity certificate
- first pilot objective: prove customer identity, KYC pass state, and accredited investor or suitability status before allowing subscription or transfer

## 2. Technical Owners

- business owner: head of tokenized markets
- engineering owner: capital markets platform lead
- security owner: application security lead
- compliance owner: securities compliance lead
- support or operations owner: transfer agent operations lead

## 3. Source Inventory

### Source A

- source name: identity and KYC provider
- source type: identity or KYC
- integration preference: adapter mode
- target environment: sandbox
- expected request frequency: onboarding and periodic refresh
- latency or freshness requirement: less than 10 seconds

### Source B

- source name: accreditation or suitability service
- source type: identity or KYC
- integration preference: zkTLS mode
- target environment: sandbox
- expected request frequency: before initial subscription and on policy refresh
- latency or freshness requirement: less than 30 seconds

### Source C

- source name: custody holdings ledger
- source type: holdings or certificates
- integration preference: adapter mode
- target environment: sandbox
- expected request frequency: before transfer and after settlement reconciliation
- latency or freshness requirement: less than 10 seconds

## 4. Endpoint Details

### Identity API

- base URL: `https://sandbox.identity.example`
- HTTP method: `GET`
- path template: `/v1/customers/{customerId}/verification`
- query parameter requirements: none
- sample success response:

```json
{
  "customer_id": "cust_eq_001",
  "kyc_passed": true,
  "name_match": true,
  "jurisdiction": "US",
  "evaluated_at": "2026-03-12T18:45:00Z"
}
```

### Custody Holdings API

- base URL: `https://sandbox.custody.example`
- HTTP method: `GET`
- path template: `/v1/accounts/{accountId}/positions/{securityId}`
- query parameter requirements: none
- sample success response:

```json
{
  "account_id": "acct_eq_001",
  "security_id": "sec_fund_a",
  "position_quantity": "1250.00",
  "position_status": "settled",
  "as_of": "2026-03-12T18:44:00Z"
}
```

### Accreditation or Suitability HTTPS Source

- base URL: `https://sandbox.suitability.example`
- HTTP method: `GET`
- path template: `/v1/customers/{customerId}/eligibility`
- query parameter requirements: none
- sample success response:

```json
{
  "customer_id": "cust_eq_001",
  "accredited_investor": true,
  "suitability_level": "private_markets",
  "status": "active",
  "evaluated_at": "2026-03-12T18:43:00Z"
}
```

## 5. Authentication and Network Controls

- auth method:
  - identity provider: API key
  - custody provider: OAuth2 client credentials
  - suitability provider: zkTLS over HTTPS source with service credential
- credential delivery method: secret manager references only
- outbound host allowlist entries:
  - `sandbox.identity.example`
  - `sandbox.custody.example`
  - `sandbox.suitability.example`
- inbound webhook IP ranges:
  - optional for future holdings updates
- mTLS certificate requirements:
  - not required in initial pilot
- secret rotation owner and cadence:
  - platform security, every 90 days

## 6. Data Contract

### Identity Fields

- `kycPassed`
  - raw field path: `kyc_passed`
  - type: boolean
  - units: boolean
  - allowed nullability: no
  - business meaning: customer has passed identity and sanctions checks
  - example value: `true`
- `customerId`
  - raw field path: `customer_id`
  - type: string
  - units: provider identifier
  - allowed nullability: no
  - business meaning: unique customer reference
  - example value: `cust_eq_001`
- `jurisdiction`
  - raw field path: `jurisdiction`
  - type: string
  - units: ISO country code
  - allowed nullability: no
  - business meaning: governing residency or issuance regime
  - example value: `US`

### Suitability Fields

- `accreditedInvestor`
  - raw field path: `accredited_investor`
  - type: boolean
  - units: boolean
  - allowed nullability: no
  - business meaning: customer is allowed to subscribe to the product
  - example value: `true`
- `suitabilityLevel`
  - raw field path: `suitability_level`
  - type: string
  - units: enum
  - allowed nullability: no
  - business meaning: product access tier
  - example value: `private_markets`

### Holdings Fields

- `holdingQuantity`
  - raw field path: `position_quantity`
  - type: decimal string
  - units: shares or units
  - allowed nullability: no
  - business meaning: settled holding quantity
  - example value: `1250.00`
- `securityIdentifier`
  - raw field path: `security_id`
  - type: string
  - units: security code
  - allowed nullability: no
  - business meaning: tokenized asset identifier
  - example value: `sec_fund_a`

## 7. Policy Inputs

- jurisdiction: US private markets
- product type: tokenized fund or tokenized equity certificate
- first policy rule set:
  - KYC required: yes
  - accredited investor required: yes
  - suitability level must include `private_markets`
  - transfer allowed only between approved investor wallets
  - holding state must be settled before transfer
- effective date for policy version 1: `2026-03-12T00:00:00Z`
- required approval workflow: maker-checker

## 8. Demo Success Criteria

- successful identity source collect transcript
- successful suitability zkTLS transcript
- successful holdings source collect transcript
- successful policy-linked settlement
- successful transfer compliance transcript

## 9. Recommended First Pilot Shape

- one tokenized asset: `fund_a_private`
- one jurisdiction: US
- one investor onboarding path
- one transfer restriction policy
- no cross-border expansion in the first pilot

## 10. Mapping to TAP

- identity source: adapter mode via `/api/v1/attest/source/collect`
- suitability source: zkTLS mode via `/api/v1/attest/zktls/ingest`
- holdings source: adapter mode via `/api/v1/attest/source/collect`
- transfer restrictions: `transfer_compliance_v1`
- issuance controls: issuer workflow for allocation or mint approval

## 11. Required Deliverables Before Kickoff

- sample customer IDs and account IDs
- sample security identifier
- sandbox credentials for identity and custody providers
- HTTPS test endpoint for suitability source
- compliance sign-off on accredited investor and transfer rules
- named maker and checker operators
