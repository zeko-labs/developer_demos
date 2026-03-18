import { z } from 'zod';

export const RoleSchema = z.enum([
  'CONSORTIUM_ADMIN',
  'ISSUER',
  'ISSUER_MAKER',
  'ISSUER_CHECKER',
  'AUDITOR',
  'RELAYER',
  'USER'
]);

export const ProofModeSchema = z.enum(['mock', 'crypto', 'zk']);

export const HealthResponseSchema = z.object({
  service: z.string(),
  status: z.literal('ok'),
  timestamp: z.string()
});

export const PublicConfigSchema = z.object({
  networkId: z.string(),
  zekoGraphqlUrl: z.string().url(),
  bridgeEnabled: z.boolean(),
  environment: z.string(),
  proofMode: ProofModeSchema
});

export const UploadStatementRequestSchema = z.object({
  subjectId: z.string().min(1),
  statementHash: z.string().min(1),
  sourceType: z.enum(['bank_statement', 'venmo_balance', 'other'])
});

export const VerifyPhoneRequestSchema = z.object({
  subjectId: z.string().min(1),
  phoneNumber: z.string().min(8)
});

const CredentialLifecycleSchema = z.object({
  keyVersion: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  lastRotatedAt: z.string().datetime().optional(),
  rotateBy: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional()
});

export const SourceProviderSchema = z.enum([
  'mock-bank',
  'generic-rest',
  'increase',
  'plaid',
  'persona',
  'custody-holdings',
  'zktls-employer',
  'zktls-bank'
]);

export const GenericRestSourceSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  authProfile: z.string().min(1).optional(),
  mtlsProfile: z.string().min(1).optional(),
  mappingVersion: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(30000).optional(),
  retryCount: z.number().int().min(0).max(3).optional(),
  extract: z
    .object({
      subjectPath: z.string().optional(),
      eligibilityPath: z.string().optional(),
      scorePath: z.string().optional(),
      fields: z.record(z.string(), z.string()).optional()
    })
    .optional()
});

export const MockBankSourceSchema = z.object({
  balanceCents: z.number().int().nonnegative().optional(),
  kycPassed: z.boolean().optional(),
  accountStatus: z.enum(['active', 'restricted', 'closed']).optional()
});

export const PlaidSourceSchema = z.object({
  accessToken: z.string().min(1),
  clientIdEnv: z.string().min(1).optional(),
  secretEnv: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  minBalanceCents: z.number().int().nonnegative().optional(),
  requirePositiveBalance: z.boolean().optional()
});

export const IncreaseSourceSchema = z.object({
  accountId: z.string().min(1),
  apiKeyEnv: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  minBalanceCents: z.number().int().nonnegative().optional(),
  requirePositiveAvailable: z.boolean().optional(),
  requireOpenAccount: z.boolean().optional()
});

export const PersonaSourceSchema = z.object({
  inquiryId: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  requirePassed: z.boolean().optional(),
  acceptedStatuses: z.array(z.string().min(1)).optional()
});

export const CustodyHoldingsSourceSchema = z.object({
  accountId: z.string().min(1),
  assetSymbol: z.string().min(1).optional(),
  certificateId: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  minUnits: z.number().nonnegative().optional(),
  requireCertificateValid: z.boolean().optional()
});

export const ZkTlsEmployerSourceSchema = z.object({
  runPipelineFirst: z.boolean().optional(),
  runId: z.string().min(1).optional(),
  mode: z.enum(['eligible', 'ineligible']).optional(),
  minSalary: z.number().int().nonnegative().optional(),
  minTenureMonths: z.number().int().nonnegative().optional(),
  requireActive: z.boolean().optional(),
  expectedServerName: z.string().min(1).optional()
});

export const ZkTlsBankSourceSchema = z.object({
  runPipelineFirst: z.boolean().optional(),
  runId: z.string().min(1).optional(),
  mode: z.enum(['eligible', 'ineligible']).optional(),
  minBalanceCents: z.number().int().nonnegative().optional(),
  requirePositiveAvailable: z.boolean().optional(),
  requireKycPassed: z.boolean().optional(),
  expectedServerName: z.string().min(1).optional()
});

export const SourceAdapterRequestSchema = z.object({
  provider: SourceProviderSchema,
  tenantId: z.string().min(1).optional(),
  subjectCommitment: z.string().min(1),
  policyId: z.number().int().nonnegative().default(1),
  settle: z.boolean().default(true),
  idempotencyKey: z.string().min(8).max(128).optional(),
  failover: z
    .object({
      strategy: z.enum(['ordered', 'health-weighted']).optional(),
      providers: z.array(SourceProviderSchema).min(1),
      sources: z.record(z.string(), z.unknown()).optional()
    })
    .optional(),
  source: z
    .union([
      GenericRestSourceSchema,
      MockBankSourceSchema,
      IncreaseSourceSchema,
      PlaidSourceSchema,
      PersonaSourceSchema,
      CustodyHoldingsSourceSchema,
      ZkTlsEmployerSourceSchema,
      ZkTlsBankSourceSchema
    ])
    .optional()
});

const ApiKeyAuthProfileSchema = z.object({
  type: z.literal('api-key'),
  secretEnv: z.string().min(1),
  header: z.string().min(1).optional(),
  prefix: z.string().optional(),
  lifecycle: CredentialLifecycleSchema.optional()
});

const BearerAuthProfileSchema = z.object({
  type: z.literal('bearer'),
  secretEnv: z.string().min(1),
  header: z.string().min(1).optional(),
  prefix: z.string().optional(),
  lifecycle: CredentialLifecycleSchema.optional()
});

export const MtlsProfileSchema = z.object({
  certEnv: z.string().min(1),
  keyEnv: z.string().min(1),
  caEnv: z.string().min(1).optional(),
  passphraseEnv: z.string().min(1).optional(),
  serverName: z.string().min(1).optional(),
  rejectUnauthorized: z.boolean().optional(),
  lifecycle: CredentialLifecycleSchema.optional()
});

const OAuth2ClientCredentialsAuthProfileSchema = z.object({
  type: z.literal('oauth2-client-credentials'),
  tokenUrl: z.string().url(),
  clientIdEnv: z.string().min(1),
  clientSecretEnv: z.string().min(1),
  mtlsProfile: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  audience: z.string().min(1).optional(),
  header: z.string().min(1).optional(),
  prefix: z.string().optional(),
  lifecycle: CredentialLifecycleSchema.optional()
});

export const AuthProfileSchema = z.discriminatedUnion('type', [
  ApiKeyAuthProfileSchema,
  BearerAuthProfileSchema,
  OAuth2ClientCredentialsAuthProfileSchema
]);

export const TenantProviderConfigSchema = z.object({
  tenantId: z.string().min(1),
  provider: SourceProviderSchema,
  enabled: z.boolean().default(true),
  allowedHosts: z.array(z.string()).default([]),
  quotaPerHour: z.number().int().positive().default(1000),
  mappingVersion: z.string().min(1).default('v1'),
  authProfiles: z.record(z.string(), AuthProfileSchema).default({}),
  mtlsProfiles: z.record(z.string(), MtlsProfileSchema).default({}),
  failoverProviders: z.array(SourceProviderSchema).default([]),
  routingStrategy: z.enum(['ordered', 'health-weighted']).default('ordered'),
  routingWeight: z.number().int().min(-100).max(100).default(0),
  updatedAt: z.string().optional()
});

export const PolicyStatusSchema = z.enum(['active', 'draft', 'retired']);

export const IssuerRequestKindSchema = z.enum(['mint', 'burn', 'issue', 'allocate', 'restrict', 'redeem']);

export const RiskOperationSchema = z.enum(['eligibility', 'mint', 'burn', 'issue', 'allocate', 'restrict', 'redeem']);

export const UpsertRiskConfigRequestSchema = z.object({
  tenantId: z.string().min(1),
  operation: RiskOperationSchema,
  enabled: z.boolean().default(true),
  minScore: z.number().min(0).max(100).optional(),
  maxPerTxnAmountCents: z.string().min(1).optional(),
  maxDailyAmountCents: z.string().min(1).optional(),
  maxSubjectDailyAmountCents: z.string().min(1).optional(),
  maxRequestsPerHour: z.number().int().positive().optional()
});

export const PolicyVersionSchema = z.object({
  tenantId: z.string().min(1),
  policyId: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  jurisdiction: z.string().min(1),
  rules: z.record(z.string(), z.unknown()),
  effectiveAt: z.string().datetime(),
  status: PolicyStatusSchema,
  policyHash: z.string(),
  createdAt: z.string()
});

export const UpsertPolicyRequestSchema = z.object({
  tenantId: z.string().min(1),
  policyId: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  jurisdiction: z.string().min(1),
  rules: z.record(z.string(), z.unknown()),
  effectiveAt: z.string().datetime(),
  status: PolicyStatusSchema.default('draft')
});

export const EligibilityProofRequestSchema = z.object({
  subjectCommitment: z.string().min(1),
  policyId: z.number().int().nonnegative(),
  tenantId: z.string().min(1).optional(),
  policyVersion: z.number().int().positive().optional(),
  policyHash: z.string().optional(),
  jurisdiction: z.string().optional(),
  attestationId: z.string().optional()
});

export const TransferComplianceProofRequestSchema = z.object({
  senderCommitment: z.string().min(1),
  receiverCommitment: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  amountCommitment: z.string().min(1),
  policyId: z.number().int().nonnegative()
});

export const MintRequestSchema = z.object({
  issuerId: z.string().min(1),
  recipientCommitment: z.string().min(1),
  amountCents: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  tenantId: z.string().min(1).optional(),
  policyId: z.number().int().nonnegative().default(1)
});

export const BurnRequestSchema = z.object({
  issuerId: z.string().min(1),
  holderCommitment: z.string().min(1),
  amountCents: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  tenantId: z.string().min(1).optional(),
  policyId: z.number().int().nonnegative().default(1)
});

export const StockIssueRequestSchema = z.object({
  issuerId: z.string().min(1),
  investorCommitment: z.string().min(1),
  quantityUnits: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  securityId: z.string().min(1).optional(),
  issuanceType: z.enum(['primary', 'subscription']).default('primary'),
  notionalCents: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  policyId: z.number().int().nonnegative().default(1)
});

export const StockAllocationRequestSchema = z.object({
  issuerId: z.string().min(1),
  investorCommitment: z.string().min(1),
  quantityUnits: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  securityId: z.string().min(1).optional(),
  allocationId: z.string().min(1).optional(),
  notionalCents: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  policyId: z.number().int().nonnegative().default(1)
});

export const StockRestrictionRequestSchema = z.object({
  issuerId: z.string().min(1),
  holderCommitment: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  securityId: z.string().min(1).optional(),
  restrictionCode: z.string().min(1),
  note: z.string().max(500).optional(),
  tenantId: z.string().min(1).optional(),
  policyId: z.number().int().nonnegative().default(1)
});

export const StockRedeemRequestSchema = z.object({
  issuerId: z.string().min(1),
  holderCommitment: z.string().min(1),
  quantityUnits: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  securityId: z.string().min(1).optional(),
  redemptionType: z.enum(['redeem', 'cancel', 'corporate-action']).default('redeem'),
  notionalCents: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  policyId: z.number().int().nonnegative().default(1)
});

export const IssuerRequestStatusSchema = z.enum(['requested', 'approved', 'rejected', 'settled']);

export const IssuerApprovalActionSchema = z.object({
  reasonCode: z.string().min(1).max(64).optional(),
  note: z.string().max(500).optional()
});

export const UpsertIssuerControlConfigRequestSchema = z.object({
  tenantId: z.string().min(1),
  approvalExpiryMinutes: z.number().int().positive().max(60 * 24 * 30).default(24 * 60),
  dualApprovalThresholdCents: z.string().min(1).default('0'),
  requireReasonCode: z.boolean().default(false),
  allowedReasonCodes: z.array(z.string().min(1).max(64)).default([])
});

export const TransferRequestSchema = z.object({
  senderCommitment: z.string().min(1),
  receiverCommitment: z.string().min(1),
  amountCommitment: z.string().min(1),
  assetId: z.number().int().nonnegative(),
  policyId: z.number().int().nonnegative()
});

export const BridgeExitRequestSchema = z.object({
  subjectCommitment: z.string().min(1),
  amountCommitment: z.string().min(1),
  targetL1Address: z.string().min(1),
  assetId: z.number().int().nonnegative()
});

export const BridgeEntryRequestSchema = z.object({
  subjectCommitment: z.string().min(1),
  l1TxHash: z.string().min(1),
  amountCommitment: z.string().min(1),
  assetId: z.number().int().nonnegative()
});

export const ProofEnvelopeSchema = z.object({
  id: z.string(),
  circuitId: z.string(),
  mode: ProofModeSchema,
  publicInput: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  proof: z.record(z.string(), z.unknown()),
  proofHash: z.string(),
  verifiedLocal: z.boolean(),
  createdAt: z.string()
});

export const RecordSettlementRequestSchema = z.object({
  proof: ProofEnvelopeSchema,
  operation: z.enum(['eligibility', 'mint', 'burn', 'issue', 'allocate', 'restrict', 'redeem', 'transfer', 'bridge-entry', 'bridge-exit']),
  subjectCommitment: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const RecordSettlementResponseSchema = z.object({
  settlementId: z.string(),
  status: z.enum(['pending_submit', 'submitted', 'confirmed', 'recorded', 'rejected', 'failed']),
  anchored: z.boolean(),
  txHash: z.string(),
  proofHash: z.string(),
  eventId: z.string(),
  createdAt: z.string(),
  finalizedAt: z.string().optional(),
  confirmationSource: z.string().optional()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type PublicConfig = z.infer<typeof PublicConfigSchema>;
export type UploadStatementRequest = z.infer<typeof UploadStatementRequestSchema>;
export type VerifyPhoneRequest = z.infer<typeof VerifyPhoneRequestSchema>;
export type SourceProvider = z.infer<typeof SourceProviderSchema>;
export type GenericRestSource = z.infer<typeof GenericRestSourceSchema>;
export type MockBankSource = z.infer<typeof MockBankSourceSchema>;
export type IncreaseSource = z.infer<typeof IncreaseSourceSchema>;
export type PlaidSource = z.infer<typeof PlaidSourceSchema>;
export type PersonaSource = z.infer<typeof PersonaSourceSchema>;
export type CustodyHoldingsSource = z.infer<typeof CustodyHoldingsSourceSchema>;
export type ZkTlsEmployerSource = z.infer<typeof ZkTlsEmployerSourceSchema>;
export type ZkTlsBankSource = z.infer<typeof ZkTlsBankSourceSchema>;
export type SourceAdapterRequest = z.infer<typeof SourceAdapterRequestSchema>;
export type AuthProfile = z.infer<typeof AuthProfileSchema>;
export type MtlsProfile = z.infer<typeof MtlsProfileSchema>;
export type TenantProviderConfig = z.infer<typeof TenantProviderConfigSchema>;
export type PolicyVersion = z.infer<typeof PolicyVersionSchema>;
export type IssuerRequestKind = z.infer<typeof IssuerRequestKindSchema>;
export type RiskOperation = z.infer<typeof RiskOperationSchema>;
export type UpsertRiskConfigRequest = z.infer<typeof UpsertRiskConfigRequestSchema>;
export type UpsertPolicyRequest = z.infer<typeof UpsertPolicyRequestSchema>;
export type EligibilityProofRequest = z.infer<typeof EligibilityProofRequestSchema>;
export type TransferComplianceProofRequest = z.infer<typeof TransferComplianceProofRequestSchema>;
export type MintRequest = z.infer<typeof MintRequestSchema>;
export type BurnRequest = z.infer<typeof BurnRequestSchema>;
export type StockIssueRequest = z.infer<typeof StockIssueRequestSchema>;
export type StockAllocationRequest = z.infer<typeof StockAllocationRequestSchema>;
export type StockRestrictionRequest = z.infer<typeof StockRestrictionRequestSchema>;
export type StockRedeemRequest = z.infer<typeof StockRedeemRequestSchema>;
export type IssuerRequestStatus = z.infer<typeof IssuerRequestStatusSchema>;
export type IssuerApprovalAction = z.infer<typeof IssuerApprovalActionSchema>;
export type UpsertIssuerControlConfigRequest = z.infer<typeof UpsertIssuerControlConfigRequestSchema>;
export type TransferRequest = z.infer<typeof TransferRequestSchema>;
export type BridgeExitRequest = z.infer<typeof BridgeExitRequestSchema>;
export type BridgeEntryRequest = z.infer<typeof BridgeEntryRequestSchema>;
export type ProofEnvelope = z.infer<typeof ProofEnvelopeSchema>;
export type RecordSettlementRequest = z.infer<typeof RecordSettlementRequestSchema>;
export type RecordSettlementResponse = z.infer<typeof RecordSettlementResponseSchema>;
export type ProofMode = z.infer<typeof ProofModeSchema>;
