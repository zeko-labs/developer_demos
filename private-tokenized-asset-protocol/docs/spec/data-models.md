# Data Models

## Tenant Provider Config

Defines runtime behavior for partner data sources:
- `tenantId`, `provider`
- `allowedHosts`
- `quotaPerHour`
- `authProfiles` (`api-key`, `bearer`, `oauth2-client-credentials`)
- `mtlsProfiles` (`certEnv`, `keyEnv`, optional `caEnv`)

Credential lifecycle metadata:
- `keyVersion`, `owner`
- `lastRotatedAt`, `rotateBy`, `expiresAt`

## Policy Version

Deterministic policy records:
- `tenantId`, `policyId`, `version`
- `jurisdiction`
- `rules` (risk/compliance parameters)
- `effectiveAt`, `status`
- `policyHash`

## Proof Envelope

- `id`, `circuitId`, `mode`
- `publicInput`
- `proof`, `proofHash`
- `verifiedLocal`, `createdAt`

Required policy linkage in public input/metadata:
- `tenantId`
- `policyId`
- `policyVersion`
- `policyHash`

## Settlement Record

- `settlementId`, `status`, `anchored`
- `proofHash`, `txHash`, `eventId`
- `metadata` includes policy and workflow linkage:
  - `policySnapshotHash`
  - `policyEffectiveAt`
  - maker-checker identifiers for issuance paths

## Issuer Workflow Record

- `requestId`, `kind` (`mint`/`burn`/`issue`/`allocate`/`restrict`/`redeem`)
- `status` (`requested`, `approved`, `rejected`, `settled`)
- maker identity + checker approval payload
- payload fields vary by lifecycle step:
  - stablecoin: `recipientCommitment`, `holderCommitment`, `amountCents`
  - tokenized stock: `investorCommitment`, `holderCommitment`, `quantityUnits`, `notionalCents`, `securityId`, `issuanceType`, `restrictionCode`, `redemptionType`
