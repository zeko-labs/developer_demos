# Implementation Checklist: Identity-Gated Tokenized Equity Pilot

## Bank or Consortium Team

- confirm target asset and investor cohort
- provide sandbox credentials for identity and custody services
- provide HTTPS test endpoint for suitability or accreditation source
- provide sample customer IDs, account IDs, and security IDs
- provide sample success and error payloads
- confirm accredited investor, suitability, and transfer rules with compliance
- name maker and checker operators if issuance approval is in scope
- approve outbound allowlist entries

## TAP Team

- bootstrap tenant and provider configs
- map identity, holdings, and suitability fields to canonical structures
- configure zkTLS ingest for the suitability source
- register policy version 1 with deterministic policy hash
- enable transfer compliance enforcement
- generate source collect transcripts for identity and holdings
- generate zkTLS transcript for suitability
- generate transfer compliance transcript
- package public redacted demo artifacts

## Joint Validation

- validate identity and KYC source returns deterministic customer state
- validate suitability source produces a stable zkTLS proof path
- validate holdings source returns settled position state
- validate stale policy rejection
- validate disallowed investor transfer fails
- validate allowed investor transfer succeeds

## Exit Criteria

- one consortium-approved transcript pack
- one release bundle with verified hashes
- one operator runbook for re-running the pilot
- one production gap list covering transfer-agent and custody expansion
