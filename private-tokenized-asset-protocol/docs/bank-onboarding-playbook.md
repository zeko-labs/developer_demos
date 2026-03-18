# Bank Onboarding Playbook

## Phase 1: Technical Qualification

- identify the pilot product:
  - stablecoin issuance
  - tokenized deposits
  - tokenized money market or ETF exposure
  - tokenized equity or certificate-backed asset
- identify the first control surface to prove:
  - customer identity and KYC pass state
  - bank balance or reserve sufficiency
  - custody holdings or certificate ownership
  - transfer eligibility or jurisdiction gating
- select integration mode for each source:
  - adapter mode for clean sandbox or partner APIs
  - zkTLS mode for HTTPS sources where direct API integration is not yet available
- define jurisdictional policy requirements:
  - mint eligibility rules
  - transfer restrictions
  - asset-specific concentration or suitability thresholds
  - audit retention and approval requirements

## Phase 1 Exit Criteria

- business owner confirms the pilot asset and target user cohort
- engineering owner confirms the first source to integrate
- compliance owner confirms the first policy domain and approval workflow
- the team chooses one narrow pilot objective:
  - prove customer balance eligibility for mint access
  - prove KYC or accredited investor status for asset access
  - prove reserve or custody sufficiency for issuer-side mint controls

## Phase 2: Sandbox Integration

- collect the sandbox onboarding packet from the bank or partner team
- create tenant config and provider allowlists
- register auth profiles:
  - API key
  - OAuth2 client credentials
  - mTLS if required
- implement source mappings to TAP canonical fields
- decide whether the first source runs through:
  - `/api/v1/attest/source/collect` for adapter mode
  - `/api/v1/attest/zktls/ingest` for zkTLS mode
- run provider contract tests and one live collect transcript

## Phase 2 Exit Criteria

- one sandbox source is reachable from TAP
- one sample resource ID returns deterministic data
- source mapping is versioned and committed
- transcript shows a successful collect with redacted public artifact output

## Phase 3: Policy + Governance Setup

- define policy IDs and versions per product and jurisdiction
- encode the first decision rule:
  - minimum balance
  - KYC required
  - accredited investor required
  - custody holding threshold
- enable maker-checker roles and keys
- assign issuer roles:
  - admin
  - issuer maker
  - issuer checker
  - tenant operator
- validate settlement-time policy guard rejection and acceptance behavior
- verify that proof public input and settlement metadata both bind to:
  - policyId
  - policyVersion
  - policyHash
  - policyEffectiveAt

## Phase 3 Exit Criteria

- stale policy proofs are rejected
- valid proofs settle only against the active approved policy snapshot
- maker cannot finalize issuance without checker approval
- audit metadata identifies who approved, which policy applied, and when

## Phase 4: Operational Readiness

- configure diagnostics and alerting
- enable preflight checks for env, auth, policy state, and source connectivity
- set credential lifecycle controls:
  - secret references only
  - rotation owner
  - expiry review cadence
- define transcript retention and bundle verification procedure
- drill incident runbooks:
  - source outage
  - stale credentials
  - policy rollout mismatch
  - settlement reconciliation drift

## Phase 4 Exit Criteria

- operator can run the full demo from a clean environment with one command
- secrets are not embedded in config payloads or committed files
- health, readiness, and reconciliation checks are documented
- support team has a first-response path for provider failure and policy mismatch

## Phase 5: Go-Live Evidence

- generate the enterprise transcript pack
- verify transcript hashes and release bundle manifest
- archive approvals, settlements, proof artifacts, and policy snapshots
- capture the pilot handoff record:
  - active integrations
  - enabled policies
  - key operators
  - known limitations

## Recommended First Pilot

- use one customer-side source:
  - bank balance
  - KYC pass state
- use one issuer-side control:
  - maker-checker mint approval
- use one transfer-side control:
  - transfer compliance proof
- avoid broad multi-product scope until the first pilot transcript is stable

## Bank Team Deliverables

- one sandbox base URL
- one auth method and credential delivery path
- one or more sample resource IDs
- one sample JSON response for each first-class source
- one security contact for allowlisting and mTLS questions
- one compliance owner for policy interpretation
- one engineering owner for schema changes and webhook signing

## TAP Team Deliverables

- tenant bootstrap and provider config
- adapter or zkTLS source wiring
- canonical mapping and policy linkage
- transcript pack and release bundle
- runbook for operators and bank engineers
