# Customer Sandbox Mapping Kit

This is the bridge from the public TAP repo to the first customer-owned proof point.

Use it when a bank, issuer, broker, custodian, or consortium team says they want to try TAP with their own sandbox or internal system.

## Objective

Produce one customer-specific transcript pack against a customer-owned source.

That first integration should prove:

- the source can be mapped into TAP
- adapter mode or zkTLS mode is clear
- policy-linked settlement works on customer-shaped data
- the customer can see the next hardening steps

## Start Here

1. Collect the intake from [bank-sandbox-onboarding-packet.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/bank-sandbox-onboarding-packet.md)
2. Fill [first-customer-integration-template.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/first-customer-integration-template.md)
3. Review [customer-owned-dual-asset-sandbox-example.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/examples/customer-owned-dual-asset-sandbox-example.md)
4. Choose the first pilot lane

## Pick The First Pilot Lane

Choose one:

1. Stablecoin cash-leg pilot
- source categories: bank balance, treasury reserve, KYC/account status
- output: mint eligibility and issuer approval flow

2. Tokenized stock risk-leg pilot
- source categories: identity, accredited investor state, holdings/custody
- output: issue, allocate, restrict, or redeem flow

## Choose Integration Mode

### Adapter mode

Use adapter mode when:

- the customer has a stable machine API
- request and response formats are deterministic
- the source is already a system integration problem

Typical fit:

- balances
- KYC providers
- custody/holdings systems
- transfer-agent or treasury APIs

### zkTLS mode

Use zkTLS mode when:

- the customer has HTTPS-delivered data but no clean partner API
- source authenticity matters more than integration convenience
- the first integration should prove that web-delivered source data can still feed TAP

Typical fit:

- secure web portals
- internal HTTPS services without externalized API contracts
- reserve or statement-style views

## Mapping Worksheet

For each source, define:

- `sourceCategory`
- `integrationMode`
- `providerLabel`
- `tenantId`
- `policyId`
- `subjectBinding`
- `requiredFields`
- `settlementOperation`
- `approvalRequired`
- `webhookRequired`

## Expected Implementation Output

For a first customer integration, we should usually deliver:

1. provider bootstrap script
2. one source mapping in adapter or zkTLS mode
3. one demo runner
4. one transcript generator
5. one redacted transcript
6. one short hardening memo

Current starting points in this repo:

- [bootstrap_customer_balance_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/bootstrap_customer_balance_template.sh)
- [bootstrap_customer_kyc_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/bootstrap_customer_kyc_template.sh)
- [bootstrap_customer_holdings_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/bootstrap_customer_holdings_template.sh)
- [run_customer_balance_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_balance_template.sh)
- [run_customer_kyc_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_kyc_template.sh)
- [run_customer_holdings_template.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_holdings_template.sh)
- [generate_customer_dual_asset_transcript.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/generate_customer_dual_asset_transcript.sh)
- [run_customer_dual_asset_demo_pack.sh](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_customer_dual_asset_demo_pack.sh)

## Exit Criteria

The mapping exercise is done when:

- one customer-owned source runs end to end
- transcript verification passes
- the customer can review a redacted artifact
- the pilot hardening gaps are documented
