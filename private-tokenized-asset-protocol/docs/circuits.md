# Circuit Schemas (Starter)

## eligibility_v1

Public input:
- `subjectCommitment`
- `policyId`
- `evaluationDate`
- `result`

Private input:
- KYC/sanctions/jurisdiction flags
- phone + statement ownership scores
- attestor signature material

## transfer_compliance_v1

Public input:
- sender/receiver commitments
- asset and amount commitment
- policy ID
- result

Private input:
- clear amount
- sender limit and usage
- sender/receiver eligibility
- sanctions clear flag

## reserve_coverage_v1

Public input:
- issuer commitment
- supply commitment
- reserve digest
- ratio bps
- result

Private input:
- clear supply and reserve values
- reserve attestation signature
