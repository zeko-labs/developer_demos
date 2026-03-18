# Bank Sandbox Onboarding Packet

Use this packet before implementing a new bank or issuer integration. The goal is to collect the smallest set of information required to run one live TAP transcript against the partner sandbox.

See also:
- `docs/examples/bank-balance-stablecoin-pilot.md`
- `docs/examples/identity-gated-tokenized-equity-pilot.md`

## 1. Program Scope

- institution name
- pilot product:
  - stablecoin
  - tokenized deposit
  - tokenized fund or ETF exposure
  - tokenized equity or certificate-backed asset
- first pilot objective:
  - prove customer balance threshold
  - prove KYC or identity status
  - prove holdings or certificate ownership
  - prove issuer reserve sufficiency

## 2. Technical Owners

- business owner
- engineering owner
- security owner
- compliance owner
- support or operations owner

## 3. Source Inventory

For each source in the pilot, provide:

- source name
- source type:
  - identity or KYC
  - balance or account state
  - holdings or certificates
  - issuer reserve or treasury data
- integration preference:
  - adapter mode
  - zkTLS mode
- target environment:
  - sandbox
  - staging
- expected request frequency
- latency or freshness requirement

## 4. Endpoint Details

For each adapter-mode source, provide:

- base URL
- HTTP method
- path template
- query parameter requirements
- sample request
- sample success response
- sample error response
- stable resource IDs for testing

## 5. Authentication and Network Controls

- auth method:
  - API key
  - OAuth2 client credentials
  - mTLS
  - signed webhook
- credential delivery method
- outbound host allowlist entries
- inbound webhook IP ranges, if applicable
- mTLS certificate requirements, if applicable
- secret rotation owner and cadence

## 6. Data Contract

For each first-class decision field, provide:

- raw field path in provider response
- type
- units
- allowed nullability
- business meaning
- example value

Recommended first fields:

- `currentBalanceCents`
- `availableBalanceCents`
- `currency`
- `accountStatus`
- `kycPassed`
- `customerId`
- `holdingQuantity`
- `securityIdentifier`

## 7. Policy Inputs

- jurisdiction
- product type
- first policy rule set:
  - minimum balance
  - KYC required
  - accredited investor required
  - account must be open
  - holdings threshold
- effective date for policy version 1
- required approval workflow:
  - admin only
  - maker-checker

## 8. Demo Success Criteria

- one successful live source collect transcript
- one successful policy-linked settlement
- one approval transcript if issuance control is in scope
- one public redacted artifact bundle suitable for internal review

## 9. Recommended First Pilot Shape

- one customer source:
  - bank balance or KYC pass state
- one issuer control:
  - maker-checker mint approval
- one transfer control:
  - transfer compliance

Do not start with multiple providers, multiple products, or multi-jurisdiction policy packs in the first pilot.

## 10. Mapping to TAP

- choose `adapter mode` when the partner already exposes a clean machine-callable sandbox API
- choose `zkTLS mode` when the source is HTTPS-accessible but not yet integrated as a stable partner API
- choose `source/collect` when the objective is proving eligibility from off-chain data
- choose issuer workflow when the objective is proving controlled mint or burn operations

## 11. Required Deliverables Before Kickoff

- signed-off source inventory
- sandbox credentials or credential delivery plan
- sample payloads
- resource IDs for deterministic test runs
- named owners for engineering, security, and compliance
