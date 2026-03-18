# Implementation Checklist: Permissioned Stablecoin Balance Pilot

## Bank Team

- confirm pilot product and target user cohort
- provide sandbox base URL for balance and KYC services
- provide auth method and credentials through secret manager delivery
- provide sample account IDs and customer IDs
- provide sample success and error payloads
- confirm minimum balance and KYC rules with compliance
- name maker and checker operators
- approve outbound allowlist entries

## TAP Team

- bootstrap tenant and provider configs
- map balance and KYC responses to canonical fields
- register policy version 1 with deterministic policy hash
- enable maker-checker roles and API keys
- verify settlement-time policy guard behavior
- generate source collect transcripts
- generate mint approval transcript
- generate transfer compliance transcript
- package public redacted demo artifacts

## Joint Validation

- validate that the sample account returns deterministic balance data
- validate that KYC status is fresh and non-null
- validate stale policy rejection
- validate mint attempt fails before checker approval
- validate approved mint settles successfully
- validate transfer proof succeeds only for approved subject

## Exit Criteria

- one bank-approved transcript pack
- one release bundle with verified hashes
- one operator runbook for re-running the pilot
- one gap list for production expansion
