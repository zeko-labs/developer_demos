# Prefilled Example: Bank Balance Stablecoin Pilot

This example shows how a consortium bank would use TAP to prove customer-side balance eligibility before granting access to mint or receive permissioned stablecoin inside a private rollup environment.

Related documents:
- `docs/examples/bank-balance-stablecoin-pilot-proposal.md`
- `docs/examples/bank-balance-stablecoin-pilot-checklist.md`
- `docs/examples/bank-balance-stablecoin-pilot-memo.md`
- `docs/examples/bank-balance-stablecoin-pilot-deck-outline.md`
- `docs/examples/bank-balance-stablecoin-pilot-slides.md`
- `docs/examples/bank-balance-stablecoin-pilot-one-pager.md`

## 1. Program Scope

- institution name: Example Consortium Bank
- pilot product: permissioned consortium stablecoin
- first pilot objective: prove customer balance threshold and KYC pass state before enabling mint access or stablecoin wallet activation

## 2. Technical Owners

- business owner: head of digital assets
- engineering owner: payments platform lead
- security owner: infrastructure security lead
- compliance owner: BSA and AML program lead
- support or operations owner: treasury operations lead

## 3. Source Inventory

### Source A

- source name: deposit account balance API
- source type: balance or account state
- integration preference: adapter mode
- target environment: sandbox
- expected request frequency: on wallet activation and before mint approval
- latency or freshness requirement: less than 5 seconds, same-day ledger freshness

### Source B

- source name: KYC status API
- source type: identity or KYC
- integration preference: adapter mode
- target environment: sandbox
- expected request frequency: on onboarding and periodic refresh
- latency or freshness requirement: less than 10 seconds

## 4. Endpoint Details

### Balance API

- base URL: `https://sandbox.bank.example`
- HTTP method: `GET`
- path template: `/v1/accounts/{accountId}/balance`
- query parameter requirements: none
- sample request:

```http
GET /v1/accounts/acct_demo_001/balance HTTP/1.1
Authorization: Bearer <token>
Accept: application/json
```

- sample success response:

```json
{
  "account_id": "acct_demo_001",
  "customer_id": "cust_demo_001",
  "currency": "USD",
  "current_balance_cents": 2500000,
  "available_balance_cents": 2400000,
  "account_status": "open",
  "as_of": "2026-03-12T19:00:00Z"
}
```

- sample error response:

```json
{
  "error": {
    "code": "account_not_found",
    "message": "Unknown account id"
  }
}
```

- stable resource IDs for testing:
  - `acct_demo_001`
  - `acct_demo_002`

### KYC API

- base URL: `https://sandbox.bank.example`
- HTTP method: `GET`
- path template: `/v1/customers/{customerId}/kyc-status`
- query parameter requirements: none
- sample success response:

```json
{
  "customer_id": "cust_demo_001",
  "kyc_passed": true,
  "risk_tier": "standard",
  "jurisdiction": "US",
  "evaluated_at": "2026-03-12T18:59:00Z"
}
```

## 5. Authentication and Network Controls

- auth method: OAuth2 client credentials
- credential delivery method: secret manager references only
- outbound host allowlist entries:
  - `sandbox.bank.example`
- inbound webhook IP ranges: none in pilot
- mTLS certificate requirements: not required in pilot sandbox
- secret rotation owner and cadence: platform security, every 90 days

## 6. Data Contract

### Balance Fields

- `currentBalanceCents`
  - raw field path: `current_balance_cents`
  - type: integer
  - units: cents
  - allowed nullability: no
  - business meaning: total posted account balance
  - example value: `2500000`
- `availableBalanceCents`
  - raw field path: `available_balance_cents`
  - type: integer
  - units: cents
  - allowed nullability: no
  - business meaning: spendable balance after holds
  - example value: `2400000`
- `currency`
  - raw field path: `currency`
  - type: string
  - units: ISO currency code
  - allowed nullability: no
  - business meaning: account currency
  - example value: `USD`
- `accountStatus`
  - raw field path: `account_status`
  - type: string
  - units: enum
  - allowed nullability: no
  - business meaning: account lifecycle state
  - example value: `open`

### KYC Fields

- `kycPassed`
  - raw field path: `kyc_passed`
  - type: boolean
  - units: boolean
  - allowed nullability: no
  - business meaning: customer has passed onboarding and screening
  - example value: `true`
- `customerId`
  - raw field path: `customer_id`
  - type: string
  - units: provider identifier
  - allowed nullability: no
  - business meaning: internal customer identifier
  - example value: `cust_demo_001`

## 7. Policy Inputs

- jurisdiction: US
- product type: consortium stablecoin
- first policy rule set:
  - minimum balance: `100000` cents
  - KYC required: yes
  - account must be open: yes
  - available balance must be positive: yes
- effective date for policy version 1: `2026-03-12T00:00:00Z`
- required approval workflow: maker-checker

## 8. Demo Success Criteria

- successful balance source collect transcript
- successful KYC source collect transcript
- successful policy-linked settlement
- successful maker-checker mint approval transcript
- successful transfer compliance transcript

## 9. Recommended First Pilot Shape

- one tenant: `tenant-a`
- one issuer: `issuer_demo_bank`
- one stablecoin asset policy
- one mint approval flow
- one transfer compliance flow

## 10. Mapping to TAP

- balance source: adapter mode via `/api/v1/attest/source/collect`
- KYC source: adapter mode via `/api/v1/attest/source/collect`
- mint governance: issuer workflow
- transfer restrictions: `transfer_compliance_v1`

## 11. Required Deliverables Before Kickoff

- OAuth2 sandbox credentials
- sample account and customer IDs
- approved allowlist entry for `sandbox.bank.example`
- compliance sign-off on minimum balance and KYC rules
- named maker and checker operators
