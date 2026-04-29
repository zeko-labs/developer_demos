import 'dotenv/config';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from 'node:fs';
import express, { type Request } from 'express';
import { Encoding, Field, MerkleTree, Poseidon, PrivateKey, Signature } from 'o1js';
import {
  buildUnsignedAgentRegistrationTx,
  buildUnsignedCreditsTx,
  buildUnsignedOutputReceiptTx,
  buildUnsignedRequestReceiptTx,
  describeZekoPayloadError,
  fetchZkappAccountState,
  fetchZekoTransactionStatus,
  getZekoPreflight,
  getZekoRuntimeConfig,
  submitAgentRegistrationTxWithSponsor,
  submitCreditsTxWithSponsor,
  submitOutputReceiptTxWithSponsor,
  submitRequestReceiptTxWithSponsor,
  waitForZkappStateValue
} from './zeko-runtime.js';
import {
  buildUnsignedAgentRegistrationTxV2,
  buildUnsignedCreditsTxV2,
  buildUnsignedOutputReceiptTxV2,
  buildUnsignedRequestReceiptTxV2,
  describeZekoPayloadErrorV2,
  fetchZkappAccountStateV2,
  fetchZekoTransactionStatusV2,
  getZekoPreflightV2,
  getZekoRuntimeConfigV2,
  submitAgentRegistrationTxWithSponsorV2,
  submitCreditsTxWithSponsorV2,
  submitOutputReceiptTxWithSponsorV2,
  submitRequestReceiptTxWithSponsorV2,
  waitForZkappStateValueV2
} from './zeko-runtime-v2.js';
import {
  listSponsorLaneStatuses,
  resolveSponsorPublicKeyForLane,
  type SponsorLane,
  type SponsorLaneStatus
} from './sponsor-lanes.js';
import {
  buildMembershipLaneMap,
  compareMembershipLanePolicy,
  normalizeOperatorMembershipFile,
  normalizeOperatorMembershipRole,
  normalizeOperatorMembershipRecordBody,
  operatorMembershipRoleWeight,
  verifyOperatorMembershipFile,
  type OperatorMembershipFile,
  type OperatorMembershipLanePolicy,
  type OperatorMembershipRecordBody,
  type OperatorMembershipRole,
  type VerifiedOperatorMembershipRecord
} from './operator-membership.js';
import {
  decryptJsonEnvelope,
  encryptJsonEnvelope,
  fingerprintPublicKeyPem,
  generateX25519Keypair,
  getEnvelopeContext,
  type X25519EncryptedEnvelope,
  type X25519Keypair
} from './crypto-envelope.js';

type SettlementMode =
  | 'SETTLE_INDIVIDUAL'
  | 'SETTLE_BATCH'
  | 'SETTLE_INDIVIDUAL_WITH_METADATA';

type VerificationMethod =
  | 'TEE_PLACEHOLDER'
  | 'ORACLE_SIGNATURE'
  | 'THRESHOLD_ATTESTATION';

type TransportMode = 'HTTP_X402' | 'MCP' | 'SDK';
type InferenceLifecycleStatus = 'created' | 'submitting' | 'submitted' | 'settled' | 'failed';
type InferenceCallbackMode = 'terminal' | 'status-change';

type SignatureJson = ReturnType<Signature['toJSON']>;

interface ModelRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  endpoint: string | null;
  authToken: string | null;
  settlementModeDefault: SettlementMode;
  verificationMethod: VerificationMethod;
  transportMode: TransportMode;
  tags: string[];
  createdAt: string;
}

interface ZekoSettlementPayload {
  requestHash: string;
  oraclePublicKey: string;
  signature: SignatureJson;
  merkleRoot: string;
  merkleIndex: number;
}

interface ZekoSettlementArtifacts {
  network: {
    networkId: string;
    graphql: string;
    archive: string;
    explorer: string;
  };
  requestPayload: ZekoSettlementPayload & { agentIdHash: string };
  outputPayload: ZekoSettlementPayload & { outputHash: string };
}

interface ZekoThresholdSettlementPayload {
  requestHash: string;
  merkleRoot: string;
  merkleIndex: number;
  attester1PublicKey: string;
  attester1Signature: SignatureJson;
  attester2PublicKey: string;
  attester2Signature: SignatureJson;
}

interface ZekoSettlementArtifactsV2 {
  network: {
    networkId: string;
    graphql: string;
    archive: string;
    explorer: string;
  };
  contractVersion: 'v2';
  requestPayload: ZekoThresholdSettlementPayload & { agentIdHash: string };
  outputPayload: ZekoThresholdSettlementPayload & { outputHash: string };
}

interface ZekoThresholdAgentRegistrationPayload {
  agentIdHash: string;
  ownerHash: string;
  treasuryHash: string;
  stakeAmount: string;
  merkleRoot: string;
  merkleIndex: number;
  attester1PublicKey: string;
  attester1Signature: SignatureJson;
  attester2PublicKey: string;
  attester2Signature: SignatureJson;
}

interface ZekoAgentSettlementArtifactsV2 {
  network: {
    networkId: string;
    graphql: string;
    archive: string;
    explorer: string;
  };
  contractVersion: 'v2';
  registrationPayload: ZekoThresholdAgentRegistrationPayload;
}

interface ZekoThresholdCreditsPayload {
  creditsRoot: string;
  nullifierRoot: string;
  attester1PublicKey: string;
  attester1Signature: SignatureJson;
  attester2PublicKey: string;
  attester2Signature: SignatureJson;
  depositMina?: number;
  spendTo?: string | null;
  spendAmountMina?: number;
  platformAmountMina?: number;
  platformPayee?: string | null;
}

interface ZekoCreditsPayload {
  creditsRoot: string;
  nullifierRoot: string;
  oraclePublicKey: string;
  signature: SignatureJson;
  depositMina?: number;
  spendTo?: string | null;
  spendAmountMina?: number;
  platformAmountMina?: number;
  platformPayee?: string | null;
}

interface LiveReceiptStageRecord {
  kind: 'request-receipt' | 'output-receipt';
  stateIndex: number;
  targetRoot: string;
  txHash: string | null;
  submittedAt: string | null;
  settled: boolean;
  settledAt: string | null;
  observedRoot: string | null;
  explorerUrl: string | null;
  note: string | null;
}

interface LiveSettlementRecord {
  mode: 'SPONSORED_ZEKO_TESTNET';
  sponsorEnabled: boolean;
  waitForSettlement: boolean;
  request: LiveReceiptStageRecord | null;
  output: LiveReceiptStageRecord | null;
  settled: boolean;
  settledAt: string | null;
  latestCheckAt: string | null;
  lastError: string | null;
}

interface LiveSettlementRecordV2 {
  mode: 'SPONSORED_ZEKO_TESTNET_V2';
  sponsorEnabled: boolean;
  waitForSettlement: boolean;
  request: LiveReceiptStageRecord | null;
  output: LiveReceiptStageRecord | null;
  settled: boolean;
  settledAt: string | null;
  latestCheckAt: string | null;
  lastError: string | null;
  contractVersion: 'v2';
}

interface CoordinationLiveStageRecord {
  kind: 'agent-registration' | 'credits-update';
  stateIndex: number;
  targetRoot: string;
  txHash: string | null;
  submittedAt: string | null;
  settled: boolean;
  settledAt: string | null;
  observedRoot: string | null;
  explorerUrl: string | null;
  note: string | null;
  lastError: string | null;
}

interface AgentRegistrationRecord {
  id: string;
  name: string;
  description: string;
  ownerPublicKey: string;
  treasuryPublicKey: string;
  stakeAmountMina: number;
  capabilities: string[];
  metadata: Record<string, unknown>;
  attribution: RequestAttributionRecord | null;
  createdAt: string;
  agentIdHash: string;
  ownerHash: string;
  treasuryHash: string;
  stakeAmount: string;
  merkleLeaf: string;
  merkleRoot: string;
  merkleIndex: number;
  zeko: {
    network: {
      networkId: string;
      graphql: string;
      archive: string;
      explorer: string;
    };
    registrationPayload: {
      agentIdHash: string;
      ownerHash: string;
      treasuryHash: string;
      stakeAmount: string;
      oraclePublicKey: string;
      signature: SignatureJson;
      merkleRoot: string;
      merkleIndex: number;
    };
  };
  zekoV2?: ZekoAgentSettlementArtifactsV2 | null;
  liveSettlement: CoordinationLiveStageRecord | null;
  liveSettlementV2?: CoordinationLiveStageRecord | null;
}

interface AgentRegistrationsFile {
  agents: AgentRegistrationRecord[];
}

interface CreditsLedgerPendingDeposit {
  ownerPublicKey: string;
  amountMina: number;
  creditsRoot: string;
  nullifierRoot: string;
  createdAt: string;
}

interface CreditsLedgerEvent {
  kind: 'deposit-confirmed' | 'credits-spent';
  ownerPublicKey: string;
  amountMina: number;
  timestamp: string;
  requestId?: string;
  txHash?: string;
  creditsRoot: string;
  nullifierRoot: string;
}

interface CreditsLedgerFile {
  balances: Record<string, number>;
  pendingDeposits: Record<string, CreditsLedgerPendingDeposit>;
  history: CreditsLedgerEvent[];
}

interface CreditsNullifierRecord {
  requestId: string;
  ownerPublicKey: string;
  amountMina: number;
  createdAt: string;
}

interface CreditsNullifierFile {
  nullifiers: Record<string, CreditsNullifierRecord>;
}

interface CreditsIntentRecord {
  ownerPublicKey: string;
  requestId: string;
  amountMina: number;
  creditsRoot: string;
  nullifierRoot: string;
  createdAt: string;
  spendTo: string | null;
  platformPayee: string | null;
  platformAmountMina: number;
}

interface CreditsIntentsFile {
  intents: Record<string, CreditsIntentRecord>;
}

interface CreditsStateRecord {
  currentCreditsRoot: string;
  currentNullifierRoot: string;
}

type CreditsSettlementStrategy = 'direct' | 'checkpoint';
type CreditsOperatorItemKind = 'credits-update' | 'credits-spend';
type CreditsOperatorItemStatus = 'queued' | 'processing' | 'submitted' | 'settled' | 'failed' | 'superseded';

interface CreditsOperatorQueueItem {
  id: string;
  idempotencyKey: string;
  contractVersion: 'v2';
  kind: CreditsOperatorItemKind;
  settlementStrategy: CreditsSettlementStrategy;
  source: 'deposit-intent' | 'spend-intent' | 'manual';
  ownerPublicKey: string | null;
  requestId: string | null;
  pendingDepositKey: string | null;
  payload: ZekoThresholdCreditsPayload;
  createdAt: string;
  status: CreditsOperatorItemStatus;
  attemptCount: number;
  txHash: string | null;
  submittedAt: string | null;
  settledAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  observedCreditsRoot: string | null;
  observedNullifierRoot: string | null;
  supersededBy: string | null;
  batchId: string | null;
  leaseOwnerId: string | null;
  leaseId: string | null;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  lastOperatorId: string | null;
  attribution: RequestAttributionRecord | null;
}

interface CreditsOperatorQueueFile {
  items: CreditsOperatorQueueItem[];
  lastProcessedAt: string | null;
  lastError: string | null;
}

type CreditsDepositMonitorStatus = 'queued' | 'monitoring' | 'confirmed' | 'failed';

interface CreditsDepositMonitorItem {
  id: string;
  idempotencyKey: string;
  contractVersion: 'v2';
  ownerPublicKey: string;
  creditsRoot: string;
  nullifierRoot: string;
  txHash: string;
  createdAt: string;
  status: CreditsDepositMonitorStatus;
  attemptCount: number;
  settledAt: string | null;
  confirmedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  observedCreditsRoot: string | null;
  observedNullifierRoot: string | null;
  attribution: RequestAttributionRecord | null;
}

interface CreditsDepositMonitorFile {
  items: CreditsDepositMonitorItem[];
  lastProcessedAt: string | null;
  lastError: string | null;
}

interface CreditsCheckpointBatchRecord {
  id: string;
  createdAt: string;
  operatorId: string | null;
  itemIds: string[];
  itemCount: number;
  txHash: string | null;
  finalCreditsRoot: string;
  finalNullifierRoot: string;
  settledAt: string | null;
  observedCreditsRoot: string | null;
  observedNullifierRoot: string | null;
  status: 'submitted' | 'settled' | 'failed';
  lastError: string | null;
}

interface CreditsCheckpointBatchFile {
  batches: CreditsCheckpointBatchRecord[];
  lastProcessedAt: string | null;
  lastError: string | null;
}

interface CreditsOperatorLockMetadata {
  ownerId: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
}

type OperatorRegistryStatus = 'active' | 'paused' | 'draining';
type OperatorRouteFreshnessStatus = 'local' | 'fresh' | 'stale' | 'unknown';
type OperatorRouteFreshnessSource = 'local-process' | 'last-seen' | 'updated-at' | 'missing';
type OperatorRouteSelectionMode = 'local-preferred' | 'fresh-remote' | 'unavailable';
type OperatorRouteStrategy = 'local-preferred' | 'membership-first';

interface OperatorLaneAssignment {
  lane: SponsorLane;
  configured: boolean;
  publicKey: string | null;
  source: SponsorLaneStatus['source'];
  usesSharedFallback: boolean;
}

interface OperatorRegistryRecord {
  id: string;
  label: string;
  endpoint: string | null;
  status: OperatorRegistryStatus;
  local: boolean;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: OperatorLaneAssignment[];
  metadata: Record<string, unknown> | null;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

interface OperatorRegistryFile {
  operators: OperatorRegistryRecord[];
  lastUpdatedAt: string | null;
}

type OperatorLaneRouteVia = 'local' | 'remote' | 'unavailable';

interface OperatorLaneRouteCandidate {
  id: string;
  label: string;
  endpoint: string | null;
  status: OperatorRegistryStatus;
  local: boolean;
  publicKey: string | null;
  updatedAt: string;
  lastSeenAt: string | null;
  freshness: OperatorRouteFreshness;
  eligible: boolean;
  eligibilityReason: string;
}

interface OperatorRouteFreshness {
  status: OperatorRouteFreshnessStatus;
  source: OperatorRouteFreshnessSource;
  observedAt: string | null;
  ageMs: number | null;
  staleAfterMs: number | null;
}

interface OperatorRoutingSelection {
  mode: OperatorRouteSelectionMode;
  reason: string;
}

interface OperatorRoutePolicyAdmission {
  admitted: boolean;
  reason: string;
  lanePolicy: OperatorMembershipLanePolicy | null;
}

interface OperatorLaneRoute {
  lane: SponsorLane;
  via: OperatorLaneRouteVia;
  operatorId: string | null;
  operatorLabel: string | null;
  operatorEndpoint: string | null;
  operatorStatus: OperatorRegistryStatus | null;
  publicKey: string | null;
  localConfigured: boolean;
  freshness: OperatorRouteFreshness;
  selection: OperatorRoutingSelection;
  candidates: OperatorLaneRouteCandidate[];
}

interface RoutedSponsorSubmission {
  hash: string | null;
  proxied: boolean;
  route: OperatorLaneRoute;
}

interface CoordinationTreeState {
  agentLeaves: Record<string, string>;
  creditsLeaves: Record<string, string>;
  nullifierLeaves: Record<string, string>;
  nextAgentIndex: number;
  nextCreditsIndex: number;
  nextNullifierIndex: number;
}

interface FutureEthereumEnvelope {
  targetChain: 'ethereum';
  targetChainId: number;
  settlementMode: SettlementMode;
  status: 'planned';
  dataAvailability: 'eip4844';
  settlementContract: string | null;
  batchId: string | null;
  batchHash: string | null;
  blobVersionedHash: string | null;
  challengePoint: string | null;
  evaluationClaim: string | null;
  notes: string[];
}

interface AttesterKeyRecord {
  id: string;
  privateKey: string;
}

interface AttesterKeyFile {
  version: number;
  quorum: number;
  attesters: AttesterKeyRecord[];
}

interface ThresholdAttestationSignature {
  attesterId: string;
  publicKey: string;
  signature: SignatureJson;
}

interface ThresholdAttestationBundle {
  method: 'THRESHOLD_ATTESTATION';
  quorum: number;
  digest: string;
  attestersAvailable: number;
  signatures: ThresholdAttestationSignature[];
  notes: string[];
}

interface OperatorRoutingPolicySnapshot {
  generatedAt: string;
  routeStrategy: OperatorRouteStrategy;
  coordinatorSyncMs: number;
  routeStaleAfterMs: number;
  requireActiveStatus: boolean;
  preferLocalWhenConfigured: boolean;
  remoteRequiresEndpoint: boolean;
  remoteRequiresFreshHeartbeat: boolean;
  routeSelectionOrder: string[];
  note: string;
}

interface OperatorHealthRecord {
  id: string;
  label: string;
  endpoint: string | null;
  status: OperatorRegistryStatus;
  local: boolean;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: OperatorLaneAssignment[];
  freshness: OperatorRouteFreshness;
  metadata: Record<string, unknown> | null;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

interface OperatorHealthSnapshot {
  generatedAt: string;
  policy: OperatorRoutingPolicySnapshot;
  summary: {
    totalOperators: number;
    activeOperators: number;
    pausedOperators: number;
    drainingOperators: number;
    freshOperators: number;
    staleOperators: number;
    unknownOperators: number;
    localOperators: number;
    totalRoutes: number;
    availableRoutes: number;
    unavailableRoutes: number;
    localRoutes: number;
    remoteRoutes: number;
  };
  operators: OperatorHealthRecord[];
  routing: {
    generatedAt: string;
    policy: OperatorRoutingPolicySnapshot;
    localOperatorId: string;
    routes: Record<SponsorLane, OperatorLaneRoute>;
    note: string;
  };
}

interface OperatorIsolationAuditIssue {
  severity: 'info' | 'warn' | 'error';
  code: string;
  lane: SponsorLane | null;
  operatorId: string | null;
  message: string;
  details: Record<string, unknown> | null;
}

interface OperatorIsolationAuditSnapshot {
  generatedAt: string;
  localOperatorId: string;
  policy: OperatorRoutingPolicySnapshot;
  sponsorLanes: SponsorLaneStatus[];
  summary: {
    issueCount: number;
    infoCount: number;
    warnCount: number;
    errorCount: number;
    sharedFallbackLanes: number;
    duplicatedLaneKeys: number;
    unavailableAdmittedLanes: number;
    routeMismatches: number;
  };
  routes: Record<SponsorLane, OperatorLaneRoute>;
  issues: OperatorIsolationAuditIssue[];
  note: string;
}

interface OperatorMembershipSnapshot {
  generatedAt: string;
  policyPresent: boolean;
  policyPublicKey: string | null;
  summary: {
    totalOperators: number;
    verifiedOperators: number;
    invalidOperators: number;
    admittedRequestOperators: number;
    admittedOutputOperators: number;
    admittedRegistryOperators: number;
    admittedCreditsOperators: number;
  };
  operators: Array<{
    operatorId: string;
    label: string;
    endpoint: string | null;
    networkId: string;
    verified: boolean;
    verificationError: string | null;
    record: OperatorMembershipRecordBody;
  }>;
  note: string;
}

interface ClientEncryptedEnvelope {
  mode: 'aes-256-gcm';
  curve: 'x25519';
  recipientPublicKeyFingerprint: string;
  ephemeralPublicKeyPem: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface RedactedOutput {
  redacted: true;
  reason: string;
}

interface DaRelayPayload {
  mode: 'zeko-relay';
  schema: string;
  appId: string;
  network: string;
  commitment: string;
  payloadCiphertext: ClientEncryptedEnvelope;
  payloadHash: string;
  createdAtUnixMs: number;
}

interface DaPublicationRecord {
  schema: string;
  appId: string;
  prepared: boolean;
  endpoint: string | null;
  relayPayload: DaRelayPayload | null;
  reference: string | null;
  error: string | null;
}

interface PrivacyProfile {
  inputVisibility: 'operator_visible' | 'operator_visible_with_commitment_only' | 'encrypted_for_operator';
  outputVisibility: 'public' | 'encrypted_for_client';
  settlementVisibility: 'hash_only' | 'metadata_visible';
  trustBoundary: string[];
  caveats: string[];
}

interface PrivateInferenceEnvelopePayload {
  prompt: string;
  inputs?: Record<string, unknown>;
}

interface PrivateInputRecord {
  enabled: boolean;
  operatorPublicKeyFingerprint: string | null;
  envelopeHash: string | null;
  promptHash: string;
  inputsHash: string;
  plaintextPersisted: boolean;
  envelope: ClientEncryptedEnvelope | null;
}

interface PrivateLaneConfig {
  mode: 'sealed-input';
  curve: 'x25519';
  context: string;
  publicKeyPem: string;
  fingerprint: string;
}

interface InferenceRequestStatusRecord {
  token: string;
  callbackUrl: string | null;
  callbackMode: InferenceCallbackMode;
  lastStatus: InferenceLifecycleStatus;
  lastStatusAt: string;
  lastNotifiedStatus: InferenceLifecycleStatus | null;
  lastCallbackAt: string | null;
  callbackAttempts: number;
  lastCallbackError: string | null;
}

interface InferenceRecord {
  id: string;
  modelId: string;
  modelName: string;
  prompt: string;
  inputs: Record<string, unknown>;
  privateInput: PrivateInputRecord | null;
  output: unknown | RedactedOutput;
  encryptedOutput: ClientEncryptedEnvelope | null;
  settlementMode: SettlementMode;
  verificationMethod: VerificationMethod;
  transportMode: TransportMode;
  createdAt: string;
  requestHash: string;
  outputHash: string;
  metadataHash: string;
  receiptHash: string;
  requestLeaf: string;
  outputLeaf: string;
  requestRoot: string;
  outputRoot: string;
  metadata: Record<string, unknown>;
  attribution: RequestAttributionRecord | null;
  zeko: ZekoSettlementArtifacts;
  zekoV2?: ZekoSettlementArtifactsV2 | null;
  attestations: ThresholdAttestationBundle | null;
  privacy: PrivacyProfile;
  daPublication: DaPublicationRecord | null;
  futureEthereum: FutureEthereumEnvelope;
  requestStatus: InferenceRequestStatusRecord;
  liveSettlement?: LiveSettlementRecord | null;
  liveSettlementV2?: LiveSettlementRecordV2 | null;
}

interface BatchRecord {
  id: string;
  createdAt: string;
  inferenceIds: string[];
  settlementMode: 'SETTLE_BATCH';
  batchHash: string;
  metadataHash: string;
  receiptHashes: string[];
  futureEthereum: FutureEthereumEnvelope;
}

interface TreeState {
  requestLeaves: Record<string, string>;
  outputLeaves: Record<string, string>;
  nextRequestIndex: number;
  nextOutputIndex: number;
}

interface ModelsFile {
  models: ModelRecord[];
}

interface InferencesFile {
  inferences: InferenceRecord[];
}

interface BatchesFile {
  batches: BatchRecord[];
}

interface ClientKeypair {
  curve: 'x25519';
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
}

interface CreateInferenceParams {
  modelId: string;
  prompt: string;
  inputs: Record<string, unknown>;
  privateInputEnvelope?: ClientEncryptedEnvelope;
  storePlaintextPrompt?: boolean;
  settlementMode?: SettlementMode;
  clientEncryptionPublicKeyPem?: string;
  publishToDa?: boolean;
  statusToken?: string;
  callbackUrl?: string;
  callbackMode?: InferenceCallbackMode;
  attribution?: RequestAttributionRecord | null;
}

interface CreateAgentParams {
  id?: string;
  name: string;
  description?: string;
  ownerPublicKey: string;
  treasuryPublicKey?: string;
  stakeAmountMina?: number;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  attribution?: RequestAttributionRecord | null;
}

type AuthPrincipalRole = 'operator' | 'builder';
type BuilderAuthMode = 'api-key' | 'bearer';
type BuilderScope =
  | 'auth:read'
  | 'operators:read'
  | 'models:read'
  | 'agents:read'
  | 'agents:write'
  | 'inferences:read'
  | 'inferences:write'
  | 'credits:read'
  | 'credits:write';

interface BuilderRateLimitPolicy {
  windowMs: number;
  maxRequests: number;
  maxWriteRequests: number | null;
}

interface BuilderDailyQuotaPolicy {
  inferenceCreates: number | null;
  agentCreates: number | null;
  creditsSpendCount: number | null;
  creditsSpendMina: number | null;
}

interface BuilderAuthRecord {
  id: string;
  label: string;
  status: 'active' | 'paused';
  authMode: BuilderAuthMode;
  secretHash: string;
  scopes: BuilderScope[];
  rateLimit: BuilderRateLimitPolicy | null;
  dailyQuota: BuilderDailyQuotaPolicy | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface BuilderAuthFile {
  version: 1;
  updatedAt: string | null;
  builders: BuilderAuthRecord[];
}

interface BuilderUsageDailyRecord {
  day: string;
  totalRequests: number;
  writeRequests: number;
  inferenceCreates: number;
  agentCreates: number;
  creditsSpendCount: number;
  creditsSpendMina: number;
}

interface BuilderUsageRateLimitWindow {
  startedAt: string | null;
  totalRequests: number;
  writeRequests: number;
}

interface BuilderUsageRecord {
  lastSeenAt: string | null;
  lastRequestAt: string | null;
  lastRequestPath: string | null;
  rateLimitWindow: BuilderUsageRateLimitWindow;
  daily: BuilderUsageDailyRecord;
}

interface BuilderUsageFile {
  version: 1;
  updatedAt: string | null;
  builders: Record<string, BuilderUsageRecord>;
}

interface RequestAttributionRecord {
  principalRole: AuthPrincipalRole;
  principalId: string;
  principalLabel: string;
  authMode: BuilderAuthMode | 'shared-env';
  scopes: string[];
  requestId: string;
  method: string;
  path: string;
  remoteAddress: string | null;
  forwardedFor: string | null;
  userAgent: string | null;
  recordedAt: string;
}

interface RequestAccessContext {
  role: AuthPrincipalRole;
  principalId: string;
  principalLabel: string;
  authMode: BuilderAuthMode | 'shared-env';
  scopes: BuilderScope[] | ['*'];
  builder: BuilderAuthRecord | null;
  usage: BuilderUsageRecord | null;
}

interface BuilderRequestDelta {
  isWrite: boolean;
  inferenceCreates: number;
  agentCreates: number;
  creditsSpendCount: number;
  creditsSpendMina: number;
}

interface ApiRouteAccessPolicy {
  builderAllowed: boolean;
  requiredScopes: BuilderScope[];
  delta: BuilderRequestDelta;
}

interface ZekoReceiptActionBody {
  feePayer?: string;
}

interface LiveReceiptActionBody {
  waitForSettlement?: boolean;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}

interface CreditsIntentActionBody extends LiveReceiptActionBody {
  enqueue?: boolean;
  processNow?: boolean;
  idempotencyKey?: string;
  settlementStrategy?: CreditsSettlementStrategy;
}

interface CreditsOperatorEnqueueBody extends LiveReceiptActionBody {
  payload?: ZekoThresholdCreditsPayload;
  source?: CreditsOperatorQueueItem['source'];
  ownerPublicKey?: string;
  requestId?: string;
  pendingDepositKey?: string;
  idempotencyKey?: string;
  processNow?: boolean;
  maxAttempts?: number;
}

interface CreditsOperatorProcessBody extends LiveReceiptActionBody {
  id?: string;
  limit?: number;
  retryFailed?: boolean;
  maxAttempts?: number;
}

interface CreditsDepositMonitorActionBody extends LiveReceiptActionBody {
  ownerPublicKey?: string;
  creditsRoot?: string;
  txHash?: string;
  id?: string;
  idempotencyKey?: string;
  processNow?: boolean;
  limit?: number;
  retryFailed?: boolean;
  maxAttempts?: number;
}

interface LiveSettlementOptions {
  waitForSettlement: boolean;
  waitTimeoutMs: number;
  pollIntervalMs: number;
}

interface CreditsDepositIntentParams {
  ownerPublicKey: string;
  amountMina: number;
}

interface CreditsSpendIntentParams {
  ownerPublicKey: string;
  requestId: string;
  amountMina: number;
  spendTo?: string | null;
  platformPayee?: string | null;
  settlementStrategy?: CreditsSettlementStrategy;
}

const app = express();
const port = Number(process.env.ZEKO_AI_PORT || process.env.OPENGRADIENT_PORT || 5180);
const host = process.env.HOST || '127.0.0.1';
const shouldListen = (process.env.ZEKO_AI_NO_LISTEN || process.env.OPENGRADIENT_NO_LISTEN) !== 'true';
const shouldRunBackgroundWorkers =
  shouldListen || (process.env.ZEKO_AI_BACKGROUND_WORKERS || process.env.OPENGRADIENT_BACKGROUND_WORKERS) === 'true';
const dataDir = (() => {
  const explicit = process.env.ZEKO_AI_DATA_DIR || process.env.OPENGRADIENT_DATA_DIR;
  if (explicit) return explicit;
  const nextPath = path.join(process.cwd(), 'data', 'zeko-ai');
  const legacyPath = path.join(process.cwd(), 'data', 'opengradient');
  if (existsSync(nextPath)) return nextPath;
  if (existsSync(legacyPath)) return legacyPath;
  return nextPath;
})();
const httpAuthDir = path.join(dataDir, 'http-auth');
const modelsPath = path.join(dataDir, 'models.json');
const inferencesPath = path.join(dataDir, 'inferences.json');
const batchesPath = path.join(dataDir, 'batches.json');
const treeStatePath = path.join(dataDir, 'trees.json');
const coordinationTreesPath = path.join(dataDir, 'coordination-trees.json');
const agentsPath = path.join(dataDir, 'agents.json');
const creditsLedgerPath = path.join(dataDir, 'credits-ledger.json');
const creditsNullifiersPath = path.join(dataDir, 'credits-nullifiers.json');
const creditsIntentsPath = path.join(dataDir, 'credits-intents.json');
const creditsOperatorQueuePath = path.join(dataDir, 'credits-operator-queue.json');
const creditsDepositMonitorsPath = path.join(dataDir, 'credits-deposit-monitors.json');
const creditsCheckpointBatchesPath = path.join(dataDir, 'credits-checkpoint-batches.json');
const operatorRegistryPath = path.join(dataDir, 'operator-registry.json');
const operatorMembershipPath = path.join(dataDir, 'operator-membership.json');
const localOperatorIdPath = path.join(dataDir, 'local-operator-id.txt');
const oracleKeyPath = path.join(dataDir, 'oracle-private-key.txt');
const attesterKeysPath = path.join(dataDir, 'attester-keys.json');
const privateLanePublicKeyPath = path.join(dataDir, 'private-lane-x25519-public.pem');
const privateLanePrivateKeyPath = path.join(dataDir, 'private-lane-x25519-private.pem');
const treeHeight = 20;
const attesterCount = Math.max(3, Number(process.env.OPENGRADIENT_ATTESTER_COUNT || 3));
const attesterQuorum = Math.max(2, Number(process.env.OPENGRADIENT_ATTESTER_QUORUM || 2));
const creditsMinDeposit = Math.max(0.01, Number(process.env.OPENGRADIENT_CREDITS_MIN_DEPOSIT || 0.1));
const platformFeeMina = Math.max(0, Number(process.env.OPENGRADIENT_PLATFORM_FEE_MINA || 0.01));
const creditsOperatorAutoProcessMs = Math.max(0, Number(process.env.OPENGRADIENT_CREDITS_OPERATOR_AUTO_PROCESS_MS || 3000));
const creditsOperatorMaxAttempts = Math.max(1, Number(process.env.OPENGRADIENT_CREDITS_OPERATOR_MAX_ATTEMPTS || 3));
const creditsOperatorLeaseMs = Math.max(
  30_000,
  Number(process.env.OPENGRADIENT_CREDITS_OPERATOR_LEASE_MS || 4 * 60 * 1000)
);
const creditsOperatorLockWaitMs = Math.max(
  1_000,
  Number(process.env.OPENGRADIENT_CREDITS_OPERATOR_LOCK_WAIT_MS || 15_000)
);
const creditsOperatorLockStaleMs = Math.max(
  5_000,
  Number(process.env.OPENGRADIENT_CREDITS_OPERATOR_LOCK_STALE_MS || 30_000)
);
const creditsCheckpointMaxBatchSize = Math.max(
  1,
  Number(process.env.OPENGRADIENT_CREDITS_CHECKPOINT_MAX_BATCH_SIZE || 10)
);
const creditsDepositMonitorAutoProcessMs = Math.max(
  0,
  Number(process.env.OPENGRADIENT_CREDITS_DEPOSIT_MONITOR_MS || 3000)
);
const creditsDepositMonitorMaxAttempts = Math.max(
  1,
  Number(process.env.OPENGRADIENT_CREDITS_DEPOSIT_MONITOR_MAX_ATTEMPTS || 60)
);
const daEndpoint = process.env.ZEKO_AI_DA_ENDPOINT || process.env.OPENGRADIENT_DA_ENDPOINT || null;
const daBearerToken = process.env.ZEKO_AI_DA_BEARER_TOKEN || process.env.OPENGRADIENT_DA_BEARER_TOKEN || null;
const daSchema = process.env.ZEKO_AI_DA_SCHEMA || process.env.OPENGRADIENT_DA_SCHEMA || 'zeko-ai.inference_receipt.v1';
const daAppId = process.env.ZEKO_AI_DA_APP_ID || process.env.OPENGRADIENT_DA_APP_ID || 'zeko-ai-builder-kit';
const defaultSettlementMode: SettlementMode = 'SETTLE_INDIVIDUAL';
const ethereumTargetChainId = Number(process.env.OPENGRADIENT_ETHEREUM_CHAIN_ID || 1);
const ethereumSettlementContract = process.env.OPENGRADIENT_ETHEREUM_SETTLEMENT_CONTRACT || null;
const coordinatorEndpoint = process.env.OPENGRADIENT_COORDINATOR_ENDPOINT?.trim() || null;
const coordinatorSyncMs = Math.max(5_000, Number(process.env.OPENGRADIENT_COORDINATOR_SYNC_MS || 30_000));
const operatorRouteStaleMs = Math.max(
  30_000,
  Number(process.env.OPENGRADIENT_OPERATOR_ROUTE_STALE_MS || Math.max(90_000, coordinatorSyncMs * 3))
);
const operatorRouteStrategy = process.env.OPENGRADIENT_ROUTE_STRATEGY === 'membership-first'
  ? 'membership-first'
  : 'local-preferred';
const inboundApiKeys = parseSecretList(process.env.OPENGRADIENT_HTTP_API_KEYS);
const inboundBearerTokens = parseSecretList(process.env.OPENGRADIENT_HTTP_BEARER_TOKENS);
const outboundApiKey = process.env.OPENGRADIENT_OUTBOUND_API_KEY?.trim() || null;
const outboundBearerToken = process.env.OPENGRADIENT_OUTBOUND_BEARER_TOKEN?.trim() || null;
const builderAuthPath = process.env.OPENGRADIENT_BUILDER_AUTH_PATH?.trim() || path.join(httpAuthDir, 'builders.json');
const builderUsagePath = process.env.OPENGRADIENT_BUILDER_USAGE_PATH?.trim() || path.join(dataDir, 'builder-usage.json');
const validBuilderScopes: BuilderScope[] = [
  'auth:read',
  'operators:read',
  'models:read',
  'agents:read',
  'agents:write',
  'inferences:read',
  'inferences:write',
  'credits:read',
  'credits:write'
];
const zekoNetwork = {
  networkId: process.env.ZEKO_NETWORK_ID || 'testnet',
  graphql: normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL || null, 'https://testnet.zeko.io/graphql'),
  archive: normalizeGraphqlUrl(process.env.ZEKO_ARCHIVE_GRAPHQL || null, 'https://archive.testnet.zeko.io/graphql'),
  explorer: process.env.ZEKO_EXPLORER || 'https://zekoscan.io/testnet'
};
function resolveLocalOperatorId() {
  const explicit = process.env.OPENGRADIENT_OPERATOR_ID?.trim();
  if (explicit) return explicit;
  try {
    const stored = readFileSync(localOperatorIdPath, 'utf8').trim();
    if (stored.length > 0) return stored;
  } catch {}
  const generated = `credits-operator-${zekoNetwork.networkId}-${crypto.randomUUID().slice(0, 12)}`;
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(localOperatorIdPath, `${generated}\n`, 'utf8');
  } catch {}
  return generated;
}
const creditsOperatorId = resolveLocalOperatorId();
const creditsOperatorLabel = process.env.OPENGRADIENT_OPERATOR_LABEL?.trim() || creditsOperatorId;
const creditsOperatorEndpoint = process.env.OPENGRADIENT_OPERATOR_ENDPOINT?.trim() || null;
const creditsOperatorCoordinationLockPath = path.join(dataDir, 'credits-operator-coordination.lock');
let creditsOperatorProcessing = false;
let creditsOperatorWorkerStarted = false;
let creditsDepositMonitorProcessing = false;
let creditsDepositMonitorWorkerStarted = false;
let coordinatorSyncWorkerStarted = false;
let storeReady = false;
let storeReadyPromise: Promise<void> | null = null;
let builderUsageWriteChain: Promise<void> = Promise.resolve();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function parseSecretList(value: string | undefined) {
  if (typeof value !== 'string') return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function defaultBuilderAuthFile(): BuilderAuthFile {
  return {
    version: 1,
    updatedAt: null,
    builders: []
  };
}

function defaultBuilderUsageDailyRecord(): BuilderUsageDailyRecord {
  return {
    day: new Date().toISOString().slice(0, 10),
    totalRequests: 0,
    writeRequests: 0,
    inferenceCreates: 0,
    agentCreates: 0,
    creditsSpendCount: 0,
    creditsSpendMina: 0
  };
}

function defaultBuilderUsageRecord(): BuilderUsageRecord {
  return {
    lastSeenAt: null,
    lastRequestAt: null,
    lastRequestPath: null,
    rateLimitWindow: {
      startedAt: null,
      totalRequests: 0,
      writeRequests: 0
    },
    daily: defaultBuilderUsageDailyRecord()
  };
}

function defaultBuilderUsageFile(): BuilderUsageFile {
  return {
    version: 1,
    updatedAt: null,
    builders: {}
  };
}

function normalizeBuilderScopeList(value: unknown): BuilderScope[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((entry) => String(entry)).filter((entry): entry is BuilderScope => validBuilderScopes.includes(entry as BuilderScope)))
  );
}

function normalizeBuilderAuthMode(value: unknown): BuilderAuthMode {
  return String(value || '').trim().toLowerCase() === 'bearer' ? 'bearer' : 'api-key';
}

function normalizeBuilderAuthFile(value: unknown): BuilderAuthFile {
  const rawBuilders = Array.isArray((value as any)?.builders) ? ((value as any).builders as unknown[]) : [];
  const builders = rawBuilders
    .map((entry) => {
      const id = String((entry as any)?.id || '').trim();
      const label = String((entry as any)?.label || id).trim();
      const secretHash = String((entry as any)?.secretHash || '').trim().toLowerCase();
      if (!id || !secretHash) return null;
      const rateLimitValue = (entry as any)?.rateLimit;
      const dailyQuotaValue = (entry as any)?.dailyQuota;
      const rateLimit =
        rateLimitValue && typeof rateLimitValue === 'object'
          ? {
              windowMs: Math.max(1000, Number((rateLimitValue as any).windowMs || 60_000)),
              maxRequests: Math.max(1, Number((rateLimitValue as any).maxRequests || 60)),
              maxWriteRequests:
                Number.isFinite(Number((rateLimitValue as any).maxWriteRequests)) &&
                Number((rateLimitValue as any).maxWriteRequests) > 0
                  ? Math.max(1, Number((rateLimitValue as any).maxWriteRequests))
                  : null
            }
          : null;
      const dailyQuota =
        dailyQuotaValue && typeof dailyQuotaValue === 'object'
          ? {
              inferenceCreates:
                Number.isFinite(Number((dailyQuotaValue as any).inferenceCreates)) &&
                Number((dailyQuotaValue as any).inferenceCreates) >= 0
                  ? Number((dailyQuotaValue as any).inferenceCreates)
                  : null,
              agentCreates:
                Number.isFinite(Number((dailyQuotaValue as any).agentCreates)) &&
                Number((dailyQuotaValue as any).agentCreates) >= 0
                  ? Number((dailyQuotaValue as any).agentCreates)
                  : null,
              creditsSpendCount:
                Number.isFinite(Number((dailyQuotaValue as any).creditsSpendCount)) &&
                Number((dailyQuotaValue as any).creditsSpendCount) >= 0
                  ? Number((dailyQuotaValue as any).creditsSpendCount)
                  : null,
              creditsSpendMina:
                Number.isFinite(Number((dailyQuotaValue as any).creditsSpendMina)) &&
                Number((dailyQuotaValue as any).creditsSpendMina) >= 0
                  ? Number((dailyQuotaValue as any).creditsSpendMina)
                  : null
            }
          : null;
      return {
        id,
        label,
        status: String((entry as any)?.status || '').trim().toLowerCase() === 'paused' ? 'paused' : 'active',
        authMode: normalizeBuilderAuthMode((entry as any)?.authMode),
        secretHash,
        scopes: normalizeBuilderScopeList((entry as any)?.scopes),
        rateLimit,
        dailyQuota,
        metadata:
          (entry as any)?.metadata && typeof (entry as any).metadata === 'object'
            ? ((entry as any).metadata as Record<string, unknown>)
            : null,
        createdAt: String((entry as any)?.createdAt || nowIso()),
        updatedAt: String((entry as any)?.updatedAt || nowIso())
      } satisfies BuilderAuthRecord;
    })
    .filter((entry): entry is BuilderAuthRecord => Boolean(entry));

  return {
    version: 1,
    updatedAt: typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null,
    builders
  };
}

function normalizeBuilderUsageFile(value: unknown): BuilderUsageFile {
  const rawBuilders =
    value && typeof value === 'object' && (value as any).builders && typeof (value as any).builders === 'object'
      ? ((value as any).builders as Record<string, unknown>)
      : {};
  const builders = Object.fromEntries(
    Object.entries(rawBuilders).map(([builderId, entry]) => {
      const daily = (entry as any)?.daily;
      const rateLimitWindow = (entry as any)?.rateLimitWindow;
      return [
        builderId,
        {
          lastSeenAt: typeof (entry as any)?.lastSeenAt === 'string' ? (entry as any).lastSeenAt : null,
          lastRequestAt: typeof (entry as any)?.lastRequestAt === 'string' ? (entry as any).lastRequestAt : null,
          lastRequestPath: typeof (entry as any)?.lastRequestPath === 'string' ? (entry as any).lastRequestPath : null,
          rateLimitWindow: {
            startedAt:
              typeof rateLimitWindow?.startedAt === 'string' ? (rateLimitWindow as any).startedAt : null,
            totalRequests: Math.max(0, Number(rateLimitWindow?.totalRequests || 0)),
            writeRequests: Math.max(0, Number(rateLimitWindow?.writeRequests || 0))
          },
          daily: {
            day: typeof daily?.day === 'string' ? (daily as any).day : new Date().toISOString().slice(0, 10),
            totalRequests: Math.max(0, Number(daily?.totalRequests || 0)),
            writeRequests: Math.max(0, Number(daily?.writeRequests || 0)),
            inferenceCreates: Math.max(0, Number(daily?.inferenceCreates || 0)),
            agentCreates: Math.max(0, Number(daily?.agentCreates || 0)),
            creditsSpendCount: Math.max(0, Number(daily?.creditsSpendCount || 0)),
            creditsSpendMina: Math.max(0, Number(daily?.creditsSpendMina || 0))
          }
        } satisfies BuilderUsageRecord
      ];
    })
  ) as Record<string, BuilderUsageRecord>;
  return {
    version: 1,
    updatedAt: typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null,
    builders
  };
}

async function readBuilderAuthFile() {
  return normalizeBuilderAuthFile(await readJson<BuilderAuthFile | Record<string, unknown>>(builderAuthPath, defaultBuilderAuthFile()));
}

async function readBuilderUsageFile() {
  return normalizeBuilderUsageFile(
    await readJson<BuilderUsageFile | Record<string, unknown>>(builderUsagePath, defaultBuilderUsageFile())
  );
}

async function writeBuilderUsageFile(payload: BuilderUsageFile) {
  await writeJson(builderUsagePath, payload);
}

async function withBuilderUsageWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const next = builderUsageWriteChain.then(work, work);
  builderUsageWriteChain = next.then(
    () => undefined,
    () => undefined
  );
  return await next;
}

function isHttpAuthEnabled(builderAuthFile: BuilderAuthFile) {
  return inboundApiKeys.length > 0 || inboundBearerTokens.length > 0 || builderAuthFile.builders.length > 0;
}

function normalizeAuthorizationBearer(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeApiKeyHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function getCreditsSpendMinaFromBody(body: unknown) {
  const candidate = Number((body as any)?.amountMina);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function resolveMcpRouteAccessPolicy(req: Request, baseDelta: BuilderRequestDelta): ApiRouteAccessPolicy {
  if (req.method.toUpperCase() !== 'POST') {
    return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const method = String(body.method || '').trim();
  const params = body.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : {};
  const toolName = String((params as any).name || '').trim();

  if (!method || method === 'initialize' || method === 'notifications/initialized' || method === 'ping' || method === 'tools/list') {
    return { builderAllowed: true, requiredScopes: [], delta: baseDelta };
  }

  if (method !== 'tools/call') {
    return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
  }

  if (toolName === 'auth_me') {
    return { builderAllowed: true, requiredScopes: ['auth:read'], delta: baseDelta };
  }
  if (toolName === 'list_models') {
    return { builderAllowed: true, requiredScopes: ['models:read'], delta: baseDelta };
  }
  if (toolName === 'get_routing') {
    return { builderAllowed: true, requiredScopes: ['operators:read'], delta: baseDelta };
  }
  if (toolName === 'create_inference') {
    return {
      builderAllowed: true,
      requiredScopes: ['inferences:write'],
      delta: { ...baseDelta, inferenceCreates: 1 }
    };
  }
  if (toolName === 'get_inference' || toolName === 'get_status') {
    return { builderAllowed: true, requiredScopes: ['inferences:read'], delta: baseDelta };
  }

  return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
}

function resolveApiRouteAccessPolicy(req: Request): ApiRouteAccessPolicy {
  const path = req.path || '/';
  const method = req.method.toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const baseDelta: BuilderRequestDelta = {
    isWrite,
    inferenceCreates: 0,
    agentCreates: 0,
    creditsSpendCount: 0,
    creditsSpendMina: 0
  };

  if (path === '/auth/me' && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['auth:read'], delta: baseDelta };
  }
  if (/^\/request-status\/[^/]+$/.test(path) && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['inferences:read'], delta: baseDelta };
  }
  if (path === '/private-lane/config' && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['inferences:write'], delta: baseDelta };
  }
  if (path === '/mcp') {
    return resolveMcpRouteAccessPolicy(req, baseDelta);
  }
  if ((path === '/compat/reference/models' || path === '/compat/opengradient/models') && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['models:read'], delta: baseDelta };
  }
  if (
    (
      path === '/compat/reference/inference' ||
      path === '/compat/reference/chat/completions' ||
      path === '/compat/opengradient/inference' ||
      path === '/compat/opengradient/chat/completions'
    ) &&
    method === 'POST'
  ) {
    return {
      builderAllowed: true,
      requiredScopes: ['inferences:write'],
      delta: { ...baseDelta, inferenceCreates: 1 }
    };
  }
  if (
    (/^\/compat\/reference\/inference\/[^/]+(?:\/status|\/receipt)?$/.test(path) ||
      /^\/compat\/opengradient\/inference\/[^/]+(?:\/status|\/receipt)?$/.test(path)) &&
    method === 'GET'
  ) {
    return { builderAllowed: true, requiredScopes: ['inferences:read'], delta: baseDelta };
  }

  if (path.startsWith('/operators/internal/')) {
    return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
  }
  if (path === '/operators/register' || /^\/operators\/[^/]+\/(heartbeat|status)$/.test(path)) {
    return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
  }
  if (path === '/operators/isolation/audit' && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['operators:read'], delta: baseDelta };
  }
  if (path === '/operators' || path.startsWith('/operators/')) {
    return { builderAllowed: method === 'GET', requiredScopes: method === 'GET' ? ['operators:read'] : [], delta: baseDelta };
  }
  if (path === '/models' && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['models:read'], delta: baseDelta };
  }
  if (path === '/agents' && method === 'GET') {
    return { builderAllowed: true, requiredScopes: ['agents:read'], delta: baseDelta };
  }
  if (path === '/agents' && method === 'POST') {
    return {
      builderAllowed: true,
      requiredScopes: ['agents:write'],
      delta: { ...baseDelta, agentCreates: 1 }
    };
  }
  if (/^\/agents\/[^/]+/.test(path)) {
    if (method === 'GET') {
      return { builderAllowed: true, requiredScopes: ['agents:read'], delta: baseDelta };
    }
    return { builderAllowed: true, requiredScopes: ['agents:write'], delta: baseDelta };
  }
  if (path === '/inferences' || path.startsWith('/inferences/')) {
    if (method === 'GET') {
      return { builderAllowed: true, requiredScopes: ['inferences:read'], delta: baseDelta };
    }
    return { builderAllowed: true, requiredScopes: ['inferences:write'], delta: baseDelta };
  }
  if (
    path === '/infer' ||
    path === '/infer/live' ||
    path === '/infer/v1/live' ||
    path === '/infer/v2/live' ||
    path === '/infer/private' ||
    path === '/infer/private/live'
  ) {
    return {
      builderAllowed: true,
      requiredScopes: ['inferences:write'],
      delta: { ...baseDelta, inferenceCreates: 1 }
    };
  }
  if (path.startsWith('/infer/')) {
    return { builderAllowed: true, requiredScopes: ['inferences:write'], delta: baseDelta };
  }
  if (
    path === '/credits/spend-intent' ||
    path === '/credits/spend-intent/batched' ||
    path === '/credits/spend-intent/fast'
  ) {
    return {
      builderAllowed: true,
      requiredScopes: ['credits:write'],
      delta: {
        ...baseDelta,
        creditsSpendCount: 1,
        creditsSpendMina: getCreditsSpendMinaFromBody(req.body)
      }
    };
  }
  if (
    path === '/credits/deposit-intent' ||
    path === '/credits/deposit-monitor' ||
    path === '/credits/confirm' ||
    path === '/credits-tx' ||
    path === '/credits-submit' ||
    path === '/credits/v1/tx' ||
    path === '/credits/v1/submit' ||
    path === '/credits/v2/tx' ||
    path === '/credits/v2/submit' ||
    path === '/credits/operator/enqueue'
  ) {
    return { builderAllowed: true, requiredScopes: ['credits:write'], delta: baseDelta };
  }
  if (
    path === '/credits/operator/process' ||
    path === '/credits/operator/checkpoint-batches/process' ||
    path === '/credits/deposit-monitor/process'
  ) {
    return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
  }
  if (
    path === '/credits/operator/queue' ||
    path.startsWith('/credits/operator/queue/') ||
    path === '/credits/operator/checkpoint-batches' ||
    path === '/credits/deposit-monitors' ||
    path.startsWith('/credits/deposit-monitors/') ||
    path === '/credits/balance'
  ) {
    return { builderAllowed: method === 'GET', requiredScopes: ['credits:read'], delta: baseDelta };
  }

  return { builderAllowed: false, requiredScopes: [], delta: baseDelta };
}

function buildUnauthorizedResponse(builderAuthFile: BuilderAuthFile) {
  return {
    error: 'Unauthorized.',
    auth: {
      accepted: {
        apiKey: inboundApiKeys.length > 0 || builderAuthFile.builders.some((entry) => entry.authMode === 'api-key'),
        bearer: inboundBearerTokens.length > 0 || builderAuthFile.builders.some((entry) => entry.authMode === 'bearer')
      }
    }
  };
}

function buildRequestAttribution(req: Request, access: RequestAccessContext): RequestAttributionRecord {
  return {
    principalRole: access.role,
    principalId: access.principalId,
    principalLabel: access.principalLabel,
    authMode: access.authMode,
    scopes: access.scopes[0] === '*' ? ['*'] : access.scopes,
    requestId:
      normalizeApiKeyHeader(req.headers['x-request-id']) ||
      normalizeApiKeyHeader(req.headers['idempotency-key']) ||
      crypto.randomUUID(),
    method: req.method.toUpperCase(),
    path: req.originalUrl || req.path || '/',
    remoteAddress: req.socket.remoteAddress || null,
    forwardedFor: normalizeApiKeyHeader(req.headers['x-forwarded-for']),
    userAgent: normalizeApiKeyHeader(req.headers['user-agent']),
    recordedAt: nowIso()
  };
}

function getRequestAccessContext(req: Request) {
  return (((req as any).requestAccessContext as RequestAccessContext | undefined) || null);
}

function getRequestAttribution(req: Request) {
  return (((req as any).requestAttribution as RequestAttributionRecord | undefined) || null);
}

function normalizeStoredAttribution(value: unknown): RequestAttributionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const principalId = String((value as any).principalId || '').trim();
  const principalLabel = String((value as any).principalLabel || principalId).trim();
  if (!principalId || !principalLabel) return null;
  return {
    principalRole: (value as any).principalRole === 'operator' ? 'operator' : 'builder',
    principalId,
    principalLabel,
    authMode:
      (value as any).authMode === 'bearer' || (value as any).authMode === 'api-key' || (value as any).authMode === 'shared-env'
        ? (value as any).authMode
        : 'api-key',
    scopes: Array.isArray((value as any).scopes) ? (value as any).scopes.map((entry: unknown) => String(entry)) : [],
    requestId: String((value as any).requestId || '').trim() || crypto.randomUUID(),
    method: String((value as any).method || 'GET').toUpperCase(),
    path: String((value as any).path || '/'),
    remoteAddress: typeof (value as any).remoteAddress === 'string' ? (value as any).remoteAddress : null,
    forwardedFor: typeof (value as any).forwardedFor === 'string' ? (value as any).forwardedFor : null,
    userAgent: typeof (value as any).userAgent === 'string' ? (value as any).userAgent : null,
    recordedAt: typeof (value as any).recordedAt === 'string' ? (value as any).recordedAt : nowIso()
  };
}

function canBuilderAccessScopes(access: RequestAccessContext, requiredScopes: BuilderScope[]) {
  if (access.role !== 'builder') return true;
  return requiredScopes.every((scope) => access.builder?.scopes.includes(scope));
}

function builderOwnsAttribution(access: RequestAccessContext | null, attribution: RequestAttributionRecord | null | undefined) {
  if (!access || access.role !== 'builder') return true;
  return attribution?.principalRole === 'builder' && attribution.principalId === access.principalId;
}

function getBuilderUsageStatus(builder: BuilderAuthRecord, usage: BuilderUsageRecord) {
  const rateLimit = builder.rateLimit
    ? {
        windowMs: builder.rateLimit.windowMs,
        startedAt: usage.rateLimitWindow.startedAt,
        usedRequests: usage.rateLimitWindow.totalRequests,
        usedWriteRequests: usage.rateLimitWindow.writeRequests,
        remainingRequests: Math.max(0, builder.rateLimit.maxRequests - usage.rateLimitWindow.totalRequests),
        remainingWriteRequests:
          builder.rateLimit.maxWriteRequests === null
            ? null
            : Math.max(0, builder.rateLimit.maxWriteRequests - usage.rateLimitWindow.writeRequests)
      }
    : null;
  const dailyQuota = builder.dailyQuota
    ? {
        day: usage.daily.day,
        inferenceCreates: {
          used: usage.daily.inferenceCreates,
          remaining:
            builder.dailyQuota.inferenceCreates === null
              ? null
              : Math.max(0, builder.dailyQuota.inferenceCreates - usage.daily.inferenceCreates)
        },
        agentCreates: {
          used: usage.daily.agentCreates,
          remaining:
            builder.dailyQuota.agentCreates === null
              ? null
              : Math.max(0, builder.dailyQuota.agentCreates - usage.daily.agentCreates)
        },
        creditsSpendCount: {
          used: usage.daily.creditsSpendCount,
          remaining:
            builder.dailyQuota.creditsSpendCount === null
              ? null
              : Math.max(0, builder.dailyQuota.creditsSpendCount - usage.daily.creditsSpendCount)
        },
        creditsSpendMina: {
          used: usage.daily.creditsSpendMina,
          remaining:
            builder.dailyQuota.creditsSpendMina === null
              ? null
              : Math.max(0, builder.dailyQuota.creditsSpendMina - usage.daily.creditsSpendMina)
        }
      }
    : null;
  return { rateLimit, dailyQuota };
}

async function resolveRequestAccessContext(
  req: Request,
  builderAuthFile: BuilderAuthFile
): Promise<RequestAccessContext | null> {
  const apiKey = normalizeApiKeyHeader(req.headers['x-api-key']);
  if (apiKey && inboundApiKeys.includes(apiKey)) {
    return {
      role: 'operator',
      principalId: 'shared-operator-api-key',
      principalLabel: 'shared-operator-api-key',
      authMode: 'shared-env',
      scopes: ['*'],
      builder: null,
      usage: null
    };
  }
  const bearerToken = normalizeAuthorizationBearer(req.headers.authorization);
  if (bearerToken && inboundBearerTokens.includes(bearerToken)) {
    return {
      role: 'operator',
      principalId: 'shared-operator-bearer',
      principalLabel: 'shared-operator-bearer',
      authMode: 'shared-env',
      scopes: ['*'],
      builder: null,
      usage: null
    };
  }

  const presentedMode: BuilderAuthMode | null = apiKey ? 'api-key' : bearerToken ? 'bearer' : null;
  const presentedSecret = apiKey || bearerToken;
  if (!presentedMode || !presentedSecret) {
    return null;
  }

  const presentedHash = sha256Hex(presentedSecret);
  const builder = builderAuthFile.builders.find(
    (entry) => entry.status === 'active' && entry.authMode === presentedMode && entry.secretHash === presentedHash
  );
  if (!builder) {
    return null;
  }

  const usageFile = await readBuilderUsageFile();
  return {
    role: 'builder',
    principalId: builder.id,
    principalLabel: builder.label,
    authMode: builder.authMode,
    scopes: builder.scopes,
    builder,
    usage: usageFile.builders[builder.id] || defaultBuilderUsageRecord()
  };
}

async function consumeBuilderUsageOrThrow(
  access: RequestAccessContext,
  req: Request,
  policy: ApiRouteAccessPolicy
): Promise<BuilderUsageRecord> {
  if (access.role !== 'builder' || !access.builder) {
    return access.usage || defaultBuilderUsageRecord();
  }

  return await withBuilderUsageWriteLock(async () => {
    const usageFile = await readBuilderUsageFile();
    const current = usageFile.builders[access.builder!.id] || defaultBuilderUsageRecord();
    const now = nowIso();
    const windowStartedAtMs = parseTimestampMs(current.rateLimitWindow.startedAt);
    const next: BuilderUsageRecord = {
      ...current,
      lastSeenAt: now,
      lastRequestAt: now,
      lastRequestPath: req.originalUrl || req.path || '/',
      rateLimitWindow:
        access.builder!.rateLimit &&
        (!windowStartedAtMs || Date.now() - windowStartedAtMs >= access.builder!.rateLimit.windowMs)
          ? {
              startedAt: now,
              totalRequests: 0,
              writeRequests: 0
            }
          : { ...current.rateLimitWindow },
      daily:
        current.daily.day === new Date().toISOString().slice(0, 10)
          ? { ...current.daily }
          : defaultBuilderUsageDailyRecord()
    };

    if (access.builder!.rateLimit) {
      if (next.rateLimitWindow.totalRequests + 1 > access.builder!.rateLimit.maxRequests) {
        throw Object.assign(new Error('Builder request rate limit exceeded.'), {
          statusCode: 429,
          details: getBuilderUsageStatus(access.builder!, next)
        });
      }
      if (
        policy.delta.isWrite &&
        access.builder!.rateLimit.maxWriteRequests !== null &&
        next.rateLimitWindow.writeRequests + 1 > access.builder!.rateLimit.maxWriteRequests
      ) {
        throw Object.assign(new Error('Builder write request rate limit exceeded.'), {
          statusCode: 429,
          details: getBuilderUsageStatus(access.builder!, next)
        });
      }
    }

    if (access.builder!.dailyQuota) {
      if (
        access.builder!.dailyQuota.inferenceCreates !== null &&
        next.daily.inferenceCreates + policy.delta.inferenceCreates > access.builder!.dailyQuota.inferenceCreates
      ) {
        throw Object.assign(new Error('Builder daily inference quota exceeded.'), {
          statusCode: 403,
          details: getBuilderUsageStatus(access.builder!, next)
        });
      }
      if (
        access.builder!.dailyQuota.agentCreates !== null &&
        next.daily.agentCreates + policy.delta.agentCreates > access.builder!.dailyQuota.agentCreates
      ) {
        throw Object.assign(new Error('Builder daily agent quota exceeded.'), {
          statusCode: 403,
          details: getBuilderUsageStatus(access.builder!, next)
        });
      }
      if (
        access.builder!.dailyQuota.creditsSpendCount !== null &&
        next.daily.creditsSpendCount + policy.delta.creditsSpendCount > access.builder!.dailyQuota.creditsSpendCount
      ) {
        throw Object.assign(new Error('Builder daily credits spend count quota exceeded.'), {
          statusCode: 403,
          details: getBuilderUsageStatus(access.builder!, next)
        });
      }
      if (
        access.builder!.dailyQuota.creditsSpendMina !== null &&
        next.daily.creditsSpendMina + policy.delta.creditsSpendMina > access.builder!.dailyQuota.creditsSpendMina
      ) {
        throw Object.assign(new Error('Builder daily credits spend MINA quota exceeded.'), {
          statusCode: 403,
          details: getBuilderUsageStatus(access.builder!, next)
        });
      }
    }

    next.rateLimitWindow.totalRequests += 1;
    if (policy.delta.isWrite) {
      next.rateLimitWindow.writeRequests += 1;
    }
    next.daily.totalRequests += 1;
    if (policy.delta.isWrite) {
      next.daily.writeRequests += 1;
    }
    next.daily.inferenceCreates += policy.delta.inferenceCreates;
    next.daily.agentCreates += policy.delta.agentCreates;
    next.daily.creditsSpendCount += policy.delta.creditsSpendCount;
    next.daily.creditsSpendMina += policy.delta.creditsSpendMina;

    usageFile.builders[access.builder!.id] = next;
    usageFile.updatedAt = now;
    await writeBuilderUsageFile(usageFile);
    return next;
  });
}

function buildOutboundAuthHeaders() {
  return {
    ...(outboundApiKey ? { 'x-api-key': outboundApiKey } : {}),
    ...(outboundBearerToken ? { authorization: `Bearer ${outboundBearerToken}` } : {})
  };
}

app.use('/api', (req, res, next) => {
  void (async () => {
    const builderAuthFile = await readBuilderAuthFile();
    if (!isHttpAuthEnabled(builderAuthFile)) {
      return next();
    }

    const access = await resolveRequestAccessContext(req, builderAuthFile);
    if (!access) {
      return res.status(401).json(buildUnauthorizedResponse(builderAuthFile));
    }

    const policy = resolveApiRouteAccessPolicy(req);
    if (access.role === 'builder') {
      if (!policy.builderAllowed) {
        return res.status(403).json({
          error: 'Builder credentials are not allowed to access this control-plane route.'
        });
      }
      if (!canBuilderAccessScopes(access, policy.requiredScopes)) {
        return res.status(403).json({
          error: 'Builder credential is missing the required scope for this route.',
          requiredScopes: policy.requiredScopes,
          grantedScopes: access.scopes
        });
      }
      try {
        access.usage = await consumeBuilderUsageOrThrow(access, req, policy);
      } catch (error) {
        const statusCode =
          typeof (error as any)?.statusCode === 'number' ? Number((error as any).statusCode) : 429;
        return res.status(statusCode).json({
          error: error instanceof Error ? error.message : String(error),
          usage: (error as any)?.details || null
        });
      }
    }

    (req as any).requestAccessContext = access;
    (req as any).requestAttribution = buildRequestAttribution(req, access);
    return next();
  })().catch((error) => {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
});

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeGraphqlUrl(value: string | null, fallback: string): string {
  const raw = value?.trim() || fallback;
  if (raw.endsWith('/graphql')) return raw;
  return `${raw.replace(/\/+$/, '')}/graphql`;
}

function hashTextToField(value: string): Field {
  const fields = Encoding.stringToFields(value.length ? value : '0');
  return Poseidon.hash(fields.length ? fields : [Field(0)]);
}

function hashJsonToField(value: unknown): Field {
  return hashTextToField(stableStringify(value));
}

function seededScore(seed: string): number {
  const hex = sha256Hex(seed);
  const value = Number.parseInt(hex.slice(0, 8), 16);
  return value / 0xffffffff;
}

function settlementModeToField(mode: SettlementMode): Field {
  if (mode === 'SETTLE_BATCH') return Field(2);
  if (mode === 'SETTLE_INDIVIDUAL_WITH_METADATA') return Field(3);
  return Field(1);
}

function normalizeSettlementMode(input: unknown, fallback: SettlementMode = defaultSettlementMode): SettlementMode {
  if (input === 'SETTLE_BATCH') return 'SETTLE_BATCH';
  if (input === 'SETTLE_INDIVIDUAL_WITH_METADATA') return 'SETTLE_INDIVIDUAL_WITH_METADATA';
  if (input === 'SETTLE_INDIVIDUAL') return 'SETTLE_INDIVIDUAL';
  return fallback;
}

function normalizeVerificationMethod(input: unknown): VerificationMethod {
  if (input === 'ORACLE_SIGNATURE') return 'ORACLE_SIGNATURE';
  if (input === 'THRESHOLD_ATTESTATION') return 'THRESHOLD_ATTESTATION';
  return 'TEE_PLACEHOLDER';
}

function normalizeTransportMode(input: unknown): TransportMode {
  if (input === 'MCP') return 'MCP';
  if (input === 'SDK') return 'SDK';
  return 'HTTP_X402';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function plusMsIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function isInferenceLifecycleStatus(value: unknown): value is InferenceLifecycleStatus {
  return value === 'created' || value === 'submitting' || value === 'submitted' || value === 'settled' || value === 'failed';
}

function normalizeInferenceCallbackMode(value: unknown, fallback: InferenceCallbackMode = 'terminal'): InferenceCallbackMode {
  return value === 'status-change' ? 'status-change' : fallback;
}

function buildFallbackInferenceStatusToken(inferenceId: string, createdAt: string) {
  return `sts_${sha256Hex(`${inferenceId}:${createdAt}`).slice(0, 32)}`;
}

function resolveStoredInferenceLifecycleStatus(entry: Pick<InferenceRecord, 'liveSettlement' | 'liveSettlementV2'>) {
  const liveSettlement = entry.liveSettlementV2 || entry.liveSettlement || null;
  if (!liveSettlement) return 'created' as InferenceLifecycleStatus;
  if (liveSettlement.lastError) return 'failed' as InferenceLifecycleStatus;
  if (liveSettlement.settled) return 'settled' as InferenceLifecycleStatus;
  if (liveSettlement.request?.txHash && liveSettlement.output?.txHash) return 'submitted' as InferenceLifecycleStatus;
  return 'submitting' as InferenceLifecycleStatus;
}

function normalizeStoredInferenceRequestStatus(
  value: unknown,
  inferenceId: string,
  createdAt: string,
  derivedStatus: InferenceLifecycleStatus
): InferenceRequestStatusRecord {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    token:
      typeof raw.token === 'string' && raw.token.trim().length > 0
        ? raw.token.trim()
        : buildFallbackInferenceStatusToken(inferenceId, createdAt),
    callbackUrl:
      typeof raw.callbackUrl === 'string' && raw.callbackUrl.trim().length > 0 ? raw.callbackUrl.trim() : null,
    callbackMode: normalizeInferenceCallbackMode(raw.callbackMode),
    lastStatus: isInferenceLifecycleStatus(raw.lastStatus) ? raw.lastStatus : derivedStatus,
    lastStatusAt: typeof raw.lastStatusAt === 'string' && raw.lastStatusAt.trim().length > 0 ? raw.lastStatusAt : createdAt,
    lastNotifiedStatus: isInferenceLifecycleStatus(raw.lastNotifiedStatus) ? raw.lastNotifiedStatus : null,
    lastCallbackAt: typeof raw.lastCallbackAt === 'string' && raw.lastCallbackAt.trim().length > 0 ? raw.lastCallbackAt : null,
    callbackAttempts: Number.isFinite(Number(raw.callbackAttempts)) ? Math.max(0, Number(raw.callbackAttempts)) : 0,
    lastCallbackError:
      typeof raw.lastCallbackError === 'string' && raw.lastCallbackError.trim().length > 0 ? raw.lastCallbackError : null
  };
}

function normalizeStoredPrivateInput(value: unknown): PrivateInputRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const envelope =
    raw.envelope && typeof raw.envelope === 'object' ? (raw.envelope as ClientEncryptedEnvelope) : null;
  return {
    enabled: raw.enabled !== false,
    operatorPublicKeyFingerprint:
      typeof raw.operatorPublicKeyFingerprint === 'string' && raw.operatorPublicKeyFingerprint.trim().length > 0
        ? raw.operatorPublicKeyFingerprint.trim()
        : envelope?.recipientPublicKeyFingerprint || null,
    envelopeHash:
      typeof raw.envelopeHash === 'string' && raw.envelopeHash.trim().length > 0 ? raw.envelopeHash.trim() : null,
    promptHash: typeof raw.promptHash === 'string' ? raw.promptHash : sha256Hex(''),
    inputsHash: typeof raw.inputsHash === 'string' ? raw.inputsHash : sha256Hex('{}'),
    plaintextPersisted: raw.plaintextPersisted === true,
    envelope
  };
}

function buildInferenceStatusPath(token: string) {
  return `/api/request-status/${encodeURIComponent(token)}`;
}

function buildRequestOrigin(req: Request) {
  const forwardedProto = normalizeApiKeyHeader(req.headers['x-forwarded-proto']);
  const forwardedHost = normalizeApiKeyHeader(req.headers['x-forwarded-host']);
  const host = forwardedHost || normalizeApiKeyHeader(req.headers.host);
  const protocol = forwardedProto || req.protocol || 'http';
  if (!host) return null;
  return `${protocol}://${host}`;
}

function buildAbsoluteRequestUrl(req: Request, pathname: string) {
  const origin = buildRequestOrigin(req);
  if (!origin) return null;
  return `${origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function parseTimestampMs(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildOperatorRoutingPolicySnapshot(): OperatorRoutingPolicySnapshot {
  return {
    generatedAt: nowIso(),
    routeStrategy: operatorRouteStrategy,
    coordinatorSyncMs,
    routeStaleAfterMs: operatorRouteStaleMs,
    requireActiveStatus: true,
    preferLocalWhenConfigured: operatorRouteStrategy === 'local-preferred',
    remoteRequiresEndpoint: true,
    remoteRequiresFreshHeartbeat: true,
    routeSelectionOrder: [
      operatorRouteStrategy === 'local-preferred'
        ? 'Prefer the local operator when the lane key is configured, admitted, and active.'
        : 'Choose the highest-priority admitted operator from the membership policy, even when the coordinator still has a local lane key.',
      'Otherwise choose the freshest active remote operator advertising the lane with a reachable endpoint.',
      'Treat stale or missing-heartbeat remote operators as unavailable for selection.'
    ],
    note:
      operatorRouteStrategy === 'local-preferred'
        ? 'Remote freshness is derived from lastSeenAt when present, otherwise updatedAt.'
        : 'Membership-first routing makes policy order the source of truth while freshness still protects against stale remote operators.'
  };
}

function normalizeLiveSettlementOptions(input: unknown): LiveSettlementOptions {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const waitTimeoutMs = Number(body.waitTimeoutMs);
  const pollIntervalMs = Number(body.pollIntervalMs);
  return {
    waitForSettlement: body.waitForSettlement !== false,
    waitTimeoutMs:
      Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0 ? Math.min(waitTimeoutMs, 10 * 60 * 1000) : 2 * 60 * 1000,
    pollIntervalMs:
      Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? Math.min(Math.max(pollIntervalMs, 250), 30_000) : 3000
  };
}

function shouldProcessCreditsOperatorNow(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return body.processNow === true || body.waitForSettlement === true;
}

function normalizeOperatorSource(value: unknown): CreditsOperatorQueueItem['source'] {
  if (value === 'deposit-intent' || value === 'spend-intent' || value === 'manual') {
    return value;
  }
  return 'manual';
}

function normalizeCreditsSettlementStrategy(value: unknown): CreditsSettlementStrategy {
  return value === 'checkpoint' || value === 'fast' ? 'checkpoint' : 'direct';
}

function clearCreditsOperatorLease(item: CreditsOperatorQueueItem): CreditsOperatorQueueItem {
  return {
    ...item,
    leaseOwnerId: null,
    leaseId: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null
  };
}

function isCreditsOperatorLeaseActive(item: CreditsOperatorQueueItem, nowMs = Date.now()) {
  const expiresAtMs = parseTimestampMs(item.leaseExpiresAt);
  return Boolean(item.leaseOwnerId && item.leaseId && expiresAtMs !== null && expiresAtMs > nowMs);
}

function isCreditsOperatorLeaseOwnedBy(item: CreditsOperatorQueueItem, ownerId: string, leaseId?: string) {
  return item.leaseOwnerId === ownerId && (!leaseId || item.leaseId === leaseId);
}

function resolveCreditsOperatorLeaseMs(optionsInput: unknown) {
  const options = normalizeLiveSettlementOptions(optionsInput);
  return Math.max(creditsOperatorLeaseMs, options.waitTimeoutMs + 60_000);
}

function isCreditsPayloadApplied(
  payload: ZekoThresholdCreditsPayload,
  chainState: Awaited<ReturnType<typeof fetchZkappAccountStateV2>> | null
) {
  return (
    (chainState?.zkappState[3] || null) === payload.creditsRoot &&
    (chainState?.zkappState[4] || null) === payload.nullifierRoot
  );
}

function isCreditsOperatorItemClaimable(
  item: CreditsOperatorQueueItem,
  options: {
    settlementStrategy: CreditsSettlementStrategy;
    retryFailed: boolean;
    maxAttempts: number;
    nowMs?: number;
  }
) {
  if (item.settlementStrategy !== options.settlementStrategy) return false;
  const nowMs = options.nowMs ?? Date.now();
  const hasActiveLease = isCreditsOperatorLeaseActive(item, nowMs);
  if (hasActiveLease && item.leaseOwnerId !== creditsOperatorId) return false;
  if (item.status === 'settled' || item.status === 'superseded') return false;
  if (item.status === 'failed') {
    return options.retryFailed && item.attemptCount < options.maxAttempts;
  }
  if (item.status === 'queued' || item.status === 'processing' || item.status === 'submitted') {
    return true;
  }
  return false;
}

function normalizeOperatorRegistryStatus(value: unknown, fallback: OperatorRegistryStatus = 'active'): OperatorRegistryStatus {
  if (value === 'paused') return 'paused';
  if (value === 'draining') return 'draining';
  if (value === 'active') return 'active';
  return fallback;
}

function buildOperatorLaneAssignmentsFromStatuses(statuses: SponsorLaneStatus[]): OperatorLaneAssignment[] {
  return statuses.map((entry) => ({
    lane: entry.lane,
    configured: entry.privateKeyConfigured,
    publicKey: entry.publicKey,
    source: entry.source,
    usesSharedFallback: entry.usesSharedFallback
  }));
}

function buildOperatorCapabilities(assignments: OperatorLaneAssignment[]): string[] {
  const capabilities = new Set<string>();
  assignments.forEach((entry) => {
    if (!entry.configured) return;
    if (entry.lane === 'request') capabilities.add('request-settlement');
    if (entry.lane === 'output') capabilities.add('output-settlement');
    if (entry.lane === 'registry') capabilities.add('registry-settlement');
    if (entry.lane === 'credits') {
      capabilities.add('credits-direct-settlement');
      capabilities.add('credits-checkpoint-settlement');
      capabilities.add('credits-deposit-monitor');
    }
  });
  return Array.from(capabilities).sort((a, b) => a.localeCompare(b));
}

function buildLocalOperatorRegistryRecord(
  existing: OperatorRegistryRecord | null = null,
  membershipRecord: OperatorMembershipRecordBody | null = null
): OperatorRegistryRecord {
  const laneStatuses = listSponsorLaneStatuses();
  const sponsorLanes = intersectLaneAssignmentsWithMembership(
    buildOperatorLaneAssignmentsFromStatuses(laneStatuses),
    membershipRecord
  );
  return {
    id: creditsOperatorId,
    label: membershipRecord?.label || creditsOperatorLabel || existing?.label || creditsOperatorId,
    endpoint: membershipRecord?.endpoint || creditsOperatorEndpoint || existing?.endpoint || null,
    status: existing ? normalizeOperatorRegistryStatus(existing.status, 'active') : 'active',
    local: true,
    networkId: zekoNetwork.networkId,
    contractVersions: membershipRecord?.contractVersions?.length ? membershipRecord.contractVersions : ['v1', 'v2'],
    capabilities:
      membershipRecord?.capabilities?.length
        ? membershipRecord.capabilities
        : buildOperatorCapabilities(sponsorLanes),
    sponsorLanes,
    metadata: membershipRecord
      ? {
          ...(existing?.metadata || {}),
          membershipPolicy: {
            enforced: true,
            issuedAt: membershipRecord.issuedAt,
            updatedAt: membershipRecord.updatedAt
          }
        }
      : existing?.metadata || null,
    registeredAt: existing?.registeredAt || nowIso(),
    updatedAt: nowIso(),
    lastSeenAt: nowIso()
  };
}

function defaultTreeState(): TreeState {
  return {
    requestLeaves: {},
    outputLeaves: {},
    nextRequestIndex: 0,
    nextOutputIndex: 0
  };
}

function defaultCoordinationTreeState(): CoordinationTreeState {
  return {
    agentLeaves: {},
    creditsLeaves: {},
    nullifierLeaves: {},
    nextAgentIndex: 0,
    nextCreditsIndex: 0,
    nextNullifierIndex: 0
  };
}

function emptyRootJson() {
  return new MerkleTree(treeHeight).getRoot().toJSON();
}

function defaultCreditsLedger(): CreditsLedgerFile {
  return {
    balances: {},
    pendingDeposits: {},
    history: []
  };
}

function defaultCreditsNullifiers(): CreditsNullifierFile {
  return {
    nullifiers: {}
  };
}

function defaultCreditsOperatorQueue(): CreditsOperatorQueueFile {
  return {
    items: [],
    lastProcessedAt: null,
    lastError: null
  };
}

function defaultCreditsDepositMonitorFile(): CreditsDepositMonitorFile {
  return {
    items: [],
    lastProcessedAt: null,
    lastError: null
  };
}

function defaultCreditsCheckpointBatchFile(): CreditsCheckpointBatchFile {
  return {
    batches: [],
    lastProcessedAt: null,
    lastError: null
  };
}

function defaultOperatorRegistryFile(): OperatorRegistryFile {
  return {
    operators: [],
    lastUpdatedAt: null
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return fallback;
    }
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath: string, payload: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function readCreditsOperatorLockMetadata() {
  try {
    const raw = await fs.readFile(creditsOperatorCoordinationLockPath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as CreditsOperatorLockMetadata;
  } catch {
    return null;
  }
}

async function withCreditsOperatorCoordinationLock<T>(work: () => Promise<T>): Promise<T> {
  const startedAtMs = Date.now();

  while (Date.now() - startedAtMs <= creditsOperatorLockWaitMs) {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(creditsOperatorCoordinationLockPath, 'wx');
      const metadata: CreditsOperatorLockMetadata = {
        ownerId: creditsOperatorId,
        pid: process.pid,
        acquiredAt: nowIso(),
        expiresAt: plusMsIso(creditsOperatorLockStaleMs)
      };
      await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await handle.close();
      handle = null;

      try {
        return await work();
      } finally {
        await fs.unlink(creditsOperatorCoordinationLockPath).catch(() => undefined);
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      const metadata = await readCreditsOperatorLockMetadata();
      const expiresAtMs = parseTimestampMs(metadata?.expiresAt);
      if (expiresAtMs === null || expiresAtMs <= Date.now()) {
        await fs.unlink(creditsOperatorCoordinationLockPath).catch(() => undefined);
        continue;
      }

      await sleep(Math.min(500, Math.max(100, creditsOperatorLockStaleMs / 10)));
    }
  }

  const metadata = await readCreditsOperatorLockMetadata();
  throw new Error(
    `Timed out waiting for credits operator coordination lock held by ${metadata?.ownerId || 'unknown-owner'}.`
  );
}

async function readInferencesFile() {
  const inferencesFile = await readJson<InferencesFile>(inferencesPath, { inferences: [] });
  return {
    ...inferencesFile,
    inferences: inferencesFile.inferences.map((entry) => ({
      ...entry,
      attribution: normalizeStoredAttribution((entry as any).attribution),
      privateInput: normalizeStoredPrivateInput((entry as any).privateInput),
      requestStatus: normalizeStoredInferenceRequestStatus(
        (entry as any).requestStatus,
        String((entry as any).id || ''),
        String((entry as any).createdAt || nowIso()),
        resolveStoredInferenceLifecycleStatus(entry as InferenceRecord)
      )
    }))
  };
}

async function getInferenceById(id: string) {
  const inferencesFile = await readInferencesFile();
  return inferencesFile.inferences.find((entry) => entry.id === id) || null;
}

async function updateInferenceById(
  id: string,
  update: (inference: InferenceRecord) => InferenceRecord
): Promise<InferenceRecord | null> {
  const inferencesFile = await readInferencesFile();
  const index = inferencesFile.inferences.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const next = update(inferencesFile.inferences[index]);
  inferencesFile.inferences[index] = next;
  await writeJson(inferencesPath, inferencesFile);
  return next;
}

async function getInferenceByStatusToken(token: string) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return null;
  const inferencesFile = await readInferencesFile();
  return inferencesFile.inferences.find((entry) => entry.requestStatus.token === normalizedToken) || null;
}

function resolveInferenceContractVersion(inference: InferenceRecord): 'v1' | 'v2' {
  return inference.zekoV2 ? 'v2' : 'v1';
}

function resolveInferenceLiveSettlement(inference: InferenceRecord) {
  return inference.liveSettlementV2 || inference.liveSettlement || null;
}

function buildInferenceStageSnapshot(stage: LiveReceiptStageRecord | null) {
  if (!stage) return null;
  return {
    kind: stage.kind,
    stateIndex: stage.stateIndex,
    targetRoot: stage.targetRoot,
    txHash: stage.txHash,
    submittedAt: stage.submittedAt,
    settled: stage.settled,
    settledAt: stage.settledAt,
    observedRoot: stage.observedRoot,
    explorerUrl: stage.explorerUrl,
    note: stage.note
  };
}

function buildInferenceSettlementSnapshot(inference: InferenceRecord) {
  const liveSettlement = resolveInferenceLiveSettlement(inference);
  return {
    layer: 'zeko-testnet',
    futureLayer: 'ethereum',
    contractVersion: resolveInferenceContractVersion(inference),
    mode: liveSettlement?.mode || 'ARTIFACT_ONLY',
    waitForSettlement: liveSettlement?.waitForSettlement || false,
    settled: liveSettlement?.settled || false,
    settledAt: liveSettlement?.settledAt || null,
    latestCheckAt: liveSettlement?.latestCheckAt || null,
    lastError: liveSettlement?.lastError || null,
    receiptHash: inference.receiptHash,
    requestHash: inference.requestHash,
    outputHash: inference.outputHash,
    metadataHash: inference.metadataHash,
    request: buildInferenceStageSnapshot(liveSettlement?.request || null),
    output: buildInferenceStageSnapshot(liveSettlement?.output || null),
    thresholdAttestation: inference.attestations
      ? {
          method: inference.attestations.method,
          quorum: inference.attestations.quorum,
          digest: inference.attestations.digest,
          attestersAvailable: inference.attestations.attestersAvailable,
          signatureCount: inference.attestations.signatures.length
        }
      : null,
    futureSettlement: inference.futureEthereum
  };
}

function buildInferenceStatusSnapshot(inference: InferenceRecord, req?: Request) {
  const status = resolveStoredInferenceLifecycleStatus(inference);
  const statusPath = buildInferenceStatusPath(inference.requestStatus.token);
  const inferencePath = `/api/inferences/${encodeURIComponent(inference.id)}`;
  const compatPath = `/api/compat/reference/inference/${encodeURIComponent(inference.id)}`;
  const liveSettlement = resolveInferenceLiveSettlement(inference);
  return {
    inferenceId: inference.id,
    requestId: inference.attribution?.requestId || inference.id,
    status,
    statusToken: inference.requestStatus.token,
    statusPath,
    statusUrl: req ? buildAbsoluteRequestUrl(req, statusPath) : null,
    createdAt: inference.createdAt,
    updatedAt: liveSettlement?.latestCheckAt || inference.requestStatus.lastStatusAt,
    liveSettlementRequested: Boolean(liveSettlement),
    settlement: buildInferenceSettlementSnapshot(inference),
    callback: {
      url: inference.requestStatus.callbackUrl,
      mode: inference.requestStatus.callbackMode,
      lastNotifiedStatus: inference.requestStatus.lastNotifiedStatus,
      lastCallbackAt: inference.requestStatus.lastCallbackAt,
      callbackAttempts: inference.requestStatus.callbackAttempts,
      lastCallbackError: inference.requestStatus.lastCallbackError
    },
    links: {
      inferencePath,
      inferenceUrl: req ? buildAbsoluteRequestUrl(req, inferencePath) : null,
      compatPath,
      compatUrl: req ? buildAbsoluteRequestUrl(req, compatPath) : null
    }
  };
}

function shouldNotifyInferenceCallback(inference: InferenceRecord, status: InferenceLifecycleStatus) {
  if (!inference.requestStatus.callbackUrl) return false;
  if (inference.requestStatus.lastNotifiedStatus === status) return false;
  if (inference.requestStatus.callbackMode === 'status-change') return true;
  return status === 'submitted' || status === 'settled' || status === 'failed';
}

function buildInferenceCallbackPayload(inference: InferenceRecord) {
  const status = buildInferenceStatusSnapshot(inference);
  return {
    object: 'compat.inference.status',
    event: 'inference.status.updated',
    inference_id: inference.id,
    request_id: inference.attribution?.requestId || inference.id,
    model_id: inference.modelId,
    created_at: inference.createdAt,
    status,
    settlement: status.settlement,
    privacy: inference.privacy
  };
}

async function postInferenceStatusCallback(url: string, bodyText: string, token: string, status: InferenceLifecycleStatus) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Inference callback timed out.')), 5_000);
  try {
    const signature = crypto.createHmac('sha256', token).update(bodyText).digest('hex');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zeko-ai-status': status,
        'x-zeko-ai-status-token': token,
        'x-zeko-ai-signature': `sha256=${signature}`,
        'x-opengradient-status': status,
        'x-opengradient-status-token': token,
        'x-opengradient-signature': `sha256=${signature}`
      },
      body: bodyText,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Inference callback failed with HTTP ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverInferenceStatusCallback(inference: InferenceRecord) {
  if (!inference.requestStatus.callbackUrl) return inference;
  const status = resolveStoredInferenceLifecycleStatus(inference);
  const payload = buildInferenceCallbackPayload(inference);
  const bodyText = JSON.stringify(payload);
  const attemptedAt = nowIso();

  try {
    await postInferenceStatusCallback(inference.requestStatus.callbackUrl, bodyText, inference.requestStatus.token, status);
    return (
      (await updateInferenceById(inference.id, (current) => ({
        ...current,
        requestStatus: {
          ...current.requestStatus,
          lastNotifiedStatus: status,
          lastCallbackAt: attemptedAt,
          callbackAttempts: current.requestStatus.callbackAttempts + 1,
          lastCallbackError: null
        }
      }))) || inference
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      (await updateInferenceById(inference.id, (current) => ({
        ...current,
        requestStatus: {
          ...current.requestStatus,
          lastCallbackAt: attemptedAt,
          callbackAttempts: current.requestStatus.callbackAttempts + 1,
          lastCallbackError: message
        }
      }))) || inference
    );
  }
}

function refreshReceiptStageFromChain(
  stage: LiveReceiptStageRecord | null,
  chainStateValue: string | null,
  settledNote: string,
  checkedAt: string
) {
  if (!stage) return null;
  const settled = chainStateValue === stage.targetRoot;
  return {
    ...stage,
    observedRoot: chainStateValue,
    settled,
    settledAt: settled ? stage.settledAt || checkedAt : stage.settledAt,
    note: settled ? settledNote : stage.note
  };
}

async function refreshInferenceSettlementState(inference: InferenceRecord) {
  let current = inference;

  if (current.liveSettlementV2 && !current.liveSettlementV2.settled && (current.liveSettlementV2.request || current.liveSettlementV2.output)) {
    const chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (chainState) {
      const checkedAt = nowIso();
      const nextRequest = refreshReceiptStageFromChain(
        current.liveSettlementV2.request,
        chainState.zkappState[current.liveSettlementV2.request?.stateIndex || 0] || null,
        'Request root observed on Zeko testnet v2.',
        checkedAt
      );
      const nextOutput = refreshReceiptStageFromChain(
        current.liveSettlementV2.output,
        chainState.zkappState[current.liveSettlementV2.output?.stateIndex || 0] || null,
        'Output root observed on Zeko testnet v2.',
        checkedAt
      );
      const nextLiveSettlementV2: LiveSettlementRecordV2 = {
        ...current.liveSettlementV2,
        request: nextRequest,
        output: nextOutput,
        latestCheckAt: checkedAt,
        settled: Boolean(nextRequest?.settled && nextOutput?.settled),
        settledAt:
          nextRequest?.settled && nextOutput?.settled
            ? current.liveSettlementV2.settledAt || checkedAt
            : current.liveSettlementV2.settledAt
      };
      if (stableStringify(nextLiveSettlementV2) !== stableStringify(current.liveSettlementV2)) {
        current =
          (await updateInferenceById(current.id, (entry) => ({
            ...entry,
            liveSettlementV2: nextLiveSettlementV2
          }))) || { ...current, liveSettlementV2: nextLiveSettlementV2 };
      }
    }
  }

  if (current.liveSettlement && !current.liveSettlement.settled && (current.liveSettlement.request || current.liveSettlement.output)) {
    const chainState = await fetchZkappAccountState().catch(() => null);
    if (chainState) {
      const checkedAt = nowIso();
      const nextRequest = refreshReceiptStageFromChain(
        current.liveSettlement.request,
        chainState.zkappState[current.liveSettlement.request?.stateIndex || 0] || null,
        'Request root observed on Zeko testnet.',
        checkedAt
      );
      const nextOutput = refreshReceiptStageFromChain(
        current.liveSettlement.output,
        chainState.zkappState[current.liveSettlement.output?.stateIndex || 0] || null,
        'Output root observed on Zeko testnet.',
        checkedAt
      );
      const nextLiveSettlement: LiveSettlementRecord = {
        ...current.liveSettlement,
        request: nextRequest,
        output: nextOutput,
        latestCheckAt: checkedAt,
        settled: Boolean(nextRequest?.settled && nextOutput?.settled),
        settledAt:
          nextRequest?.settled && nextOutput?.settled
            ? current.liveSettlement.settledAt || checkedAt
            : current.liveSettlement.settledAt
      };
      if (stableStringify(nextLiveSettlement) !== stableStringify(current.liveSettlement)) {
        current =
          (await updateInferenceById(current.id, (entry) => ({
            ...entry,
            liveSettlement: nextLiveSettlement
          }))) || { ...current, liveSettlement: nextLiveSettlement };
      }
    }
  }

  return current;
}

async function reconcileInferenceRequestStatus(
  inferenceId: string,
  options: { refreshChain?: boolean } = {}
): Promise<InferenceRecord | null> {
  let inference = await getInferenceById(inferenceId);
  if (!inference) return null;

  if (options.refreshChain) {
    inference = await refreshInferenceSettlementState(inference);
  }

  const status = resolveStoredInferenceLifecycleStatus(inference);
  if (inference.requestStatus.lastStatus !== status) {
    inference =
      (await updateInferenceById(inference.id, (current) => ({
        ...current,
        requestStatus: {
          ...current.requestStatus,
          lastStatus: status,
          lastStatusAt: nowIso()
        }
      }))) || inference;
  }

  if (shouldNotifyInferenceCallback(inference, status)) {
    inference = await deliverInferenceStatusCallback(inference);
  }

  return inference;
}

async function readAgentsFile() {
  const agentsFile = await readJson<AgentRegistrationsFile>(agentsPath, { agents: [] });
  return {
    ...agentsFile,
    agents: agentsFile.agents.map((entry) => ({
      ...entry,
      attribution: normalizeStoredAttribution((entry as any).attribution)
    }))
  };
}

async function getAgentById(id: string) {
  const agentsFile = await readAgentsFile();
  return agentsFile.agents.find((entry) => entry.id === id) || null;
}

async function ensureAgentHasV2Payload(agent: AgentRegistrationRecord) {
  if (agent.zekoV2?.registrationPayload) return agent;
  const zekoV2 = await buildV2AgentRegistrationPayload(
    Field.fromJSON(agent.agentIdHash),
    Field.fromJSON(agent.ownerHash),
    Field.fromJSON(agent.treasuryHash),
    Field.fromJSON(agent.stakeAmount),
    Field.fromJSON(agent.merkleRoot),
    agent.merkleIndex
  );
  return (
    (await updateAgentById(agent.id, (current) => ({
      ...current,
      zekoV2,
      liveSettlementV2: current.liveSettlementV2 ?? null
    }))) || { ...agent, zekoV2, liveSettlementV2: agent.liveSettlementV2 ?? null }
  );
}

async function updateAgentById(
  id: string,
  update: (agent: AgentRegistrationRecord) => AgentRegistrationRecord
): Promise<AgentRegistrationRecord | null> {
  const agentsFile = await readAgentsFile();
  const index = agentsFile.agents.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const next = update(agentsFile.agents[index]);
  agentsFile.agents[index] = next;
  await writeJson(agentsPath, agentsFile);
  return next;
}

async function readCoordinationTreeState() {
  return await readJson<CoordinationTreeState>(coordinationTreesPath, defaultCoordinationTreeState());
}

async function readCreditsLedger() {
  return await readJson<CreditsLedgerFile>(creditsLedgerPath, defaultCreditsLedger());
}

async function writeCreditsLedger(ledger: CreditsLedgerFile) {
  await writeJson(creditsLedgerPath, ledger);
}

async function readCreditsNullifiers() {
  return await readJson<CreditsNullifierFile>(creditsNullifiersPath, defaultCreditsNullifiers());
}

async function writeCreditsNullifiers(payload: CreditsNullifierFile) {
  await writeJson(creditsNullifiersPath, payload);
}

async function readCreditsIntents() {
  return await readJson<CreditsIntentsFile>(creditsIntentsPath, { intents: {} });
}

async function writeCreditsIntents(payload: CreditsIntentsFile) {
  await writeJson(creditsIntentsPath, payload);
}

async function readCreditsOperatorQueue() {
  const queue = await readJson<CreditsOperatorQueueFile>(creditsOperatorQueuePath, defaultCreditsOperatorQueue());
  return {
    ...queue,
    items: queue.items.map((item) => ({
      ...item,
      settlementStrategy: normalizeCreditsSettlementStrategy((item as any).settlementStrategy),
      batchId: (item as any).batchId ?? null,
      leaseOwnerId: (item as any).leaseOwnerId ?? null,
      leaseId: (item as any).leaseId ?? null,
      leaseAcquiredAt: (item as any).leaseAcquiredAt ?? null,
      leaseExpiresAt: (item as any).leaseExpiresAt ?? null,
      lastOperatorId: (item as any).lastOperatorId ?? null,
      attribution: normalizeStoredAttribution((item as any).attribution)
    }))
  };
}

async function writeCreditsOperatorQueue(payload: CreditsOperatorQueueFile) {
  await writeJson(creditsOperatorQueuePath, payload);
}

async function readCreditsDepositMonitors() {
  const monitors = await readJson<CreditsDepositMonitorFile>(creditsDepositMonitorsPath, defaultCreditsDepositMonitorFile());
  return {
    ...monitors,
    items: monitors.items.map((item) => ({
      ...item,
      attribution: normalizeStoredAttribution((item as any).attribution)
    }))
  };
}

async function writeCreditsDepositMonitors(payload: CreditsDepositMonitorFile) {
  await writeJson(creditsDepositMonitorsPath, payload);
}

async function readCreditsCheckpointBatches() {
  const batchFile = await readJson<CreditsCheckpointBatchFile>(
    creditsCheckpointBatchesPath,
    defaultCreditsCheckpointBatchFile()
  );
  return {
    ...batchFile,
    batches: batchFile.batches.map((batch) => ({
      ...batch,
      operatorId: (batch as any).operatorId ?? null
    }))
  };
}

async function writeCreditsCheckpointBatches(payload: CreditsCheckpointBatchFile) {
  await writeJson(creditsCheckpointBatchesPath, payload);
}

async function readOperatorRegistry() {
  const registry = await readJson<OperatorRegistryFile>(operatorRegistryPath, defaultOperatorRegistryFile());
  return {
    ...registry,
    operators: registry.operators.map((operator): OperatorRegistryRecord => {
      const contractVersions: Array<'v1' | 'v2'> = Array.isArray(operator.contractVersions)
        ? operator.contractVersions.filter((entry): entry is 'v1' | 'v2' => entry === 'v1' || entry === 'v2')
        : ['v2'];
      const sponsorLanes: OperatorLaneAssignment[] = Array.isArray(operator.sponsorLanes)
        ? operator.sponsorLanes.map((lane) => ({
            lane:
              lane && typeof lane === 'object' && 'lane' in lane && typeof (lane as any).lane === 'string'
                ? ((['request', 'output', 'registry', 'credits'] as SponsorLane[]).includes((lane as any).lane)
                    ? ((lane as any).lane as SponsorLane)
                    : 'credits')
                : 'credits',
            configured: Boolean((lane as any)?.configured),
            publicKey:
              typeof (lane as any)?.publicKey === 'string' && (lane as any).publicKey.trim().length > 0
                ? (lane as any).publicKey.trim()
                : null,
            source:
              (lane as any)?.source === 'env-lane' ||
              (lane as any)?.source === 'env-shared' ||
              (lane as any)?.source === 'stored-lane' ||
              (lane as any)?.source === 'stored-shared'
                ? (lane as any).source
                : 'missing',
            usesSharedFallback: Boolean((lane as any)?.usesSharedFallback)
          }))
        : [];
      return {
        ...operator,
        status: normalizeOperatorRegistryStatus((operator as any).status),
        local: Boolean((operator as any).local),
        endpoint: typeof operator.endpoint === 'string' && operator.endpoint.trim().length > 0 ? operator.endpoint : null,
        contractVersions,
        capabilities: Array.isArray(operator.capabilities)
          ? operator.capabilities.map((entry) => String(entry)).sort((a, b) => a.localeCompare(b))
          : [],
        sponsorLanes
      };
    })
  };
}

async function writeOperatorRegistry(payload: OperatorRegistryFile) {
  await writeJson(operatorRegistryPath, payload);
}

async function readOperatorMembershipFile() {
  const membership = await readJson<OperatorMembershipFile | null>(operatorMembershipPath, null);
  return normalizeOperatorMembershipFile(membership);
}

async function getVerifiedOperatorMembershipState() {
  const membership = await readOperatorMembershipFile();
  const verified = membership
    ? verifyOperatorMembershipFile(membership)
    : {
        present: false,
        policyPublicKey: null,
        operators: [] as VerifiedOperatorMembershipRecord[]
      };
  const verifiedById = new Map<string, VerifiedOperatorMembershipRecord>();
  verified.operators.forEach((entry) => {
    if (entry.verified) {
      verifiedById.set(entry.record.operatorId, entry);
    }
  });
  return {
    ...verified,
    enforced: verified.present,
    verifiedById
  };
}

function getMembershipLanePolicy(
  state: Awaited<ReturnType<typeof getVerifiedOperatorMembershipState>>,
  operatorId: string,
  lane: SponsorLane
) {
  return state.verifiedById.get(operatorId)?.laneMap[lane] || null;
}

function buildOperatorLaneAssignmentsFromMembership(record: OperatorMembershipRecordBody): OperatorLaneAssignment[] {
  return record.sponsorLanes
    .slice()
    .sort(compareMembershipLanePolicy)
    .map((lane): OperatorLaneAssignment => ({
      lane: lane.lane,
      configured: lane.enabled,
      publicKey: lane.publicKey,
      source: lane.publicKey ? 'stored-lane' : 'missing',
      usesSharedFallback: false
    }));
}

function intersectLaneAssignmentsWithMembership(
  actualAssignments: OperatorLaneAssignment[],
  membershipRecord: OperatorMembershipRecordBody | null
) {
  if (!membershipRecord) {
    return actualAssignments;
  }
  const laneMap = buildMembershipLaneMap(membershipRecord.sponsorLanes);
  return actualAssignments.map((assignment) => {
    const policy = laneMap[assignment.lane];
    if (!policy || !policy.enabled) {
      return {
        ...assignment,
        configured: false,
        publicKey: null,
        source: 'missing' as const,
        usesSharedFallback: false
      };
    }
    return {
      ...assignment,
      publicKey: assignment.publicKey || policy.publicKey || null
    };
  });
}

async function getOperatorMembershipSnapshot(): Promise<OperatorMembershipSnapshot> {
  const state = await getVerifiedOperatorMembershipState();
  const operators = state.operators
    .map((entry) => ({
      operatorId: entry.record.operatorId,
      label: entry.record.label,
      endpoint: entry.record.endpoint,
      networkId: entry.record.networkId,
      verified: entry.verified,
      verificationError: entry.verificationError,
      record: normalizeOperatorMembershipRecordBody(entry.record, entry.record.operatorId)
    }))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId));
  return {
    generatedAt: nowIso(),
    policyPresent: state.present,
    policyPublicKey: state.policyPublicKey,
    summary: {
      totalOperators: operators.length,
      verifiedOperators: operators.filter((entry) => entry.verified).length,
      invalidOperators: operators.filter((entry) => !entry.verified).length,
      admittedRequestOperators: operators.filter((entry) => entry.record.sponsorLanes.some((lane) => lane.lane === 'request' && lane.enabled)).length,
      admittedOutputOperators: operators.filter((entry) => entry.record.sponsorLanes.some((lane) => lane.lane === 'output' && lane.enabled)).length,
      admittedRegistryOperators: operators.filter((entry) => entry.record.sponsorLanes.some((lane) => lane.lane === 'registry' && lane.enabled)).length,
      admittedCreditsOperators: operators.filter((entry) => entry.record.sponsorLanes.some((lane) => lane.lane === 'credits' && lane.enabled)).length
    },
    operators,
    note:
      'When present, the signed membership file is the admission and failover policy for operator registration and lane routing.'
  };
}

async function upsertOperatorRegistryRecord(
  id: string,
  build: (existing: OperatorRegistryRecord | null) => OperatorRegistryRecord
): Promise<OperatorRegistryRecord> {
  return await withCreditsOperatorCoordinationLock(async () => {
    const registry = await readOperatorRegistry();
    const existing = registry.operators.find((entry) => entry.id === id) || null;
    const next = build(existing);
    registry.operators = [next, ...registry.operators.filter((entry) => entry.id !== id)];
    registry.lastUpdatedAt = nowIso();
    await writeOperatorRegistry(registry);
    return next;
  });
}

async function getOperatorRegistryRecordById(id: string) {
  if (String(id || '').trim() === creditsOperatorId) {
    return await ensureLocalOperatorRegistryEntry();
  }
  const registry = await readOperatorRegistry();
  return registry.operators.find((entry) => entry.id === id) || null;
}

async function ensureLocalOperatorRegistryEntry() {
  const membershipState = await getVerifiedOperatorMembershipState();
  const membershipRecord = membershipState.verifiedById.get(creditsOperatorId)?.record || null;
  return await upsertOperatorRegistryRecord(creditsOperatorId, (existing) =>
    buildLocalOperatorRegistryRecord(existing, membershipRecord)
  );
}

async function heartbeatOperatorRegistryRecord(id: string) {
  return await upsertOperatorRegistryRecord(id, (existing) => {
    if (!existing) {
      throw new Error('Operator not found.');
    }
    return {
      ...existing,
      updatedAt: nowIso(),
      lastSeenAt: nowIso()
    };
  });
}

async function updateOperatorRegistryStatus(id: string, status: OperatorRegistryStatus) {
  return await upsertOperatorRegistryRecord(id, (existing) => {
    if (!existing) {
      throw new Error('Operator not found.');
    }
    return {
      ...existing,
      status,
      updatedAt: nowIso()
    };
  });
}

function summarizeOperatorRegistry(registry: OperatorRegistryFile) {
  const summary = {
    total: registry.operators.length,
    active: 0,
    paused: 0,
    draining: 0,
    localActive: false,
    requestLanes: 0,
    outputLanes: 0,
    registryLanes: 0,
    creditsLanes: 0
  };
  registry.operators.forEach((operator) => {
    summary[operator.status] += 1;
    if (operator.local && operator.status === 'active') {
      summary.localActive = true;
    }
    operator.sponsorLanes.forEach((lane) => {
      if (!lane.configured) return;
      if (lane.lane === 'request') summary.requestLanes += 1;
      if (lane.lane === 'output') summary.outputLanes += 1;
      if (lane.lane === 'registry') summary.registryLanes += 1;
      if (lane.lane === 'credits') summary.creditsLanes += 1;
    });
  });
  return summary;
}

export async function getOperatorRegistrySnapshot() {
  const registry = await readOperatorRegistry();
  return {
    registry,
    summary: summarizeOperatorRegistry(registry),
    localOperatorId: creditsOperatorId,
    localOperator: registry.operators.find((entry) => entry.id === creditsOperatorId) || null
  };
}

function normalizeSponsorLaneParam(value: unknown): SponsorLane | null {
  return value === 'request' || value === 'output' || value === 'registry' || value === 'credits' ? value : null;
}

function getOperatorLaneAssignment(record: OperatorRegistryRecord, lane: SponsorLane) {
  return record.sponsorLanes.find((entry) => entry.lane === lane) || null;
}

function operatorSupportsLane(record: OperatorRegistryRecord, lane: SponsorLane) {
  return Boolean(getOperatorLaneAssignment(record, lane)?.configured);
}

function buildUnknownOperatorFreshness(): OperatorRouteFreshness {
  return {
    status: 'unknown',
    source: 'missing',
    observedAt: null,
    ageMs: null,
    staleAfterMs: operatorRouteStaleMs
  };
}

function buildLocalOperatorFreshness(): OperatorRouteFreshness {
  return {
    status: 'local',
    source: 'local-process',
    observedAt: nowIso(),
    ageMs: 0,
    staleAfterMs: null
  };
}

function resolveOperatorFreshness(record: OperatorRegistryRecord): OperatorRouteFreshness {
  if (record.local && record.id === creditsOperatorId) {
    return buildLocalOperatorFreshness();
  }
  const observedAt = record.lastSeenAt || record.updatedAt || null;
  const observedMs = parseTimestampMs(observedAt);
  if (!observedAt || observedMs === null) {
    return buildUnknownOperatorFreshness();
  }
  const ageMs = Math.max(0, Date.now() - observedMs);
  return {
    status: ageMs <= operatorRouteStaleMs ? 'fresh' : 'stale',
    source: record.lastSeenAt ? 'last-seen' : 'updated-at',
    observedAt,
    ageMs,
    staleAfterMs: operatorRouteStaleMs
  };
}

function describeRoutePolicyAdmission(
  state: Awaited<ReturnType<typeof getVerifiedOperatorMembershipState>>,
  record: OperatorRegistryRecord,
  lane: SponsorLane
): OperatorRoutePolicyAdmission {
  if (!state.enforced) {
    return {
      admitted: true,
      reason: 'No signed membership policy is active.',
      lanePolicy: null
    };
  }
  const membership = state.verifiedById.get(record.id)?.record || null;
  if (!membership) {
    return {
      admitted: false,
      reason: 'Operator is not admitted by the signed membership policy.',
      lanePolicy: null
    };
  }
  const lanePolicy = buildMembershipLaneMap(membership.sponsorLanes)[lane];
  if (!lanePolicy || !lanePolicy.enabled) {
    return {
      admitted: false,
      reason: `Membership policy does not admit ${record.id} for the ${lane} lane.`,
      lanePolicy
    };
  }
  return {
    admitted: true,
    reason: `Admitted by signed membership policy as ${lanePolicy.role} priority ${lanePolicy.priority}.`,
    lanePolicy
  };
}

function describeRouteCandidateEligibility(
  record: OperatorRegistryRecord,
  freshness: OperatorRouteFreshness,
  policyAdmission: OperatorRoutePolicyAdmission,
  options: { endpointRequired: boolean; selected?: boolean }
) {
  if (options.selected) {
    return {
      eligible: true,
      reason: record.local
        ? 'Selected because the coordinator owns this lane locally and the local operator is active.'
        : 'Selected because this is the freshest active remote operator advertising the lane.'
    };
  }
  if (!policyAdmission.admitted) {
    return {
      eligible: false,
      reason: policyAdmission.reason
    };
  }
  if (record.status !== 'active') {
    return {
      eligible: false,
      reason: `Operator status is ${record.status}, so it is excluded from routing.`
    };
  }
  if (options.endpointRequired && (!record.endpoint || !record.endpoint.trim())) {
    return {
      eligible: false,
      reason: 'Remote operator is missing a public endpoint.'
    };
  }
  if (freshness.status === 'stale') {
    return {
      eligible: false,
      reason: `Remote operator heartbeat is stale (${freshness.ageMs ?? 'unknown'}ms old).`
    };
  }
  if (freshness.status === 'unknown') {
    return {
      eligible: false,
      reason: 'Operator freshness is unknown because no usable heartbeat timestamp is available.'
    };
  }
  return {
    eligible: true,
    reason: record.local
      ? 'Local operator is active and owns this lane.'
      : 'Remote operator is active, fresh, and exposes an endpoint.'
  };
}

function toOperatorLaneRouteCandidate(
  record: OperatorRegistryRecord,
  lane: SponsorLane,
  freshness: OperatorRouteFreshness,
  policyAdmission: OperatorRoutePolicyAdmission,
  options: { endpointRequired: boolean; selected?: boolean }
): OperatorLaneRouteCandidate {
  const assignment = getOperatorLaneAssignment(record, lane);
  const eligibility = describeRouteCandidateEligibility(record, freshness, policyAdmission, options);
  return {
    id: record.id,
    label: record.label,
    endpoint: record.endpoint,
    status: record.status,
    local: record.local,
    publicKey: assignment?.publicKey || null,
    updatedAt: record.updatedAt,
    lastSeenAt: record.lastSeenAt,
    freshness,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason
  };
}

function compareOperatorRouteCandidates(a: OperatorRegistryRecord, b: OperatorRegistryRecord) {
  if (a.local !== b.local) return a.local ? -1 : 1;
  const aSeen = parseTimestampMs(a.lastSeenAt) ?? parseTimestampMs(a.updatedAt) ?? 0;
  const bSeen = parseTimestampMs(b.lastSeenAt) ?? parseTimestampMs(b.updatedAt) ?? 0;
  return bSeen - aSeen;
}

function compareRemoteRouteCandidates(
  a: {
    record: OperatorRegistryRecord;
    freshness: OperatorRouteFreshness;
    policyAdmission: OperatorRoutePolicyAdmission;
  },
  b: {
    record: OperatorRegistryRecord;
    freshness: OperatorRouteFreshness;
    policyAdmission: OperatorRoutePolicyAdmission;
  }
) {
  const aPolicy = a.policyAdmission.lanePolicy;
  const bPolicy = b.policyAdmission.lanePolicy;
  const aPriority = aPolicy?.priority ?? -1;
  const bPriority = bPolicy?.priority ?? -1;
  if (aPriority !== bPriority) return bPriority - aPriority;
  const aRoleWeight = aPolicy ? operatorMembershipRoleWeight(normalizeOperatorMembershipRole(aPolicy.role)) : 0;
  const bRoleWeight = bPolicy ? operatorMembershipRoleWeight(normalizeOperatorMembershipRole(bPolicy.role)) : 0;
  if (aRoleWeight !== bRoleWeight) return bRoleWeight - aRoleWeight;
  return compareOperatorRouteCandidates(a.record, b.record);
}

function compareEligibleRouteCandidates(
  a: {
    record: OperatorRegistryRecord;
    freshness: OperatorRouteFreshness;
    policyAdmission: OperatorRoutePolicyAdmission;
  },
  b: {
    record: OperatorRegistryRecord;
    freshness: OperatorRouteFreshness;
    policyAdmission: OperatorRoutePolicyAdmission;
  }
) {
  const aPolicy = a.policyAdmission.lanePolicy;
  const bPolicy = b.policyAdmission.lanePolicy;
  const aPriority = aPolicy?.priority ?? -1;
  const bPriority = bPolicy?.priority ?? -1;
  if (aPriority !== bPriority) return bPriority - aPriority;
  const aRoleWeight = aPolicy ? operatorMembershipRoleWeight(normalizeOperatorMembershipRole(aPolicy.role)) : 0;
  const bRoleWeight = bPolicy ? operatorMembershipRoleWeight(normalizeOperatorMembershipRole(bPolicy.role)) : 0;
  if (aRoleWeight !== bRoleWeight) return bRoleWeight - aRoleWeight;
  if (a.record.local !== b.record.local) return a.record.local ? -1 : 1;
  return compareOperatorRouteCandidates(a.record, b.record);
}

async function resolveOperatorLaneRoute(lane: SponsorLane): Promise<OperatorLaneRoute> {
  const localOperator = (await getOperatorRegistryRecordById(creditsOperatorId)) || (await ensureLocalOperatorRegistryEntry());
  const localLaneStatus = listSponsorLaneStatuses().find((entry) => entry.lane === lane) || null;
  const membershipState = await getVerifiedOperatorMembershipState();
  const registry = await readOperatorRegistry();
  const localFreshness = resolveOperatorFreshness(localOperator);
  const localPolicyAdmission = describeRoutePolicyAdmission(membershipState, localOperator, lane);
  const localCandidate = localLaneStatus?.privateKeyConfigured
    ? toOperatorLaneRouteCandidate(localOperator, lane, localFreshness, localPolicyAdmission, { endpointRequired: false })
    : null;
  const remoteCandidates = registry.operators
    .filter((entry) => !entry.local && operatorSupportsLane(entry, lane))
    .map((entry) => ({
      record: entry,
      freshness: resolveOperatorFreshness(entry),
      policyAdmission: describeRoutePolicyAdmission(membershipState, entry, lane)
    }))
    .sort(compareRemoteRouteCandidates);
  const localEligible = Boolean(localCandidate?.eligible && localOperator.status === 'active' && localPolicyAdmission.admitted);
  const eligibleRemote = remoteCandidates.filter(
    (entry) =>
      entry.policyAdmission.admitted &&
      entry.record.status === 'active' &&
      typeof entry.record.endpoint === 'string' &&
      entry.record.endpoint.trim().length > 0 &&
      entry.freshness.status === 'fresh'
  );
  const membershipSelected =
    operatorRouteStrategy === 'membership-first'
      ? [
          ...(localEligible
            ? [
                {
                  record: localOperator,
                  freshness: localFreshness,
                  policyAdmission: localPolicyAdmission
                }
              ]
            : []),
          ...eligibleRemote
        ].sort(compareEligibleRouteCandidates)[0] || null
      : null;
  const localSelected =
    operatorRouteStrategy === 'membership-first'
      ? Boolean(membershipSelected?.record.local)
      : localEligible;
  const selectedRemote =
    operatorRouteStrategy === 'membership-first'
      ? membershipSelected && !membershipSelected.record.local
        ? membershipSelected
        : null
      : eligibleRemote[0] || null;
  const candidates = [
    ...(localCandidate
      ? [
          toOperatorLaneRouteCandidate(localOperator, lane, localFreshness, localPolicyAdmission, {
            endpointRequired: false,
            selected: localSelected
          })
        ]
      : []),
    ...remoteCandidates.map((entry) =>
      toOperatorLaneRouteCandidate(entry.record, lane, entry.freshness, entry.policyAdmission, {
        endpointRequired: true,
        selected: !localSelected && selectedRemote?.record.id === entry.record.id
      })
    )
  ];

  if (localSelected && localLaneStatus?.publicKey) {
    return {
      lane,
      via: 'local',
      operatorId: localOperator.id,
      operatorLabel: localOperator.label,
      operatorEndpoint: creditsOperatorEndpoint || localOperator.endpoint || null,
      operatorStatus: localOperator.status,
      publicKey: localLaneStatus.publicKey,
      localConfigured: true,
      freshness: localFreshness,
      selection: {
        mode: 'local-preferred',
        reason:
          operatorRouteStrategy === 'membership-first'
            ? 'Membership policy currently ranks the local operator highest for this lane, so execution stays on-box.'
            : 'The coordinator owns this lane locally, so routing stays on-box for the fastest path.'
      },
      candidates
    };
  }

  if (selectedRemote) {
    const assignment = getOperatorLaneAssignment(selectedRemote.record, lane);
    return {
      lane,
      via: 'remote',
      operatorId: selectedRemote.record.id,
      operatorLabel: selectedRemote.record.label,
      operatorEndpoint: selectedRemote.record.endpoint,
      operatorStatus: selectedRemote.record.status,
      publicKey: assignment?.publicKey || null,
      localConfigured: false,
      freshness: selectedRemote.freshness,
      selection: {
        mode: 'fresh-remote',
        reason:
          operatorRouteStrategy === 'membership-first'
            ? `Membership policy ranks ${selectedRemote.record.label} ahead of the local coordinator for ${lane}, so the admitted remote owner is selected.`
            : localCandidate
              ? `The local lane exists but is not eligible (${localCandidate.eligibilityReason.toLowerCase()}). The freshest active remote owner is selected instead.`
              : 'No local lane key is configured, so the freshest active remote owner is selected.'
      },
      candidates
    };
  }

  const unavailableReason =
    candidates.length === 0
      ? 'No operator currently advertises this lane.'
      : candidates.some((entry) => entry.status === 'active' && !entry.eligible)
        ? 'Operators advertise this lane, but none currently satisfy the active endpoint + fresh-heartbeat policy.'
        : 'No operator currently satisfies the routing policy for this lane.';

  return {
    lane,
    via: 'unavailable',
    operatorId: null,
    operatorLabel: null,
    operatorEndpoint: null,
    operatorStatus: null,
    publicKey: null,
    localConfigured: false,
    freshness: buildUnknownOperatorFreshness(),
    selection: {
      mode: 'unavailable',
      reason: unavailableReason
    },
    candidates
  };
}

async function getOperatorRoutingSnapshot() {
  const routes = await Promise.all(
    (['request', 'output', 'registry', 'credits'] as SponsorLane[]).map((lane) => resolveOperatorLaneRoute(lane))
  );
  return {
    generatedAt: nowIso(),
    policy: buildOperatorRoutingPolicySnapshot(),
    localOperatorId: creditsOperatorId,
    routes: Object.fromEntries(routes.map((route) => [route.lane, route])) as Record<SponsorLane, OperatorLaneRoute>,
    note:
      'The coordinator remains the canonical state authority. Remote routes are used only when the owning sponsor lane lives on another operator.'
  };
}

function toOperatorHealthRecord(record: OperatorRegistryRecord): OperatorHealthRecord {
  return {
    id: record.id,
    label: record.label,
    endpoint: record.endpoint,
    status: record.status,
    local: record.local,
    networkId: record.networkId,
    contractVersions: record.contractVersions,
    capabilities: record.capabilities,
    sponsorLanes: record.sponsorLanes,
    freshness: resolveOperatorFreshness(record),
    metadata: record.metadata,
    registeredAt: record.registeredAt,
    updatedAt: record.updatedAt,
    lastSeenAt: record.lastSeenAt
  };
}

async function getOperatorHealthSnapshot(): Promise<OperatorHealthSnapshot> {
  const registry = await readOperatorRegistry();
  const operators = registry.operators.map((entry) => toOperatorHealthRecord(entry)).sort(compareOperatorRouteCandidates);
  const routing = await getOperatorRoutingSnapshot();
  const routes = Object.values(routing.routes);
  return {
    generatedAt: nowIso(),
    policy: buildOperatorRoutingPolicySnapshot(),
    summary: {
      totalOperators: operators.length,
      activeOperators: operators.filter((entry) => entry.status === 'active').length,
      pausedOperators: operators.filter((entry) => entry.status === 'paused').length,
      drainingOperators: operators.filter((entry) => entry.status === 'draining').length,
      freshOperators: operators.filter((entry) => entry.freshness.status === 'fresh' || entry.freshness.status === 'local').length,
      staleOperators: operators.filter((entry) => entry.freshness.status === 'stale').length,
      unknownOperators: operators.filter((entry) => entry.freshness.status === 'unknown').length,
      localOperators: operators.filter((entry) => entry.local).length,
      totalRoutes: routes.length,
      availableRoutes: routes.filter((entry) => entry.via !== 'unavailable').length,
      unavailableRoutes: routes.filter((entry) => entry.via === 'unavailable').length,
      localRoutes: routes.filter((entry) => entry.via === 'local').length,
      remoteRoutes: routes.filter((entry) => entry.via === 'remote').length
    },
    operators,
    routing
  };
}

function pushOperatorIsolationIssue(
  issues: OperatorIsolationAuditIssue[],
  severity: OperatorIsolationAuditIssue['severity'],
  code: string,
  lane: SponsorLane | null,
  operatorId: string | null,
  message: string,
  details: Record<string, unknown> | null = null
) {
  issues.push({
    severity,
    code,
    lane,
    operatorId,
    message,
    details
  });
}

async function getOperatorIsolationAuditSnapshot(): Promise<OperatorIsolationAuditSnapshot> {
  const [routing, registry, membershipState] = await Promise.all([
    getOperatorRoutingSnapshot(),
    readOperatorRegistry(),
    getVerifiedOperatorMembershipState()
  ]);
  const sponsorLanes = listSponsorLaneStatuses();
  const issues: OperatorIsolationAuditIssue[] = [];
  const localOperator = registry.operators.find((entry) => entry.id === creditsOperatorId) || (await ensureLocalOperatorRegistryEntry());

  sponsorLanes
    .filter((entry) => entry.usesSharedFallback)
    .forEach((entry) => {
      pushOperatorIsolationIssue(
        issues,
        'warn',
        'shared-fallback-lane',
        entry.lane,
        creditsOperatorId,
        `Lane ${entry.lane} still resolves through the shared sponsor fallback instead of a lane-specific key.`,
        {
          source: entry.source,
          publicKey: entry.publicKey
        }
      );
    });

  const laneKeyOwners = new Map<string, { lane: SponsorLane; publicKey: string; owners: string[] }>();
  const registerLaneKey = (lane: SponsorLane, publicKey: string | null, operatorId: string) => {
    if (!publicKey) return;
    const composite = `${lane}:${publicKey}`;
    const current = laneKeyOwners.get(composite) || { lane, publicKey, owners: [] as string[] };
    if (!current.owners.includes(operatorId)) {
      current.owners.push(operatorId);
    }
    laneKeyOwners.set(composite, current);
  };

  sponsorLanes.forEach((entry) => registerLaneKey(entry.lane, entry.publicKey, creditsOperatorId));
  registry.operators
    .filter((entry) => !entry.local)
    .forEach((entry) =>
      entry.sponsorLanes.forEach((assignment) => registerLaneKey(assignment.lane, assignment.publicKey, entry.id))
    );

  laneKeyOwners.forEach((entry) => {
    if (entry.owners.length <= 1) return;
    pushOperatorIsolationIssue(
      issues,
      'warn',
      'duplicate-lane-key',
      entry.lane,
      null,
      `Lane ${entry.lane} public key ${entry.publicKey} is still present on multiple operators.`,
      {
        owners: entry.owners
      }
    );
  });

  for (const lane of ['request', 'output', 'registry', 'credits'] as SponsorLane[]) {
    const route = routing.routes[lane];
    const localLaneStatus = sponsorLanes.find((entry) => entry.lane === lane) || null;
    const localPolicyAdmission = describeRoutePolicyAdmission(membershipState, localOperator, lane);
    const allCandidates = [
      ...(localLaneStatus?.privateKeyConfigured
        ? [
            {
              record: localOperator,
              freshness: resolveOperatorFreshness(localOperator),
              policyAdmission: localPolicyAdmission
            }
          ]
        : []),
      ...registry.operators
        .filter((entry) => !entry.local && operatorSupportsLane(entry, lane))
        .map((entry) => ({
          record: entry,
          freshness: resolveOperatorFreshness(entry),
          policyAdmission: describeRoutePolicyAdmission(membershipState, entry, lane)
        }))
    ];
    const admitted = allCandidates.filter((entry) => entry.policyAdmission.admitted);
    const eligiblePreferred =
      admitted
        .filter(
          (entry) =>
            entry.record.status === 'active' &&
            (entry.record.local ||
              (typeof entry.record.endpoint === 'string' &&
                entry.record.endpoint.trim().length > 0 &&
                entry.freshness.status === 'fresh'))
        )
        .sort(compareEligibleRouteCandidates)[0] || null;

    if (route.via === 'unavailable' && admitted.length > 0) {
      pushOperatorIsolationIssue(
        issues,
        'error',
        'unavailable-admitted-lane',
        lane,
        null,
        `Lane ${lane} has admitted operators in policy, but none satisfy the live routing requirements right now.`,
        {
          admittedOperators: admitted.map((entry) => entry.record.id)
        }
      );
    }

    if (eligiblePreferred && route.operatorId && eligiblePreferred.record.id !== route.operatorId) {
      pushOperatorIsolationIssue(
        issues,
        operatorRouteStrategy === 'membership-first' ? 'error' : 'info',
        'route-policy-mismatch',
        lane,
        route.operatorId,
        `Lane ${lane} is routed to ${route.operatorId}, but policy-preferred eligible owner is ${eligiblePreferred.record.id}.`,
        {
          routeOperatorId: route.operatorId,
          preferredOperatorId: eligiblePreferred.record.id,
          routeStrategy: operatorRouteStrategy
        }
      );
    }

    if (route.via === 'remote' && localLaneStatus?.privateKeyConfigured) {
      pushOperatorIsolationIssue(
        issues,
        'warn',
        'local-hot-standby-configured',
        lane,
        creditsOperatorId,
        `Lane ${lane} currently routes remotely, but the coordinator still holds a local lane key.`,
        {
          localPublicKey: localLaneStatus.publicKey,
          remoteOperatorId: route.operatorId
        }
      );
    }
  }

  const summary = {
    issueCount: issues.length,
    infoCount: issues.filter((entry) => entry.severity === 'info').length,
    warnCount: issues.filter((entry) => entry.severity === 'warn').length,
    errorCount: issues.filter((entry) => entry.severity === 'error').length,
    sharedFallbackLanes: issues.filter((entry) => entry.code === 'shared-fallback-lane').length,
    duplicatedLaneKeys: issues.filter((entry) => entry.code === 'duplicate-lane-key').length,
    unavailableAdmittedLanes: issues.filter((entry) => entry.code === 'unavailable-admitted-lane').length,
    routeMismatches: issues.filter((entry) => entry.code === 'route-policy-mismatch').length
  };

  return {
    generatedAt: nowIso(),
    localOperatorId: creditsOperatorId,
    policy: buildOperatorRoutingPolicySnapshot(),
    sponsorLanes,
    summary,
    routes: routing.routes,
    issues,
    note:
      'This audit focuses on lane-key custody, policy-vs-route alignment, and whether local fallback keys still weaken operator isolation.'
  };
}

async function postJsonToRemoteOperator<T>(route: OperatorLaneRoute, endpointPath: string, body: unknown): Promise<T> {
  if (route.via !== 'remote' || !route.operatorEndpoint) {
    throw new Error(`Lane ${route.lane} is not routed to a remote operator.`);
  }
  const response = await fetch(`${route.operatorEndpoint.replace(/\/+$/, '')}${endpointPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zeko-ai-route-direct': '1',
      'x-opengradient-route-direct': '1',
      ...buildOutboundAuthHeaders()
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text().catch(() => '');
  let parsed: Record<string, unknown> | null = null;
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const message =
      typeof parsed?.error === 'string' && parsed.error.trim().length > 0
        ? parsed.error.trim()
        : raw.trim() || `Remote operator request failed (${response.status}).`;
    throw new Error(message);
  }
  return (parsed || ({} as Record<string, unknown>)) as T;
}

async function submitAgentRegistrationViaRegistryLane(
  payload: AgentRegistrationRecord['zeko']['registrationPayload']
): Promise<RoutedSponsorSubmission> {
  const route = await resolveOperatorLaneRoute('registry');
  if (route.via === 'local') {
    const submission = await submitAgentRegistrationTxWithSponsor(payload);
    return {
      hash: submission.hash,
      proxied: false,
      route
    };
  }
  if (route.via === 'remote') {
    const remote = await postJsonToRemoteOperator<{ hash?: string | null }>(
      route,
      '/api/operators/internal/registry/v1/submit',
      { payload }
    );
    return {
      hash: typeof remote.hash === 'string' || remote.hash === null ? (remote.hash ?? null) : null,
      proxied: true,
      route
    };
  }
  throw new Error('No active operator owns the registry lane.');
}

async function submitAgentRegistrationViaRegistryLaneV2(
  payload: ZekoThresholdAgentRegistrationPayload
): Promise<RoutedSponsorSubmission> {
  const route = await resolveOperatorLaneRoute('registry');
  if (route.via === 'local') {
    const submission = await submitAgentRegistrationTxWithSponsorV2(payload);
    return {
      hash: submission.hash,
      proxied: false,
      route
    };
  }
  if (route.via === 'remote') {
    const remote = await postJsonToRemoteOperator<{ hash?: string | null }>(
      route,
      '/api/operators/internal/registry/v2/submit',
      { payload }
    );
    return {
      hash: typeof remote.hash === 'string' || remote.hash === null ? (remote.hash ?? null) : null,
      proxied: true,
      route
    };
  }
  throw new Error('No active operator owns the registry lane.');
}

async function submitCreditsViaCreditsLane(payload: ZekoCreditsPayload): Promise<RoutedSponsorSubmission> {
  const route = await resolveOperatorLaneRoute('credits');
  const normalizedPayload = {
    ...payload,
    spendTo: payload.spendTo || undefined,
    platformPayee: payload.platformPayee || undefined
  };
  if (route.via === 'local') {
    const submission = await submitCreditsTxWithSponsor(normalizedPayload);
    return {
      hash: submission.hash,
      proxied: false,
      route
    };
  }
  if (route.via === 'remote') {
    const remote = await postJsonToRemoteOperator<{ hash?: string | null }>(
      route,
      '/api/operators/internal/credits/v1/submit',
      { payload: normalizedPayload }
    );
    return {
      hash: typeof remote.hash === 'string' || remote.hash === null ? (remote.hash ?? null) : null,
      proxied: true,
      route
    };
  }
  throw new Error('No active operator owns the credits lane.');
}

async function submitCreditsViaCreditsLaneV2(payload: ZekoThresholdCreditsPayload): Promise<RoutedSponsorSubmission> {
  const route = await resolveOperatorLaneRoute('credits');
  if (route.via === 'local') {
    const submission = await submitCreditsTxWithSponsorV2(payload);
    return {
      hash: submission.hash,
      proxied: false,
      route
    };
  }
  if (route.via === 'remote') {
    const remote = await postJsonToRemoteOperator<{ hash?: string | null }>(
      route,
      '/api/operators/internal/credits/v2/submit',
      { payload }
    );
    return {
      hash: typeof remote.hash === 'string' || remote.hash === null ? (remote.hash ?? null) : null,
      proxied: true,
      route
    };
  }
  throw new Error('No active operator owns the credits lane.');
}

async function syncLocalOperatorToCoordinator() {
  if (!coordinatorEndpoint) return null;
  const localOperator = (await getOperatorRegistryRecordById(creditsOperatorId)) || (await ensureLocalOperatorRegistryEntry());
  const response = await fetch(`${coordinatorEndpoint.replace(/\/+$/, '')}/api/operators/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildOutboundAuthHeaders()
    },
    body: JSON.stringify({
      id: localOperator.id,
      label: localOperator.label,
      endpoint: localOperator.endpoint,
      status: localOperator.status,
      local: false,
      networkId: localOperator.networkId,
      contractVersions: localOperator.contractVersions,
      capabilities: localOperator.capabilities,
      sponsorLanes: localOperator.sponsorLanes,
      metadata: {
        ...(localOperator.metadata || {}),
        syncedFromEndpoint: localOperator.endpoint,
        syncedAt: nowIso()
      }
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`operator coordinator sync failed (${response.status}): ${body}`);
  }
  return await response.json();
}

function ensureCoordinatorSyncWorker() {
  if (coordinatorSyncWorkerStarted || !coordinatorEndpoint) return;
  coordinatorSyncWorkerStarted = true;
  void syncLocalOperatorToCoordinator().catch(() => undefined);
  const timer = setInterval(() => {
    void syncLocalOperatorToCoordinator().catch(() => undefined);
  }, coordinatorSyncMs);
  (timer as any).unref?.();
}

function normalizeOperatorLaneAssignment(input: unknown): OperatorLaneAssignment | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  const lane = body.lane;
  if (lane !== 'request' && lane !== 'output' && lane !== 'registry' && lane !== 'credits') {
    return null;
  }
  const publicKey = typeof body.publicKey === 'string' && body.publicKey.trim().length > 0 ? body.publicKey.trim() : null;
  return {
    lane,
    configured: body.configured !== false,
    publicKey,
    source:
      body.source === 'env-lane' ||
      body.source === 'env-shared' ||
      body.source === 'stored-lane' ||
      body.source === 'stored-shared'
        ? body.source
        : publicKey
          ? 'stored-shared'
          : 'missing',
    usesSharedFallback: body.usesSharedFallback === true
  };
}

function mergeOperatorRegistryMetadata(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
) {
  if (existing && incoming) {
    return {
      ...existing,
      ...incoming
    };
  }
  return incoming ?? existing ?? null;
}

async function registerOperatorRegistryRecord(params: {
  id?: string;
  label?: string | null;
  endpoint?: string | null;
  status?: OperatorRegistryStatus;
  local?: boolean;
  networkId?: string | null;
  contractVersions?: Array<'v1' | 'v2'>;
  capabilities?: string[];
  sponsorLanes?: OperatorLaneAssignment[];
  metadata?: Record<string, unknown> | null;
}) {
  const membershipState = await getVerifiedOperatorMembershipState();
  const isLocal = params.local === true || !params.id || params.id === creditsOperatorId;
  if (isLocal) {
    const membershipRecord = membershipState.verifiedById.get(creditsOperatorId)?.record || null;
    return await upsertOperatorRegistryRecord(creditsOperatorId, (existing) => {
      const base = buildLocalOperatorRegistryRecord(existing, membershipRecord);
      return {
        ...base,
        label: membershipRecord?.label || params.label?.trim() || base.label,
        endpoint:
          membershipRecord?.endpoint ||
          (typeof params.endpoint === 'string' && params.endpoint.trim().length > 0 ? params.endpoint.trim() : base.endpoint),
        status: params.status || base.status,
        metadata: mergeOperatorRegistryMetadata(base.metadata, params.metadata),
        updatedAt: nowIso(),
        lastSeenAt: nowIso()
      };
    });
  }

  const id = String(params.id || '').trim();
  if (!id) throw new Error('Operator id is required.');
  const membershipRecord = membershipState.verifiedById.get(id)?.record || null;
  if (membershipState.enforced && !membershipRecord) {
    throw new Error('Operator is not admitted by the current membership policy.');
  }
  if (membershipRecord?.endpoint && params.endpoint?.trim() && membershipRecord.endpoint !== params.endpoint.trim()) {
    throw new Error('Operator endpoint does not match the current membership policy.');
  }
  const requestedStatus = params.status || 'active';
  if (membershipRecord && !membershipRecord.allowedStatuses.includes(requestedStatus)) {
    throw new Error(`Operator status ${requestedStatus} is not allowed by the current membership policy.`);
  }
  const sponsorLanes = membershipRecord
    ? buildOperatorLaneAssignmentsFromMembership(membershipRecord).filter((entry) => entry.configured || entry.publicKey)
    : (params.sponsorLanes || []).filter((entry) => entry.configured || entry.publicKey);
  return await upsertOperatorRegistryRecord(id, (existing) => ({
    id,
    label: membershipRecord?.label || params.label?.trim() || existing?.label || id,
    endpoint:
      membershipRecord?.endpoint ||
      (typeof params.endpoint === 'string' && params.endpoint.trim().length > 0 ? params.endpoint.trim() : null),
    status:
      (membershipRecord ? requestedStatus : params.status) || normalizeOperatorRegistryStatus(existing?.status, 'active'),
    local: false,
    networkId: membershipRecord?.networkId || params.networkId?.trim() || existing?.networkId || zekoNetwork.networkId,
    contractVersions:
      membershipRecord?.contractVersions?.length
        ? membershipRecord.contractVersions
        : params.contractVersions && params.contractVersions.length
        ? params.contractVersions
        : existing?.contractVersions || ['v2'],
    capabilities:
      membershipRecord?.capabilities?.length
        ? membershipRecord.capabilities
        : params.capabilities && params.capabilities.length
        ? Array.from(new Set(params.capabilities.map((entry) => entry.trim()).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b)
          )
        : existing?.capabilities || buildOperatorCapabilities(sponsorLanes),
    sponsorLanes: sponsorLanes.length ? sponsorLanes : existing?.sponsorLanes || [],
    metadata: mergeOperatorRegistryMetadata(
      existing?.metadata,
      mergeOperatorRegistryMetadata(params.metadata, membershipRecord ? { membershipPolicy: { enforced: true } } : null)
    ),
    registeredAt: existing?.registeredAt || nowIso(),
    updatedAt: nowIso(),
    lastSeenAt: nowIso()
  }));
}

async function markCreditsOperatorQueueProcessed(lastError: string | null) {
  await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    queue.lastProcessedAt = nowIso();
    queue.lastError = lastError;
    await writeCreditsOperatorQueue(queue);
  });
}

async function markCreditsDepositMonitorsProcessed(lastError: string | null) {
  const monitors = await readCreditsDepositMonitors();
  monitors.lastProcessedAt = new Date().toISOString();
  monitors.lastError = lastError;
  await writeCreditsDepositMonitors(monitors);
}

async function markCreditsCheckpointBatchesProcessed(lastError: string | null) {
  await withCreditsOperatorCoordinationLock(async () => {
    const batches = await readCreditsCheckpointBatches();
    batches.lastProcessedAt = nowIso();
    batches.lastError = lastError;
    await writeCreditsCheckpointBatches(batches);
  });
}

function buildCoordinationTree(leaves: Record<string, string>): MerkleTree {
  return buildTree(leaves);
}

function computeAgentLeaf(agentIdHash: Field, ownerHash: Field, treasuryHash: Field, stakeAmount: Field) {
  return Poseidon.hash([agentIdHash, ownerHash, treasuryHash, stakeAmount]);
}

function computeCreditsLeaf(ownerHash: Field, amount: Field, direction: Field) {
  return Poseidon.hash([ownerHash, amount, direction]);
}

function computeNullifierLeaf(ownerHash: Field, nonceHash: Field) {
  return Poseidon.hash([ownerHash, nonceHash]);
}

function createCoordinationLiveStage(
  kind: 'agent-registration' | 'credits-update',
  stateIndex: number,
  targetRoot: string
): CoordinationLiveStageRecord {
  return {
    kind,
    stateIndex,
    targetRoot,
    txHash: null,
    submittedAt: null,
    settled: false,
    settledAt: null,
    observedRoot: null,
    explorerUrl: null,
    note: null,
    lastError: null
  };
}

function signAgentRegistration(
  oracleKey: PrivateKey,
  agentIdHash: Field,
  ownerHash: Field,
  treasuryHash: Field,
  stakeAmount: Field,
  root: Field
) {
  return Signature.create(oracleKey, [agentIdHash, ownerHash, treasuryHash, stakeAmount, root]).toJSON();
}

function signCreditsUpdate(
  oracleKey: PrivateKey,
  creditsRoot: Field,
  nullifierRoot: Field,
  amount: Field = Field(0),
  platformAmount: Field = Field(0)
) {
  return Signature.create(oracleKey, [creditsRoot, nullifierRoot, amount, platformAmount]).toJSON();
}

function buildPendingDepositKey(ownerPublicKey: string, creditsRoot: string) {
  return `${ownerPublicKey}:${creditsRoot}`;
}

function buildCreditsNullifierKey(ownerHash: string, nonceHash: string) {
  return `${ownerHash}:${nonceHash}`;
}

function inferCreditsOperatorKind(payload: ZekoThresholdCreditsPayload): CreditsOperatorItemKind {
  return payload.spendTo && (payload.spendAmountMina || 0) > 0 ? 'credits-spend' : 'credits-update';
}

function buildCreditsOperatorIdempotencyKey(
  payload: ZekoThresholdCreditsPayload,
  source: CreditsOperatorQueueItem['source'],
  requestId?: string | null
) {
  return sha256Hex(
    stableStringify({
      contractVersion: 'v2',
      source,
      requestId: requestId || null,
      payload
    })
  );
}

function summarizeCreditsOperatorQueue(queue: CreditsOperatorQueueFile) {
  const summary = {
    queued: 0,
    processing: 0,
    submitted: 0,
    settled: 0,
    failed: 0,
    superseded: 0
  };
  queue.items.forEach((item) => {
    summary[item.status] += 1;
  });
  return summary;
}

function summarizeCreditsDepositMonitors(monitors: CreditsDepositMonitorFile) {
  const summary = {
    queued: 0,
    monitoring: 0,
    confirmed: 0,
    failed: 0
  };
  monitors.items.forEach((item) => {
    summary[item.status] += 1;
  });
  return summary;
}

function summarizeCreditsCheckpointBatches(batchFile: CreditsCheckpointBatchFile) {
  const summary = {
    submitted: 0,
    settled: 0,
    failed: 0
  };
  batchFile.batches.forEach((batch) => {
    summary[batch.status] += 1;
  });
  return summary;
}

function buildCreditsDepositMonitorIdempotencyKey(ownerPublicKey: string, creditsRoot: string, txHash: string) {
  return sha256Hex(
    stableStringify({
      contractVersion: 'v2',
      ownerPublicKey,
      creditsRoot,
      txHash
    })
  );
}

function getCreditsStateFromTrees(trees: CoordinationTreeState): CreditsStateRecord {
  return {
    currentCreditsRoot: buildCoordinationTree(trees.creditsLeaves).getRoot().toJSON(),
    currentNullifierRoot: buildCoordinationTree(trees.nullifierLeaves).getRoot().toJSON()
  };
}

function buildTree(leaves: Record<string, string>): MerkleTree {
  const tree = new MerkleTree(treeHeight);
  Object.entries(leaves).forEach(([index, leaf]) => {
    tree.setLeaf(BigInt(index), Field.fromJSON(leaf));
  });
  return tree;
}

function commitLeafToTree(
  treeState: CoordinationTreeState,
  branch: 'agentLeaves' | 'creditsLeaves' | 'nullifierLeaves',
  nextIndexKey: 'nextAgentIndex' | 'nextCreditsIndex' | 'nextNullifierIndex',
  leaf: Field
) {
  const tree = buildCoordinationTree(treeState[branch]);
  const index = treeState[nextIndexKey];
  tree.setLeaf(BigInt(index), leaf);
  const root = tree.getRoot();
  treeState[branch][String(index)] = leaf.toJSON();
  treeState[nextIndexKey] += 1;
  return {
    index,
    leaf: leaf.toJSON(),
    root: root.toJSON()
  };
}

async function getOraclePrivateKey(): Promise<PrivateKey> {
  const envKey = process.env.OPENGRADIENT_ORACLE_PRIVATE_KEY?.trim();
  if (envKey) return PrivateKey.fromBase58(envKey);
  try {
    const stored = await fs.readFile(oracleKeyPath, 'utf8');
    return PrivateKey.fromBase58(stored.trim());
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    const generated = PrivateKey.random();
    await fs.writeFile(oracleKeyPath, `${generated.toBase58()}\n`, 'utf8');
    return generated;
  }
}

async function hasSponsorSubmissionCapability(lane: SponsorLane | null = null) {
  const localOperator = (await getOperatorRegistryRecordById(creditsOperatorId)) || (await ensureLocalOperatorRegistryEntry());
  if (localOperator.status !== 'active') return false;
  if (lane) {
    return localOperator.sponsorLanes.some((entry) => entry.lane === lane && entry.configured);
  }
  return localOperator.sponsorLanes.some((entry) => entry.configured);
}

async function getDefaultPlatformPayeePublicKey() {
  const creditsSponsorPublicKey = resolveSponsorPublicKeyForLane('credits');
  if (creditsSponsorPublicKey) return creditsSponsorPublicKey;
  return getZekoRuntimeConfigV2().zkappPublicKey || getZekoRuntimeConfig().zkappPublicKey || null;
}

async function getAttesterKeyFile(): Promise<AttesterKeyFile> {
  const envSingle = process.env.OPENGRADIENT_ATTESTER_PRIVATE_KEYS?.trim();
  if (envSingle) {
    const attesters = envSingle
      .split(',')
      .map((entry, index) => ({ id: `attester-${index + 1}`, privateKey: entry.trim() }))
      .filter((entry) => entry.privateKey.length > 0);
    return {
      version: 1,
      quorum: Math.min(attesterQuorum, attesters.length || attesterQuorum),
      attesters
    };
  }

  try {
    return await readJson<AttesterKeyFile>(attesterKeysPath, {
      version: 1,
      quorum: attesterQuorum,
      attesters: []
    });
  } catch {
    return {
      version: 1,
      quorum: attesterQuorum,
      attesters: []
    };
  }
}

async function ensureAttesterKeys(): Promise<AttesterKeyFile> {
  const existing = await getAttesterKeyFile();
  if (existing.attesters.length >= attesterCount) {
    return {
      ...existing,
      quorum: Math.min(existing.quorum || attesterQuorum, existing.attesters.length)
    };
  }

  const next: AttesterKeyFile = {
    version: 1,
    quorum: Math.min(attesterQuorum, attesterCount),
    attesters: [...existing.attesters]
  };
  while (next.attesters.length < attesterCount) {
    next.attesters.push({
      id: `attester-${next.attesters.length + 1}`,
      privateKey: PrivateKey.random().toBase58()
    });
  }
  await writeJson(attesterKeysPath, next);
  return next;
}

export function generateClientKeypair(): ClientKeypair {
  return generateX25519Keypair();
}

function createClientEncryptedEnvelope(payload: unknown, clientPublicKeyPem: string): ClientEncryptedEnvelope {
  return encryptJsonEnvelope(payload, clientPublicKeyPem, getEnvelopeContext('client-output'));
}

export function decryptClientEnvelope(privateKeyPem: string, envelope: ClientEncryptedEnvelope): unknown {
  return decryptJsonEnvelope(privateKeyPem, envelope, getEnvelopeContext('client-output'));
}

async function ensurePrivateLaneOperatorKeypair(): Promise<X25519Keypair> {
  try {
    const [publicKeyPem, privateKeyPem] = await Promise.all([
      fs.readFile(privateLanePublicKeyPath, 'utf8'),
      fs.readFile(privateLanePrivateKeyPath, 'utf8')
    ]);
    return {
      curve: 'x25519',
      publicKeyPem,
      privateKeyPem,
      fingerprint: fingerprintPublicKeyPem(publicKeyPem)
    };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    const generated = generateX25519Keypair();
    await Promise.all([
      fs.writeFile(privateLanePublicKeyPath, generated.publicKeyPem, 'utf8'),
      fs.writeFile(privateLanePrivateKeyPath, generated.privateKeyPem, 'utf8')
    ]);
    return generated;
  }
}

async function getPrivateLaneConfig(): Promise<PrivateLaneConfig> {
  const keypair = await ensurePrivateLaneOperatorKeypair();
  return {
    mode: 'sealed-input',
    curve: 'x25519',
    context: getEnvelopeContext('private-input'),
    publicKeyPem: keypair.publicKeyPem,
    fingerprint: keypair.fingerprint
  };
}

async function decryptPrivateInferenceEnvelope(envelope: ClientEncryptedEnvelope): Promise<PrivateInferenceEnvelopePayload> {
  const keypair = await ensurePrivateLaneOperatorKeypair();
  const payload = decryptJsonEnvelope(keypair.privateKeyPem, envelope, getEnvelopeContext('private-input'));
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    throw new Error('Private inference envelope is missing a prompt.');
  }
  const inputs =
    body?.inputs && typeof body.inputs === 'object' && body.inputs !== null && !Array.isArray(body.inputs)
      ? (body.inputs as Record<string, unknown>)
      : {};
  return {
    prompt,
    inputs
  };
}

function createFutureEthereumEnvelope(settlementMode: SettlementMode): FutureEthereumEnvelope {
  return {
    targetChain: 'ethereum',
    targetChainId: ethereumTargetChainId,
    settlementMode,
    status: 'planned',
    dataAvailability: 'eip4844',
    settlementContract: ethereumSettlementContract,
    batchId: null,
    batchHash: null,
    blobVersionedHash: null,
    challengePoint: null,
    evaluationClaim: null,
    notes: [
      'Inference runs off-chain first and settles on Zeko testnet today.',
      'When Ethereum settlement is enabled, export settled receipts or batches as EIP-4844-backed proof envelopes.',
      'The intended bridge shape matches Zeko blob-equivalence claims: bind batch data on Ethereum to the same witness committed on Zeko.'
    ]
  };
}

function defaultModel(): ModelRecord {
  return {
    id: 'verifiable-echo',
    name: 'Verifiable Echo',
    version: '0.2.0',
    description:
      'A deterministic mock model that mirrors fast off-chain inference plus threshold-settled receipts on Zeko.',
    endpoint: null,
    authToken: null,
    settlementModeDefault: defaultSettlementMode,
    verificationMethod: 'THRESHOLD_ATTESTATION',
    transportMode: 'HTTP_X402',
    tags: ['mock', 'llm', 'zeko', 'threshold-attestation', 'builder-infra'],
    createdAt: new Date().toISOString()
  };
}

function createPrivacyProfile(
  settlementMode: SettlementMode,
  encryptedOutput: ClientEncryptedEnvelope | null,
  privateInput: PrivateInputRecord | null
): PrivacyProfile {
  return {
    inputVisibility: privateInput?.enabled ? 'encrypted_for_operator' : 'operator_visible_with_commitment_only',
    outputVisibility: encryptedOutput ? 'encrypted_for_client' : 'public',
    settlementVisibility:
      settlementMode === 'SETTLE_INDIVIDUAL_WITH_METADATA' ? 'metadata_visible' : 'hash_only',
    trustBoundary: [
      privateInput?.enabled
        ? 'Builders can submit encrypted request envelopes so plaintext prompts are not persisted in the normal coordinator record.'
        : 'Model execution still sees the plaintext prompt unless replaced with TEE, MPC, FHE, or zkML.',
      'Settlement can be decentralized even when execution remains partially trusted.',
      'MCP or SDK can be used as clients, but the receipt format stays transport-agnostic.'
    ],
    caveats: [
      privateInput?.enabled
        ? 'The private lane reduces plaintext persistence, but the operator still decrypts the request before executing the model.'
        : 'This prototype improves privacy for output storage and DA publication, not fully private inference execution.',
      'Threshold attestations reduce single-operator trust for settlement but do not by themselves prove the model ran honestly.',
      'Full trustless private inference would require zkML for small deterministic models, TEEs with quote verification, or MPC/FHE.'
    ]
  };
}

function createDaRelayPayload(
  commitment: string,
  encryptedEnvelope: ClientEncryptedEnvelope,
  createdAt: string
): DaRelayPayload {
  return {
    mode: 'zeko-relay',
    schema: daSchema,
    appId: daAppId,
    network: zekoNetwork.networkId,
    commitment,
    payloadCiphertext: encryptedEnvelope,
    payloadHash: sha256Hex(stableStringify(encryptedEnvelope)),
    createdAtUnixMs: Date.parse(createdAt)
  };
}

async function maybePublishToDa(
  commitment: string,
  encryptedEnvelope: ClientEncryptedEnvelope | null,
  createdAt: string,
  publishToDa: boolean
): Promise<DaPublicationRecord | null> {
  if (!publishToDa) return null;
  if (!encryptedEnvelope) {
    return {
      schema: daSchema,
      appId: daAppId,
      prepared: false,
      endpoint: daEndpoint,
      relayPayload: null,
      reference: null,
      error: 'DA publishing requires client-encrypted output.'
    };
  }

  const relayPayload = createDaRelayPayload(commitment, encryptedEnvelope, createdAt);
  if (!daEndpoint) {
    return {
      schema: daSchema,
      appId: daAppId,
      prepared: true,
      endpoint: null,
      relayPayload,
      reference: null,
      error: null
    };
  }

  try {
    const response = await fetch(daEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(daBearerToken ? { authorization: `Bearer ${daBearerToken}` } : {})
      },
      body: JSON.stringify(relayPayload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        schema: daSchema,
        appId: daAppId,
        prepared: true,
        endpoint: daEndpoint,
        relayPayload,
        reference: null,
        error: `DA relay returned ${response.status}`
      };
    }
    return {
      schema: daSchema,
      appId: daAppId,
      prepared: true,
      endpoint: daEndpoint,
      relayPayload,
      reference: (json as any)?.reference || (json as any)?.id || (json as any)?.cid || null,
      error: null
    };
  } catch (error) {
    return {
      schema: daSchema,
      appId: daAppId,
      prepared: true,
      endpoint: daEndpoint,
      relayPayload,
      reference: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function buildThresholdAttestations(
  receiptHash: Field,
  requestRoot: Field,
  outputRoot: Field
): Promise<ThresholdAttestationBundle> {
  const attesterFile = await ensureAttesterKeys();
  const quorum = Math.min(attesterFile.quorum || attesterQuorum, attesterFile.attesters.length);
  const digest = Poseidon.hash([receiptHash, requestRoot, outputRoot]);
  const signatures = attesterFile.attesters.slice(0, quorum).map((attester) => {
    const privateKey = PrivateKey.fromBase58(attester.privateKey);
    return {
      attesterId: attester.id,
      publicKey: privateKey.toPublicKey().toBase58(),
      signature: Signature.create(privateKey, [digest, requestRoot, outputRoot]).toJSON()
    };
  });
  return {
    method: 'THRESHOLD_ATTESTATION',
    quorum,
    digest: digest.toJSON(),
    attestersAvailable: attesterFile.attesters.length,
    signatures,
    notes: [
      'This replaces the single-settlement-oracle assumption with a quorum of independent attestations.',
      'A future Zeko contract can verify a threshold bundle root or aggregate signature instead of trusting one signer.'
    ]
  };
}

async function getThresholdAttesterPair() {
  const attesterFile = await ensureAttesterKeys();
  if (attesterFile.attesters.length < 2) {
    throw new Error('At least two attester keys are required for v2 threshold settlement.');
  }
  const [attester1Record, attester2Record] = attesterFile.attesters;
  const attester1Key = PrivateKey.fromBase58(attester1Record.privateKey);
  const attester2Key = PrivateKey.fromBase58(attester2Record.privateKey);
  return { attester1Key, attester2Key };
}

async function buildV2InferenceSettlementPayloads(
  requestHash: Field,
  agentIdHash: Field,
  outputHash: Field,
  requestRoot: Field,
  outputRoot: Field,
  requestIndex: number,
  outputIndex: number
): Promise<ZekoSettlementArtifactsV2> {
  const { attester1Key, attester2Key } = await getThresholdAttesterPair();

  return {
    network: zekoNetwork,
    contractVersion: 'v2',
    requestPayload: {
      requestHash: requestHash.toJSON(),
      agentIdHash: agentIdHash.toJSON(),
      merkleRoot: requestRoot.toJSON(),
      merkleIndex: requestIndex,
      attester1PublicKey: attester1Key.toPublicKey().toBase58(),
      attester1Signature: Signature.create(attester1Key, [requestHash, agentIdHash, requestRoot]).toJSON(),
      attester2PublicKey: attester2Key.toPublicKey().toBase58(),
      attester2Signature: Signature.create(attester2Key, [requestHash, agentIdHash, requestRoot]).toJSON()
    },
    outputPayload: {
      requestHash: requestHash.toJSON(),
      outputHash: outputHash.toJSON(),
      merkleRoot: outputRoot.toJSON(),
      merkleIndex: outputIndex,
      attester1PublicKey: attester1Key.toPublicKey().toBase58(),
      attester1Signature: Signature.create(attester1Key, [requestHash, outputHash, outputRoot]).toJSON(),
      attester2PublicKey: attester2Key.toPublicKey().toBase58(),
      attester2Signature: Signature.create(attester2Key, [requestHash, outputHash, outputRoot]).toJSON()
    }
  };
}

async function buildV2AgentRegistrationPayload(
  agentIdHash: Field,
  ownerHash: Field,
  treasuryHash: Field,
  stakeAmount: Field,
  merkleRoot: Field,
  merkleIndex: number
): Promise<ZekoAgentSettlementArtifactsV2> {
  const { attester1Key, attester2Key } = await getThresholdAttesterPair();
  return {
    network: zekoNetwork,
    contractVersion: 'v2',
    registrationPayload: {
      agentIdHash: agentIdHash.toJSON(),
      ownerHash: ownerHash.toJSON(),
      treasuryHash: treasuryHash.toJSON(),
      stakeAmount: stakeAmount.toJSON(),
      merkleRoot: merkleRoot.toJSON(),
      merkleIndex,
      attester1PublicKey: attester1Key.toPublicKey().toBase58(),
      attester1Signature: Signature.create(attester1Key, [
        agentIdHash,
        ownerHash,
        treasuryHash,
        stakeAmount,
        merkleRoot
      ]).toJSON(),
      attester2PublicKey: attester2Key.toPublicKey().toBase58(),
      attester2Signature: Signature.create(attester2Key, [
        agentIdHash,
        ownerHash,
        treasuryHash,
        stakeAmount,
        merkleRoot
      ]).toJSON()
    }
  };
}

async function buildV2CreditsPayload(
  creditsRoot: Field,
  nullifierRoot: Field,
  options: {
    depositMina?: number;
    spendTo?: string | null;
    spendAmountMina?: number;
    platformAmountMina?: number;
    platformPayee?: string | null;
  } = {}
): Promise<ZekoThresholdCreditsPayload> {
  const { attester1Key, attester2Key } = await getThresholdAttesterPair();
  const spendAmountField = Field.from(Math.round((options.spendAmountMina ?? 0) * 1e9));
  const platformAmountField = Field.from(Math.round((options.platformAmountMina ?? 0) * 1e9));
  return {
    creditsRoot: creditsRoot.toJSON(),
    nullifierRoot: nullifierRoot.toJSON(),
    attester1PublicKey: attester1Key.toPublicKey().toBase58(),
    attester1Signature: Signature.create(attester1Key, [
      creditsRoot,
      nullifierRoot,
      spendAmountField,
      platformAmountField
    ]).toJSON(),
    attester2PublicKey: attester2Key.toPublicKey().toBase58(),
    attester2Signature: Signature.create(attester2Key, [
      creditsRoot,
      nullifierRoot,
      spendAmountField,
      platformAmountField
    ]).toJSON(),
    depositMina: options.depositMina,
    spendTo: options.spendTo,
    spendAmountMina: options.spendAmountMina,
    platformAmountMina: options.platformAmountMina,
    platformPayee: options.platformPayee
  };
}

export async function ensureStore() {
  if (storeReady) {
    if (shouldRunBackgroundWorkers) {
      ensureCreditsOperatorWorker();
      ensureCoordinatorSyncWorker();
    }
    return;
  }
  if (!storeReadyPromise) {
    storeReadyPromise = (async () => {
      await fs.mkdir(dataDir, { recursive: true });
      const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
      if (!modelsFile.models.length) {
        modelsFile.models.push(defaultModel());
        await writeJson(modelsPath, modelsFile);
      }
      await writeJson(inferencesPath, await readJson<InferencesFile>(inferencesPath, { inferences: [] }));
      await writeJson(batchesPath, await readJson<BatchesFile>(batchesPath, { batches: [] }));
      await writeJson(treeStatePath, await readJson<TreeState>(treeStatePath, defaultTreeState()));
      await writeJson(coordinationTreesPath, await readCoordinationTreeState());
      await writeJson(agentsPath, await readJson<AgentRegistrationsFile>(agentsPath, { agents: [] }));
      await writeJson(creditsLedgerPath, await readCreditsLedger());
      await writeJson(creditsNullifiersPath, await readCreditsNullifiers());
      await writeJson(creditsIntentsPath, await readCreditsIntents());
      await writeJson(creditsOperatorQueuePath, await readCreditsOperatorQueue());
      await writeJson(creditsDepositMonitorsPath, await readCreditsDepositMonitors());
      await writeJson(creditsCheckpointBatchesPath, await readCreditsCheckpointBatches());
      await writeJson(operatorRegistryPath, await readOperatorRegistry());
      await getOraclePrivateKey();
      await ensureAttesterKeys();
      await ensureLocalOperatorRegistryEntry();
      storeReady = true;
      if (shouldRunBackgroundWorkers) {
        ensureCreditsOperatorWorker();
        ensureCreditsDepositMonitorWorker();
        ensureCoordinatorSyncWorker();
      }
    })().catch((error) => {
      storeReadyPromise = null;
      throw error;
    });
  }
  await storeReadyPromise;
}

async function runModel(
  model: ModelRecord,
  inferenceId: string,
  prompt: string,
  inputs: Record<string, unknown>,
  settlementMode: SettlementMode
): Promise<unknown> {
  if (!model.endpoint) {
    const score = seededScore(`${model.id}:${prompt}:${stableStringify(inputs)}`);
    const confidence = Math.round((0.55 + score * 0.4) * 1000) / 1000;
    const label = score > 0.66 ? 'execute' : score > 0.33 ? 'review' : 'reject';
    return {
      type: 'mock-verifiable-response',
      text: `Mock response from ${model.name} for prompt: ${prompt}`,
      confidence,
      label,
      evidence: [
        'Off-chain inference completed immediately for low latency.',
        'Receipt contains request and output hashes for later proof settlement on Zeko.',
        'Threshold attestations remove the single-oracle settlement assumption.',
        'Future Ethereum envelope remains attached for eventual L1 export.'
      ],
      settlementMode,
      transportMode: model.transportMode
    };
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (model.authToken) {
    headers.authorization = `Bearer ${model.authToken}`;
  }
  const response = await fetch(model.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inferenceId,
      modelId: model.id,
      prompt,
      inputs,
      settlementMode
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Model endpoint returned ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function createInference(params: CreateInferenceParams) {
  const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
  const model = modelsFile.models.find((entry) => entry.id === params.modelId);
  if (!model) throw new Error(`Unknown model: ${params.modelId}`);

  const settlementMode = normalizeSettlementMode(params.settlementMode, model.settlementModeDefault);
  const inferenceId = `inf_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const requestStatusToken = params.statusToken?.trim() || `sts_${crypto.randomUUID().replace(/-/g, '')}`;
  const privatePayload = params.privateInputEnvelope ? await decryptPrivateInferenceEnvelope(params.privateInputEnvelope) : null;
  const actualPrompt = privatePayload?.prompt || params.prompt;
  const actualInputs =
    privatePayload?.inputs && Object.keys(privatePayload.inputs).length > 0 ? privatePayload.inputs : params.inputs;
  const persistPlaintextPrompt = params.storePlaintextPrompt === true;
  const privateInput: PrivateInputRecord | null = params.privateInputEnvelope
    ? {
        enabled: true,
        operatorPublicKeyFingerprint: params.privateInputEnvelope.recipientPublicKeyFingerprint || null,
        envelopeHash: sha256Hex(stableStringify(params.privateInputEnvelope)),
        promptHash: sha256Hex(actualPrompt),
        inputsHash: sha256Hex(stableStringify(actualInputs)),
        plaintextPersisted: persistPlaintextPrompt,
        envelope: params.privateInputEnvelope
      }
    : null;
  const storedPrompt = privateInput && !persistPlaintextPrompt ? '[redacted: encrypted private input envelope]' : actualPrompt;
  const storedInputs =
    privateInput && !persistPlaintextPrompt
      ? ({
          redacted: true,
          reason: 'Inputs were submitted through the private lane and are retained only inside the sealed envelope.'
        } as Record<string, unknown>)
      : actualInputs;
  const rawOutput = await runModel(model, inferenceId, actualPrompt, actualInputs, settlementMode);
  const encryptedOutput = params.clientEncryptionPublicKeyPem
    ? createClientEncryptedEnvelope(rawOutput, params.clientEncryptionPublicKeyPem)
    : null;
  const visibleOutput: unknown | RedactedOutput = encryptedOutput
    ? { redacted: true, reason: 'Encrypted for client holder of the X25519 private key.' }
    : rawOutput;
  const privacy = createPrivacyProfile(settlementMode, encryptedOutput, privateInput);

  const metadata = {
    source: 'zeko-ai-runtime',
    verificationMethod: model.verificationMethod,
    executionLayer: 'offchain-fast-path',
    settlementLayer: 'zeko-testnet',
    futureSettlementLayer: 'ethereum',
    transportMode: model.transportMode,
    model: {
      id: model.id,
      name: model.name,
      version: model.version
    },
    tags: model.tags,
    endpointConfigured: Boolean(model.endpoint),
    encryptedOutput: Boolean(encryptedOutput),
    privateInput: Boolean(privateInput?.enabled),
    privacy
  };

  const requestHash = hashJsonToField({
    inferenceId,
    modelId: model.id,
    prompt: actualPrompt,
    inputs: actualInputs,
    settlementMode
  });
  const modelIdHash = hashTextToField(model.id);
  const outputHash = hashJsonToField(rawOutput);
  const metadataHash = hashJsonToField(metadata);
  const requestLeaf = Poseidon.hash([requestHash, modelIdHash, settlementModeToField(settlementMode), metadataHash]);
  const outputLeaf = Poseidon.hash([requestHash, outputHash, settlementModeToField(settlementMode), metadataHash]);

  const treeState = await readJson<TreeState>(treeStatePath, defaultTreeState());
  const requestTree = buildTree(treeState.requestLeaves);
  const outputTree = buildTree(treeState.outputLeaves);
  const requestIndex = treeState.nextRequestIndex;
  const outputIndex = treeState.nextOutputIndex;
  requestTree.setLeaf(BigInt(requestIndex), requestLeaf);
  outputTree.setLeaf(BigInt(outputIndex), outputLeaf);
  const requestRoot = requestTree.getRoot();
  const outputRoot = outputTree.getRoot();

  const oracleKey = await getOraclePrivateKey();
  const oraclePublicKey = oracleKey.toPublicKey().toBase58();
  const requestSignature = Signature.create(oracleKey, [requestHash, modelIdHash, requestRoot]).toJSON();
  const outputSignature = Signature.create(oracleKey, [requestHash, outputHash, outputRoot]).toJSON();
  const receiptHash = Poseidon.hash([requestHash, outputHash, metadataHash, requestRoot, outputRoot]);
  const attestations = await buildThresholdAttestations(receiptHash, requestRoot, outputRoot);
  const zekoV2 = await buildV2InferenceSettlementPayloads(
    requestHash,
    modelIdHash,
    outputHash,
    requestRoot,
    outputRoot,
    requestIndex,
    outputIndex
  );
  const daPublication = await maybePublishToDa(
    receiptHash.toJSON(),
    encryptedOutput,
    createdAt,
    Boolean(params.publishToDa)
  );

  const record: InferenceRecord = {
    id: inferenceId,
    modelId: model.id,
    modelName: model.name,
    prompt: storedPrompt,
    inputs: storedInputs,
    privateInput,
    output: visibleOutput,
    encryptedOutput,
    settlementMode,
    verificationMethod: model.verificationMethod,
    transportMode: model.transportMode,
    createdAt,
    requestHash: requestHash.toJSON(),
    outputHash: outputHash.toJSON(),
    metadataHash: metadataHash.toJSON(),
    receiptHash: receiptHash.toJSON(),
    requestLeaf: requestLeaf.toJSON(),
    outputLeaf: outputLeaf.toJSON(),
    requestRoot: requestRoot.toJSON(),
    outputRoot: outputRoot.toJSON(),
    metadata,
    attribution: params.attribution || null,
    zeko: {
      network: zekoNetwork,
      requestPayload: {
        requestHash: requestHash.toJSON(),
        agentIdHash: modelIdHash.toJSON(),
        oraclePublicKey,
        signature: requestSignature,
        merkleRoot: requestRoot.toJSON(),
        merkleIndex: requestIndex
      },
      outputPayload: {
        requestHash: requestHash.toJSON(),
        outputHash: outputHash.toJSON(),
        oraclePublicKey,
        signature: outputSignature,
        merkleRoot: outputRoot.toJSON(),
        merkleIndex: outputIndex
      }
    },
    zekoV2,
    attestations,
    privacy,
    daPublication,
    futureEthereum: createFutureEthereumEnvelope(settlementMode),
    requestStatus: {
      token: requestStatusToken,
      callbackUrl: params.callbackUrl?.trim() || null,
      callbackMode: normalizeInferenceCallbackMode(params.callbackMode),
      lastStatus: 'created',
      lastStatusAt: createdAt,
      lastNotifiedStatus: null,
      lastCallbackAt: null,
      callbackAttempts: 0,
      lastCallbackError: null
    },
    liveSettlement: null,
    liveSettlementV2: null
  };

  treeState.requestLeaves[String(requestIndex)] = requestLeaf.toJSON();
  treeState.outputLeaves[String(outputIndex)] = outputLeaf.toJSON();
  treeState.nextRequestIndex += 1;
  treeState.nextOutputIndex += 1;

  const inferencesFile = await readJson<InferencesFile>(inferencesPath, { inferences: [] });
  inferencesFile.inferences.unshift(record);

  await writeJson(treeStatePath, treeState);
  await writeJson(inferencesPath, inferencesFile);

  return (await reconcileInferenceRequestStatus(record.id)) || record;
}

function buildExplorerTxUrl(hash: string | null): string | null {
  const explorer = getZekoRuntimeConfig().explorer;
  if (!explorer || !hash) return null;
  return `${explorer.replace(/\/+$/, '')}/tx/${hash}`;
}

function buildExplorerTxUrlV2(hash: string | null): string | null {
  const explorer = getZekoRuntimeConfigV2().explorer;
  if (!explorer || !hash) return null;
  return `${explorer.replace(/\/+$/, '')}/tx/${hash}`;
}

function createLiveReceiptStage(
  kind: 'request-receipt' | 'output-receipt',
  stateIndex: number,
  targetRoot: string
): LiveReceiptStageRecord {
  return {
    kind,
    stateIndex,
    targetRoot,
    txHash: null,
    submittedAt: null,
    settled: false,
    settledAt: null,
    observedRoot: null,
    explorerUrl: null,
    note: null
  };
}

function createLiveSettlementRecord(
  inference: InferenceRecord,
  options: LiveSettlementOptions,
  sponsorEnabled: boolean
): LiveSettlementRecord {
  return {
    mode: 'SPONSORED_ZEKO_TESTNET',
    sponsorEnabled,
    waitForSettlement: options.waitForSettlement,
    request: createLiveReceiptStage('request-receipt', 0, inference.requestRoot),
    output: createLiveReceiptStage('output-receipt', 1, inference.outputRoot),
    settled: false,
    settledAt: null,
    latestCheckAt: null,
    lastError: null
  };
}

async function persistLiveSettlement(inferenceId: string, liveSettlement: LiveSettlementRecord) {
  await updateInferenceById(inferenceId, (inference) => ({
    ...inference,
    liveSettlement
  }));
  return await reconcileInferenceRequestStatus(inferenceId);
}

function createLiveSettlementRecordV2(
  inference: InferenceRecord,
  options: LiveSettlementOptions,
  sponsorEnabled: boolean
): LiveSettlementRecordV2 {
  return {
    mode: 'SPONSORED_ZEKO_TESTNET_V2',
    sponsorEnabled,
    waitForSettlement: options.waitForSettlement,
    request: createLiveReceiptStage('request-receipt', 0, inference.requestRoot),
    output: createLiveReceiptStage('output-receipt', 1, inference.outputRoot),
    settled: false,
    settledAt: null,
    latestCheckAt: null,
    lastError: null,
    contractVersion: 'v2'
  };
}

async function persistLiveSettlementV2(inferenceId: string, liveSettlementV2: LiveSettlementRecordV2) {
  await updateInferenceById(inferenceId, (inference) => ({
    ...inference,
    liveSettlementV2
  }));
  return await reconcileInferenceRequestStatus(inferenceId);
}

export async function submitLiveReceiptsForInference(
  inferenceId: string,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  const inference = await getInferenceById(inferenceId);
  if (!inference) {
    throw new Error('Inference not found.');
  }

  const runtimeConfig = getZekoRuntimeConfig();
  if (!runtimeConfig.hasSponsorPrivateKey) {
    throw new Error('Sponsor mode is not enabled.');
  }

  const options = normalizeLiveSettlementOptions(optionsInput);
  const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));
  let liveSettlement = createLiveSettlementRecord(inference, options, runtimeConfig.hasSponsorPrivateKey);

  await persistLiveSettlement(inference.id, liveSettlement);

  const markFailure = async (message: string) => {
    liveSettlement = {
      ...liveSettlement,
      latestCheckAt: new Date().toISOString(),
      lastError: message
    };
    await persistLiveSettlement(inference.id, liveSettlement);
  };

  try {
    const requestSubmission = await submitRequestReceiptTxWithSponsor(inference.zeko.requestPayload);
    liveSettlement = {
      ...liveSettlement,
      request: liveSettlement.request
        ? {
            ...liveSettlement.request,
            txHash: requestSubmission.hash,
            submittedAt: new Date().toISOString(),
            explorerUrl: buildExplorerTxUrl(requestSubmission.hash)
          }
        : null,
      latestCheckAt: new Date().toISOString(),
      lastError: null
    };
    await persistLiveSettlement(inference.id, liveSettlement);

    if (options.waitForSettlement && liveSettlement.request) {
      const requestState = await waitForZkappStateValue(liveSettlement.request.stateIndex, inference.requestRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!requestState) {
        const requestStatus = requestSubmission.hash
          ? await fetchZekoTransactionStatus(requestSubmission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `Request receipt did not apply the expected request root to zkApp state. requestTxHash=${requestSubmission.hash ?? 'null'} requestStatus=${JSON.stringify(requestStatus)}`
        );
      }
      liveSettlement = {
        ...liveSettlement,
        request: {
          ...liveSettlement.request,
          settled: true,
          settledAt: new Date().toISOString(),
          observedRoot: requestState.zkappState[liveSettlement.request.stateIndex] || null,
          note: 'Request root observed on Zeko testnet.'
        },
        latestCheckAt: new Date().toISOString()
      };
      await persistLiveSettlement(inference.id, liveSettlement);
    }

    const outputSubmission = await submitOutputReceiptTxWithSponsor(inference.zeko.outputPayload);
    liveSettlement = {
      ...liveSettlement,
      output: liveSettlement.output
        ? {
            ...liveSettlement.output,
            txHash: outputSubmission.hash,
            submittedAt: new Date().toISOString(),
            explorerUrl: buildExplorerTxUrl(outputSubmission.hash)
          }
        : null,
      latestCheckAt: new Date().toISOString(),
      lastError: null
    };
    await persistLiveSettlement(inference.id, liveSettlement);

    if (options.waitForSettlement && liveSettlement.output) {
      const outputState = await waitForZkappStateValue(liveSettlement.output.stateIndex, inference.outputRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!outputState) {
        const outputStatus = outputSubmission.hash
          ? await fetchZekoTransactionStatus(outputSubmission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `Output receipt did not apply the expected output root to zkApp state. outputTxHash=${outputSubmission.hash ?? 'null'} outputStatus=${JSON.stringify(outputStatus)}`
        );
      }
      liveSettlement = {
        ...liveSettlement,
        output: {
          ...liveSettlement.output,
          settled: true,
          settledAt: new Date().toISOString(),
          observedRoot: outputState.zkappState[liveSettlement.output.stateIndex] || null,
          note: 'Output root observed on Zeko testnet.'
        },
        settled: true,
        settledAt: new Date().toISOString(),
        latestCheckAt: new Date().toISOString()
      };
      await persistLiveSettlement(inference.id, liveSettlement);
      return {
        inference: (await getInferenceById(inference.id))!,
        liveSettlement,
        chainState: outputState
      };
    }

    const chainState = await fetchZkappAccountState().catch(() => null);
    if (chainState) {
      liveSettlement = {
        ...liveSettlement,
        latestCheckAt: new Date().toISOString(),
        request: liveSettlement.request
          ? {
              ...liveSettlement.request,
              observedRoot: chainState.zkappState[liveSettlement.request.stateIndex] || null
            }
          : null,
        output: liveSettlement.output
          ? {
              ...liveSettlement.output,
              observedRoot: chainState.zkappState[liveSettlement.output.stateIndex] || null
            }
          : null
      };
      await persistLiveSettlement(inference.id, liveSettlement);
    }

    return {
      inference: (await getInferenceById(inference.id))!,
      liveSettlement,
      chainState
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailure(message);
    throw error;
  }
}

export async function createAndSubmitLiveInference(
  params: CreateInferenceParams,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  const inference = await createInference(params);
  return await submitLiveReceiptsForInference(inference.id, optionsInput);
}

export async function submitLiveReceiptsForInferenceV2(
  inferenceId: string,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  const inference = await getInferenceById(inferenceId);
  if (!inference) {
    throw new Error('Inference not found.');
  }
  if (!inference.zekoV2) {
    throw new Error('Inference does not include v2 threshold settlement payloads.');
  }

  const runtimeConfig = getZekoRuntimeConfigV2();
  if (!runtimeConfig.hasSponsorPrivateKey) {
    throw new Error('Sponsor mode is not enabled.');
  }

  const options = normalizeLiveSettlementOptions(optionsInput);
  const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));
  let liveSettlementV2 = createLiveSettlementRecordV2(inference, options, runtimeConfig.hasSponsorPrivateKey);

  await persistLiveSettlementV2(inference.id, liveSettlementV2);

  const markFailure = async (message: string) => {
    liveSettlementV2 = {
      ...liveSettlementV2,
      latestCheckAt: new Date().toISOString(),
      lastError: message
    };
    await persistLiveSettlementV2(inference.id, liveSettlementV2);
  };

  try {
    const requestSubmission = await submitRequestReceiptTxWithSponsorV2(inference.zekoV2.requestPayload);
    liveSettlementV2 = {
      ...liveSettlementV2,
      request: liveSettlementV2.request
        ? {
            ...liveSettlementV2.request,
            txHash: requestSubmission.hash,
            submittedAt: new Date().toISOString(),
            explorerUrl: buildExplorerTxUrlV2(requestSubmission.hash)
          }
        : null,
      latestCheckAt: new Date().toISOString(),
      lastError: null
    };
    await persistLiveSettlementV2(inference.id, liveSettlementV2);

    if (options.waitForSettlement && liveSettlementV2.request) {
      const requestState = await waitForZkappStateValueV2(liveSettlementV2.request.stateIndex, inference.requestRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!requestState) {
        const requestStatus = requestSubmission.hash
          ? await fetchZekoTransactionStatusV2(requestSubmission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `v2 request receipt did not apply the expected request root to zkApp state. requestTxHash=${requestSubmission.hash ?? 'null'} requestStatus=${JSON.stringify(requestStatus)}`
        );
      }
      liveSettlementV2 = {
        ...liveSettlementV2,
        request: {
          ...liveSettlementV2.request,
          settled: true,
          settledAt: new Date().toISOString(),
          observedRoot: requestState.zkappState[liveSettlementV2.request.stateIndex] || null,
          note: 'Request root observed on Zeko testnet v2.'
        },
        latestCheckAt: new Date().toISOString()
      };
      await persistLiveSettlementV2(inference.id, liveSettlementV2);
    }

    const outputSubmission = await submitOutputReceiptTxWithSponsorV2(inference.zekoV2.outputPayload);
    liveSettlementV2 = {
      ...liveSettlementV2,
      output: liveSettlementV2.output
        ? {
            ...liveSettlementV2.output,
            txHash: outputSubmission.hash,
            submittedAt: new Date().toISOString(),
            explorerUrl: buildExplorerTxUrlV2(outputSubmission.hash)
          }
        : null,
      latestCheckAt: new Date().toISOString(),
      lastError: null
    };
    await persistLiveSettlementV2(inference.id, liveSettlementV2);

    if (options.waitForSettlement && liveSettlementV2.output) {
      const outputState = await waitForZkappStateValueV2(liveSettlementV2.output.stateIndex, inference.outputRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!outputState) {
        const outputStatus = outputSubmission.hash
          ? await fetchZekoTransactionStatusV2(outputSubmission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `v2 output receipt did not apply the expected output root to zkApp state. outputTxHash=${outputSubmission.hash ?? 'null'} outputStatus=${JSON.stringify(outputStatus)}`
        );
      }
      liveSettlementV2 = {
        ...liveSettlementV2,
        output: {
          ...liveSettlementV2.output,
          settled: true,
          settledAt: new Date().toISOString(),
          observedRoot: outputState.zkappState[liveSettlementV2.output.stateIndex] || null,
          note: 'Output root observed on Zeko testnet v2.'
        },
        settled: true,
        settledAt: new Date().toISOString(),
        latestCheckAt: new Date().toISOString()
      };
      await persistLiveSettlementV2(inference.id, liveSettlementV2);
      return {
        inference: (await getInferenceById(inference.id))!,
        liveSettlementV2,
        chainState: outputState
      };
    }

    const chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (chainState) {
      liveSettlementV2 = {
        ...liveSettlementV2,
        latestCheckAt: new Date().toISOString(),
        request: liveSettlementV2.request
          ? {
              ...liveSettlementV2.request,
              observedRoot: chainState.zkappState[liveSettlementV2.request.stateIndex] || null
            }
          : null,
        output: liveSettlementV2.output
          ? {
              ...liveSettlementV2.output,
              observedRoot: chainState.zkappState[liveSettlementV2.output.stateIndex] || null
            }
          : null
      };
      await persistLiveSettlementV2(inference.id, liveSettlementV2);
    }

    return {
      inference: (await getInferenceById(inference.id))!,
      liveSettlementV2,
      chainState
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailure(message);
    throw error;
  }
}

export async function createAndSubmitLiveInferenceV2(
  params: CreateInferenceParams,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  const inference = await createInference(params);
  return await submitLiveReceiptsForInferenceV2(inference.id, optionsInput);
}

export async function createAgentRegistration(params: CreateAgentParams) {
  const name = params.name.trim();
  if (!name) throw new Error('Missing agent name.');
  const ownerPublicKey = params.ownerPublicKey.trim();
  if (!ownerPublicKey) throw new Error('Missing ownerPublicKey.');

  const agentsFile = await readAgentsFile();
  const id = (params.id ? String(params.id) : slugify(name) || `agent-${agentsFile.agents.length + 1}`).trim();
  if (!id) throw new Error('Missing agent id.');
  if (agentsFile.agents.some((entry) => entry.id === id)) {
    throw new Error(`Agent id already exists: ${id}`);
  }

  const stakeAmountMina = Number(params.stakeAmountMina ?? 0);
  if (!Number.isFinite(stakeAmountMina) || stakeAmountMina < 0) {
    throw new Error('Invalid stakeAmountMina.');
  }

  const treasuryPublicKey = (params.treasuryPublicKey || ownerPublicKey).trim();
  const coordinationTrees = await readCoordinationTreeState();
  const agentIdHash = hashTextToField(id);
  const ownerHash = hashTextToField(ownerPublicKey);
  const treasuryHash = hashTextToField(treasuryPublicKey);
  const stakeAmountField = Field.from(Math.round(stakeAmountMina * 1e9));
  const merkleLeaf = computeAgentLeaf(agentIdHash, ownerHash, treasuryHash, stakeAmountField);
  const commit = commitLeafToTree(coordinationTrees, 'agentLeaves', 'nextAgentIndex', merkleLeaf);
  const oracleKey = await getOraclePrivateKey();
  const oraclePublicKey = oracleKey.toPublicKey().toBase58();
  const signature = signAgentRegistration(
    oracleKey,
    agentIdHash,
    ownerHash,
    treasuryHash,
    stakeAmountField,
    Field.fromJSON(commit.root)
  );
  const zekoV2 = await buildV2AgentRegistrationPayload(
    agentIdHash,
    ownerHash,
    treasuryHash,
    stakeAmountField,
    Field.fromJSON(commit.root),
    commit.index
  );

  const record: AgentRegistrationRecord = {
    id,
    name,
    description: String(params.description || ''),
    ownerPublicKey,
    treasuryPublicKey,
    stakeAmountMina,
    capabilities: Array.isArray(params.capabilities) ? params.capabilities.map((entry) => String(entry)) : [],
    metadata: typeof params.metadata === 'object' && params.metadata !== null ? params.metadata : {},
    attribution: params.attribution || null,
    createdAt: new Date().toISOString(),
    agentIdHash: agentIdHash.toJSON(),
    ownerHash: ownerHash.toJSON(),
    treasuryHash: treasuryHash.toJSON(),
    stakeAmount: stakeAmountField.toJSON(),
    merkleLeaf: commit.leaf,
    merkleRoot: commit.root,
    merkleIndex: commit.index,
    zeko: {
      network: zekoNetwork,
      registrationPayload: {
        agentIdHash: agentIdHash.toJSON(),
        ownerHash: ownerHash.toJSON(),
        treasuryHash: treasuryHash.toJSON(),
        stakeAmount: stakeAmountField.toJSON(),
        oraclePublicKey,
        signature,
        merkleRoot: commit.root,
        merkleIndex: commit.index
      }
    },
    zekoV2,
    liveSettlement: null,
    liveSettlementV2: null
  };

  agentsFile.agents.unshift(record);
  await writeJson(agentsPath, agentsFile);
  await writeJson(coordinationTreesPath, coordinationTrees);
  return record;
}

export async function submitLiveAgentRegistrationV1(
  agentId: string,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  const agent = await getAgentById(agentId);
  if (!agent) throw new Error('Agent not found.');
  const runtimeConfig = getZekoRuntimeConfig();
  if (!runtimeConfig.hasSponsorPrivateKey) {
    throw new Error('Sponsor mode is not enabled.');
  }
  const options = normalizeLiveSettlementOptions(optionsInput);
  const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));

  let settlement = createCoordinationLiveStage('agent-registration', 2, agent.merkleRoot);
  await updateAgentById(agent.id, (current) => ({ ...current, liveSettlement: settlement }));

  try {
    const submission = await submitAgentRegistrationViaRegistryLane(agent.zeko.registrationPayload);
    settlement = {
      ...settlement,
      txHash: submission.hash,
      submittedAt: new Date().toISOString(),
      explorerUrl: buildExplorerTxUrl(submission.hash),
      lastError: null
    };
    await updateAgentById(agent.id, (current) => ({ ...current, liveSettlement: settlement }));

    let chainState = await fetchZkappAccountState().catch(() => null);
    if (options.waitForSettlement) {
      const settledState = await waitForZkappStateValue(2, agent.merkleRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!settledState) {
        const txStatus = submission.hash
          ? await fetchZekoTransactionStatus(submission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `Agent registration did not apply the expected agent root to zkApp state. txHash=${submission.hash ?? 'null'} txStatus=${JSON.stringify(txStatus)}`
        );
      }
      chainState = settledState;
      settlement = {
        ...settlement,
        settled: true,
        settledAt: new Date().toISOString(),
        observedRoot: settledState.zkappState[2] || null,
        note: 'Agent registry root observed on Zeko testnet.'
      };
      await updateAgentById(agent.id, (current) => ({ ...current, liveSettlement: settlement }));
    } else if (chainState) {
      settlement = {
        ...settlement,
        observedRoot: chainState.zkappState[2] || null
      };
      await updateAgentById(agent.id, (current) => ({ ...current, liveSettlement: settlement }));
    }

    return {
      agent: (await getAgentById(agent.id))!,
      liveSettlement: settlement,
      chainState,
      submissionRoute: submission.route
    };
  } catch (error) {
    settlement = {
      ...settlement,
      lastError: error instanceof Error ? error.message : String(error)
    };
    await updateAgentById(agent.id, (current) => ({ ...current, liveSettlement: settlement }));
    throw error;
  }
}

export async function submitLiveAgentRegistrationV2(
  agentId: string,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  const existingAgent = await getAgentById(agentId);
  if (!existingAgent) throw new Error('Agent not found.');
  const agent = await ensureAgentHasV2Payload(existingAgent);
  if (!agent.zekoV2) {
    throw new Error('Agent has no v2 threshold settlement payload.');
  }
  const runtimeConfig = getZekoRuntimeConfigV2();
  if (!runtimeConfig.hasSponsorPrivateKey) {
    throw new Error('Sponsor mode is not enabled.');
  }
  const options = normalizeLiveSettlementOptions(optionsInput);
  const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));

  let settlement = createCoordinationLiveStage('agent-registration', 2, agent.merkleRoot);
  await updateAgentById(agent.id, (current) => ({ ...current, liveSettlementV2: settlement }));

  try {
    const submission = await submitAgentRegistrationViaRegistryLaneV2(agent.zekoV2.registrationPayload);
    settlement = {
      ...settlement,
      txHash: submission.hash,
      submittedAt: new Date().toISOString(),
      explorerUrl: buildExplorerTxUrl(submission.hash),
      lastError: null
    };
    await updateAgentById(agent.id, (current) => ({ ...current, liveSettlementV2: settlement }));

    let chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (options.waitForSettlement) {
      const settledState = await waitForZkappStateValueV2(2, agent.merkleRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!settledState) {
        const txStatus = submission.hash
          ? await fetchZekoTransactionStatusV2(submission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `Agent registration did not apply the expected agent root to zkApp state. txHash=${submission.hash ?? 'null'} txStatus=${JSON.stringify(txStatus)}`
        );
      }
      chainState = settledState;
      settlement = {
        ...settlement,
        settled: true,
        settledAt: new Date().toISOString(),
        observedRoot: settledState.zkappState[2] || null,
        note: 'Agent registry root observed on Zeko testnet v2.'
      };
      await updateAgentById(agent.id, (current) => ({ ...current, liveSettlementV2: settlement }));
    } else if (chainState) {
      settlement = {
        ...settlement,
        observedRoot: chainState.zkappState[2] || null
      };
      await updateAgentById(agent.id, (current) => ({ ...current, liveSettlementV2: settlement }));
    }

    return {
      agent: (await getAgentById(agent.id))!,
      liveSettlement: settlement,
      chainState,
      submissionRoute: submission.route
    };
  } catch (error) {
    settlement = {
      ...settlement,
      lastError: error instanceof Error ? error.message : String(error)
    };
    await updateAgentById(agent.id, (current) => ({ ...current, liveSettlementV2: settlement }));
    throw error;
  }
}

export async function submitLiveAgentRegistration(
  agentId: string,
  optionsInput: Partial<LiveSettlementOptions> = {}
) {
  return await submitLiveAgentRegistrationV2(agentId, optionsInput);
}

export async function createCreditsDepositIntent(params: CreditsDepositIntentParams) {
  const ownerPublicKey = params.ownerPublicKey.trim();
  if (!ownerPublicKey) throw new Error('Missing ownerPublicKey.');
  const amountMina = Number(params.amountMina);
  if (!Number.isFinite(amountMina) || amountMina <= 0) {
    throw new Error('Invalid deposit amount.');
  }
  if (amountMina < creditsMinDeposit) {
    throw new Error(`Minimum deposit is ${creditsMinDeposit} MINA.`);
  }

  const coordinationTrees = await readCoordinationTreeState();
  const ownerHash = hashTextToField(ownerPublicKey);
  const amountField = Field.from(Math.round(amountMina * 1e9));
  const leaf = computeCreditsLeaf(ownerHash, amountField, Field(1));
  const commit = commitLeafToTree(coordinationTrees, 'creditsLeaves', 'nextCreditsIndex', leaf);
  const currentNullifierRoot = buildCoordinationTree(coordinationTrees.nullifierLeaves).getRoot();
  const oracleKey = await getOraclePrivateKey();
  const oraclePublicKey = oracleKey.toPublicKey().toBase58();
  const signature = signCreditsUpdate(oracleKey, Field.fromJSON(commit.root), currentNullifierRoot);
  const payloadV1 = {
    creditsRoot: commit.root,
    nullifierRoot: currentNullifierRoot.toJSON(),
    oraclePublicKey,
    signature,
    depositMina: amountMina
  };
  const payloadV2 = await buildV2CreditsPayload(Field.fromJSON(commit.root), currentNullifierRoot, {
    depositMina: amountMina
  });
  const ledger = await readCreditsLedger();
  const pendingKey = buildPendingDepositKey(ownerPublicKey, commit.root);
  ledger.pendingDeposits[pendingKey] = {
    ownerPublicKey,
    amountMina,
    creditsRoot: commit.root,
    nullifierRoot: currentNullifierRoot.toJSON(),
    createdAt: new Date().toISOString()
  };

  await writeCreditsLedger(ledger);
  await writeJson(coordinationTreesPath, coordinationTrees);

  return {
    ownerPublicKey,
    balanceMina: ledger.balances[ownerPublicKey] || 0,
    pendingDepositKey: pendingKey,
    contractVersion: 'v2',
    payload: payloadV2,
    payloadV1,
    payloadV2
  };
}

export async function createCreditsSpendIntent(params: CreditsSpendIntentParams) {
  const ownerPublicKey = params.ownerPublicKey.trim();
  const requestId = params.requestId.trim();
  const settlementStrategy = normalizeCreditsSettlementStrategy(params.settlementStrategy);
  if (!ownerPublicKey) throw new Error('Missing ownerPublicKey.');
  if (!requestId) throw new Error('Missing requestId.');
  const amountMina = Number(params.amountMina);
  if (!Number.isFinite(amountMina) || amountMina <= 0) {
    throw new Error('Invalid spend amount.');
  }

  const ledger = await readCreditsLedger();
  const currentBalance = ledger.balances[ownerPublicKey] || 0;
  if (currentBalance < amountMina) {
    throw new Error('Insufficient credits balance.');
  }

  const ownerHash = hashTextToField(ownerPublicKey);
  const nonceHash = hashTextToField(requestId);
  const nullifierKey = buildCreditsNullifierKey(ownerHash.toJSON(), nonceHash.toJSON());
  const nullifiers = await readCreditsNullifiers();
  if (nullifiers.nullifiers[nullifierKey]) {
    throw new Error('Credits nullifier already used for this requestId.');
  }

  const coordinationTrees = await readCoordinationTreeState();
  const nullifierCommit = commitLeafToTree(
    coordinationTrees,
    'nullifierLeaves',
    'nextNullifierIndex',
    computeNullifierLeaf(ownerHash, nonceHash)
  );
  const creditsCommit = commitLeafToTree(
    coordinationTrees,
    'creditsLeaves',
    'nextCreditsIndex',
    computeCreditsLeaf(ownerHash, Field.from(Math.round(amountMina * 1e9)), Field(0))
  );

  const defaultPlatformPayee = await getDefaultPlatformPayeePublicKey();
  const platformPayee = (params.platformPayee || defaultPlatformPayee || '').trim() || null;
  const spendTo = (params.spendTo || '').trim() || null;
  if (settlementStrategy === 'direct' && !spendTo) {
    throw new Error('Direct spend settlement requires spendTo.');
  }
  const oracleKey = await getOraclePrivateKey();
  const oraclePublicKey = oracleKey.toPublicKey().toBase58();
  const signedAmountField =
    settlementStrategy === 'checkpoint' ? Field(0) : Field.from(Math.round(amountMina * 1e9));
  const signedPlatformField =
    settlementStrategy === 'checkpoint' ? Field(0) : Field.from(Math.round(platformFeeMina * 1e9));
  const signature = signCreditsUpdate(
    oracleKey,
    Field.fromJSON(creditsCommit.root),
    Field.fromJSON(nullifierCommit.root),
    signedAmountField,
    signedPlatformField
  );

  ledger.balances[ownerPublicKey] = Math.max(0, currentBalance - amountMina);
  ledger.history.unshift({
    kind: 'credits-spent',
    ownerPublicKey,
    amountMina,
    timestamp: new Date().toISOString(),
    requestId,
    creditsRoot: creditsCommit.root,
    nullifierRoot: nullifierCommit.root
  });
  nullifiers.nullifiers[nullifierKey] = {
    requestId,
    ownerPublicKey,
    amountMina,
    createdAt: new Date().toISOString()
  };
  const intents = await readCreditsIntents();
  intents.intents[requestId] = {
    ownerPublicKey,
    requestId,
    amountMina,
    creditsRoot: creditsCommit.root,
    nullifierRoot: nullifierCommit.root,
    createdAt: new Date().toISOString(),
    spendTo,
    platformPayee,
    platformAmountMina: platformFeeMina
  };

  await writeCreditsLedger(ledger);
  await writeCreditsNullifiers(nullifiers);
  await writeCreditsIntents(intents);
  await writeJson(coordinationTreesPath, coordinationTrees);

  const payloadV1 = {
    creditsRoot: creditsCommit.root,
    nullifierRoot: nullifierCommit.root,
    oraclePublicKey,
    signature,
    depositMina: 0,
    spendTo: settlementStrategy === 'checkpoint' ? null : spendTo,
    spendAmountMina: settlementStrategy === 'checkpoint' ? 0 : amountMina,
    platformAmountMina: settlementStrategy === 'checkpoint' ? 0 : platformFeeMina,
    platformPayee: settlementStrategy === 'checkpoint' ? null : platformPayee
  };
  const payloadV2 = await buildV2CreditsPayload(
    Field.fromJSON(creditsCommit.root),
    Field.fromJSON(nullifierCommit.root),
    {
      depositMina: 0,
      spendTo: settlementStrategy === 'checkpoint' ? null : spendTo,
      spendAmountMina: settlementStrategy === 'checkpoint' ? 0 : amountMina,
      platformAmountMina: settlementStrategy === 'checkpoint' ? 0 : platformFeeMina,
      platformPayee: settlementStrategy === 'checkpoint' ? null : platformPayee
    }
  );

  return {
    ownerPublicKey,
    balanceMina: ledger.balances[ownerPublicKey],
    contractVersion: 'v2',
    settlementStrategy,
    payload: payloadV2,
    payloadV1,
    payloadV2
  };
}

export async function confirmCreditsDeposit(ownerPublicKey: string, creditsRoot: string, txHash: string) {
  const ledger = await readCreditsLedger();
  const pendingKey = buildPendingDepositKey(ownerPublicKey, creditsRoot);
  const pending = ledger.pendingDeposits[pendingKey];
  if (!pending) {
    throw new Error('No pending credits deposit for that owner and root.');
  }
  ledger.balances[ownerPublicKey] = (ledger.balances[ownerPublicKey] || 0) + pending.amountMina;
  ledger.history.unshift({
    kind: 'deposit-confirmed',
    ownerPublicKey,
    amountMina: pending.amountMina,
    timestamp: new Date().toISOString(),
    txHash,
    creditsRoot: pending.creditsRoot,
    nullifierRoot: pending.nullifierRoot
  });
  delete ledger.pendingDeposits[pendingKey];
  await writeCreditsLedger(ledger);
  return {
    ownerPublicKey,
    balanceMina: ledger.balances[ownerPublicKey],
    confirmed: true,
    txHash
  };
}

async function getCreditsOperatorItemById(id: string) {
  const queue = await readCreditsOperatorQueue();
  return queue.items.find((item) => item.id === id) || null;
}

export async function getCreditsOperatorQueueSnapshot() {
  const queue = await readCreditsOperatorQueue();
  const sponsorEnabled = await hasSponsorSubmissionCapability('credits');
  const localOperator = (await getOperatorRegistryRecordById(creditsOperatorId)) || (await ensureLocalOperatorRegistryEntry());
  return {
    queue,
    summary: summarizeCreditsOperatorQueue(queue),
    settings: {
      autoProcessMs: creditsOperatorAutoProcessMs,
      autoProcessingEnabled: creditsOperatorAutoProcessMs > 0,
      maxAttempts: creditsOperatorMaxAttempts,
      sponsorEnabled,
      operatorId: creditsOperatorId,
      operatorStatus: localOperator.status,
      leaseMs: creditsOperatorLeaseMs
    }
  };
}

async function updateCreditsOperatorItemById(
  id: string,
  update: (item: CreditsOperatorQueueItem) => CreditsOperatorQueueItem
): Promise<CreditsOperatorQueueItem | null> {
  return await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    const index = queue.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const next = update(queue.items[index]);
    queue.items[index] = next;
    await writeCreditsOperatorQueue(queue);
    return next;
  });
}

async function updateClaimedCreditsOperatorItemByLease(
  itemId: string,
  leaseId: string,
  update: (item: CreditsOperatorQueueItem) => CreditsOperatorQueueItem
): Promise<{ item: CreditsOperatorQueueItem | null; lostLease: boolean }> {
  return await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    const index = queue.items.findIndex((item) => item.id === itemId);
    if (index === -1) {
      return { item: null, lostLease: true };
    }
    const current = queue.items[index];
    if (!isCreditsOperatorLeaseOwnedBy(current, creditsOperatorId, leaseId)) {
      return { item: current, lostLease: true };
    }
    const next = update(current);
    queue.items[index] = next;
    await writeCreditsOperatorQueue(queue);
    return { item: next, lostLease: false };
  });
}

async function claimCreditsOperatorItemById(options: {
  itemId: string;
  settlementStrategy: CreditsSettlementStrategy;
  retryFailed: boolean;
  maxAttempts: number;
  leaseMs: number;
}) {
  return await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    const index = queue.items.findIndex((item) => item.id === options.itemId);
    if (index === -1) return null;
    const current = queue.items[index];
    if (
      !isCreditsOperatorItemClaimable(current, {
        settlementStrategy: options.settlementStrategy,
        retryFailed: options.retryFailed,
        maxAttempts: options.maxAttempts
      })
    ) {
      return current;
    }
    const claimedAt = nowIso();
    const next: CreditsOperatorQueueItem = {
      ...current,
      status: 'processing',
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: claimedAt,
      lastError: null,
      leaseOwnerId: creditsOperatorId,
      leaseId: crypto.randomUUID(),
      leaseAcquiredAt: claimedAt,
      leaseExpiresAt: plusMsIso(options.leaseMs),
      lastOperatorId: creditsOperatorId
    };
    queue.items[index] = next;
    await writeCreditsOperatorQueue(queue);
    return next;
  });
}

async function claimNextCreditsOperatorItem(options: {
  settlementStrategy: CreditsSettlementStrategy;
  retryFailed: boolean;
  maxAttempts: number;
  leaseMs: number;
}) {
  return await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    const nowMs = Date.now();
    const index = queue.items.findIndex((item) =>
      isCreditsOperatorItemClaimable(item, {
        settlementStrategy: options.settlementStrategy,
        retryFailed: options.retryFailed,
        maxAttempts: options.maxAttempts,
        nowMs
      })
    );
    if (index === -1) return null;
    const current = queue.items[index];
    const claimedAt = nowIso();
    const next: CreditsOperatorQueueItem = {
      ...current,
      status: 'processing',
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: claimedAt,
      lastError: null,
      leaseOwnerId: creditsOperatorId,
      leaseId: crypto.randomUUID(),
      leaseAcquiredAt: claimedAt,
      leaseExpiresAt: plusMsIso(options.leaseMs),
      lastOperatorId: creditsOperatorId
    };
    queue.items[index] = next;
    await writeCreditsOperatorQueue(queue);
    return next;
  });
}

async function claimCreditsCheckpointCandidates(options: {
  retryFailed: boolean;
  maxAttempts: number;
  maxBatchSize: number;
  leaseMs: number;
}) {
  return await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    const nowMs = Date.now();
    const candidates = queue.items
      .filter((item) =>
        isCreditsOperatorItemClaimable(item, {
          settlementStrategy: 'checkpoint',
          retryFailed: options.retryFailed,
          maxAttempts: options.maxAttempts,
          nowMs
        })
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, options.maxBatchSize);
    if (!candidates.length) return [] as CreditsOperatorQueueItem[];

    const candidateIds = new Set(candidates.map((item) => item.id));
    const claimId = crypto.randomUUID();
    const claimedAt = nowIso();
    queue.items = queue.items.map((item) =>
      candidateIds.has(item.id)
        ? {
            ...item,
            status: 'processing',
            attemptCount: item.attemptCount + 1,
            lastAttemptAt: claimedAt,
            lastError: null,
            leaseOwnerId: creditsOperatorId,
            leaseId: claimId,
            leaseAcquiredAt: claimedAt,
            leaseExpiresAt: plusMsIso(options.leaseMs),
            lastOperatorId: creditsOperatorId
          }
        : item
    );
    await writeCreditsOperatorQueue(queue);
    return queue.items.filter((item) => candidateIds.has(item.id));
  });
}

export async function enqueueCreditsOperatorItem(params: {
  payload: ZekoThresholdCreditsPayload;
  source: CreditsOperatorQueueItem['source'];
  settlementStrategy?: CreditsSettlementStrategy;
  kind?: CreditsOperatorItemKind;
  ownerPublicKey?: string | null;
  requestId?: string | null;
  pendingDepositKey?: string | null;
  idempotencyKey?: string | null;
  attribution?: RequestAttributionRecord | null;
}) {
  return await withCreditsOperatorCoordinationLock(async () => {
    const queue = await readCreditsOperatorQueue();
    const idempotencyKey =
      params.idempotencyKey?.trim() ||
      buildCreditsOperatorIdempotencyKey(params.payload, params.source, params.requestId || null);
    const existing = queue.items.find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      return {
        item: existing,
        deduped: true
      };
    }

    const item: CreditsOperatorQueueItem = {
      id: `credits-op-${crypto.randomUUID()}`,
      idempotencyKey,
      contractVersion: 'v2',
      kind: params.kind || inferCreditsOperatorKind(params.payload),
      settlementStrategy: params.settlementStrategy || 'direct',
      source: params.source,
      ownerPublicKey: params.ownerPublicKey?.trim() || null,
      requestId: params.requestId?.trim() || null,
      pendingDepositKey: params.pendingDepositKey?.trim() || null,
      payload: params.payload,
      createdAt: nowIso(),
      status: 'queued',
      attemptCount: 0,
      txHash: null,
      submittedAt: null,
      settledAt: null,
      lastAttemptAt: null,
      lastError: null,
      observedCreditsRoot: null,
      observedNullifierRoot: null,
      supersededBy: null,
      batchId: null,
      leaseOwnerId: null,
      leaseId: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      lastOperatorId: null,
      attribution: params.attribution || null
    };

    queue.items.push(item);
    await writeCreditsOperatorQueue(queue);
    return {
      item,
      deduped: false
    };
  });
}

async function settleCreditsDepositIfNeeded(item: CreditsOperatorQueueItem, txHash: string | null) {
  if (item.source !== 'deposit-intent' || !item.ownerPublicKey) return;
  try {
    await confirmCreditsDeposit(item.ownerPublicKey, item.payload.creditsRoot, txHash || item.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('No pending credits deposit')) {
      throw error;
    }
  }
}

async function processClaimedCreditsOperatorItem(
  item: CreditsOperatorQueueItem,
  optionsInput: Partial<LiveSettlementOptions> & { maxAttempts?: number } = {}
) {
  const options = normalizeLiveSettlementOptions(optionsInput);
  const leaseId = item.leaseId;
  if (!leaseId) {
    return item;
  }

  try {
    let chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (isCreditsPayloadApplied(item.payload, chainState)) {
      await settleCreditsDepositIfNeeded(item, item.txHash);
      const reconciled = await updateClaimedCreditsOperatorItemByLease(item.id, leaseId, (current) =>
        clearCreditsOperatorLease({
          ...current,
          status: 'settled',
          settledAt: current.settledAt || nowIso(),
          observedCreditsRoot: chainState?.zkappState[3] || null,
          observedNullifierRoot: chainState?.zkappState[4] || null,
          lastError: null,
          lastOperatorId: creditsOperatorId
        })
      );
      const result = reconciled.item || item;
      await markCreditsOperatorQueueProcessed(null);
      return result;
    }

    if ((item.payload.depositMina || 0) > 0) {
      throw new Error(
        'Credits operator sponsor lane only supports depositMina=0. Use /api/credits-tx for wallet-funded deposits.'
      );
    }

    const submission = await submitCreditsViaCreditsLaneV2(item.payload);
    const submittedAt = nowIso();
    const submitted = await updateClaimedCreditsOperatorItemByLease(item.id, leaseId, (current) => ({
      ...current,
      status: 'submitted',
      txHash: submission.hash,
      submittedAt,
      lastError: null,
      lastOperatorId: submission.route.operatorId || creditsOperatorId
    }));
    item = submitted.item || item;
    if (submitted.lostLease) {
      await markCreditsOperatorQueueProcessed(null);
      return item;
    }

    chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (options.waitForSettlement) {
      const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));
      const settledState = await waitForZkappStateValueV2(3, item.payload.creditsRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!settledState) {
        const txStatus = submission.hash
          ? await fetchZekoTransactionStatusV2(submission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `Credits operator item did not apply the expected credits root. txHash=${submission.hash ?? 'null'} txStatus=${JSON.stringify(txStatus)}`
        );
      }
      chainState = settledState;
    }

    const observedCreditsRoot = chainState?.zkappState[3] || null;
    const observedNullifierRoot = chainState?.zkappState[4] || null;
    const settled = isCreditsPayloadApplied(item.payload, chainState);

    if (settled) {
      await settleCreditsDepositIfNeeded(item, submission.hash);
    }

    const finalized = await updateClaimedCreditsOperatorItemByLease(item.id, leaseId, (current) => {
      const next: CreditsOperatorQueueItem = {
        ...current,
        status: settled ? 'settled' : 'submitted',
        txHash: submission.hash,
        submittedAt: current.submittedAt || submittedAt,
        settledAt: settled ? nowIso() : current.settledAt,
        observedCreditsRoot,
        observedNullifierRoot,
        lastError: null,
        lastOperatorId: submission.route.operatorId || creditsOperatorId
      };
      return settled ? clearCreditsOperatorLease(next) : next;
    });
    item = finalized.item || item;
    await markCreditsOperatorQueueProcessed(null);
    return item;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await updateClaimedCreditsOperatorItemByLease(item.id, leaseId, (current) =>
      clearCreditsOperatorLease({
        ...current,
        status: 'failed',
        lastError: message,
        lastOperatorId: creditsOperatorId
      })
    );
    item = failed.item || item;
    await markCreditsOperatorQueueProcessed(message);
    return item;
  }
}

export async function processCreditsOperatorItem(
  itemId: string,
  optionsInput: Partial<LiveSettlementOptions> & { maxAttempts?: number } = {}
) {
  const existing = await getCreditsOperatorItemById(itemId);
  if (!existing) {
    throw new Error('Credits operator item not found.');
  }
  if (existing.status === 'settled' || existing.status === 'superseded') {
    return existing;
  }

  const maxAttempts = Math.max(1, Number(optionsInput.maxAttempts ?? creditsOperatorMaxAttempts));
  if (existing.attemptCount >= maxAttempts && existing.status === 'failed') {
    return existing;
  }

  const claimed = await claimCreditsOperatorItemById({
    itemId,
    settlementStrategy: 'direct',
    retryFailed: true,
    maxAttempts,
    leaseMs: resolveCreditsOperatorLeaseMs(optionsInput)
  });
  if (!claimed) {
    throw new Error('Credits operator item not found.');
  }
  if (!isCreditsOperatorLeaseOwnedBy(claimed, creditsOperatorId)) {
    return claimed;
  }
  return await processClaimedCreditsOperatorItem(claimed, optionsInput);
}

export async function processCreditsOperatorQueue(
  optionsInput: Partial<LiveSettlementOptions> & { limit?: number; retryFailed?: boolean; maxAttempts?: number } = {}
) {
  if (creditsOperatorProcessing) {
    const queue = await readCreditsOperatorQueue();
    return {
      processing: true,
      processed: [] as CreditsOperatorQueueItem[],
      summary: summarizeCreditsOperatorQueue(queue)
    };
  }

  creditsOperatorProcessing = true;
  try {
    const limit = Math.max(1, Number(optionsInput.limit ?? 10));
    const retryFailed = optionsInput.retryFailed !== false;
    const maxAttempts = Math.max(1, Number(optionsInput.maxAttempts ?? creditsOperatorMaxAttempts));
    const leaseMs = resolveCreditsOperatorLeaseMs(optionsInput);

    const processed: CreditsOperatorQueueItem[] = [];
    for (let index = 0; index < limit; index += 1) {
      const claimed = await claimNextCreditsOperatorItem({
        settlementStrategy: 'direct',
        retryFailed,
        maxAttempts,
        leaseMs
      });
      if (!claimed) break;
      processed.push(await processClaimedCreditsOperatorItem(claimed, optionsInput));
    }

    const nextQueue = await withCreditsOperatorCoordinationLock(async () => {
      const queue = await readCreditsOperatorQueue();
      queue.lastProcessedAt = nowIso();
      queue.lastError = processed.some((item) => item.status === 'failed')
        ? processed
            .filter((item) => item.status === 'failed')
            .map((item) => item.lastError)
            .filter(Boolean)
            .join('; ')
        : null;
      await writeCreditsOperatorQueue(queue);
      return queue;
    });

    return {
      processing: false,
      processed,
      summary: summarizeCreditsOperatorQueue(nextQueue)
    };
  } finally {
    creditsOperatorProcessing = false;
  }
}

export async function getCreditsCheckpointBatchSnapshot() {
  const batchFile = await readCreditsCheckpointBatches();
  const localOperator = (await getOperatorRegistryRecordById(creditsOperatorId)) || (await ensureLocalOperatorRegistryEntry());
  return {
    batches: batchFile,
    summary: summarizeCreditsCheckpointBatches(batchFile),
    settings: {
      maxBatchSize: creditsCheckpointMaxBatchSize,
      operatorId: creditsOperatorId,
      operatorStatus: localOperator.status,
      leaseMs: creditsOperatorLeaseMs
    }
  };
}

export async function processCreditsCheckpointBatches(
  optionsInput: Partial<LiveSettlementOptions> & { maxBatchSize?: number; retryFailed?: boolean } = {}
) {
  const retryFailed = optionsInput.retryFailed !== false;
  const maxBatchSize = Math.max(1, Number(optionsInput.maxBatchSize ?? creditsCheckpointMaxBatchSize));
  const leaseMs = resolveCreditsOperatorLeaseMs(optionsInput);
  const candidates = await claimCreditsCheckpointCandidates({
    retryFailed,
    maxAttempts: creditsOperatorMaxAttempts,
    maxBatchSize,
    leaseMs
  });

  if (!candidates.length) {
    const batches = await readCreditsCheckpointBatches();
    return {
      processed: [] as CreditsOperatorQueueItem[],
      batch: null as CreditsCheckpointBatchRecord | null,
      summary: summarizeCreditsCheckpointBatches(batches)
    };
  }

  const candidateIds = candidates.map((item) => item.id);
  const anchor = candidates[candidates.length - 1];
  const leaseId = anchor.leaseId;
  if (!leaseId) {
    const batches = await readCreditsCheckpointBatches();
    return {
      processed: candidates,
      batch: null as CreditsCheckpointBatchRecord | null,
      summary: summarizeCreditsCheckpointBatches(batches)
    };
  }

  const finalizeBatch = async (params: {
    txHash: string | null;
    settled: boolean;
    observedCreditsRoot: string | null;
    observedNullifierRoot: string | null;
    lastError: string | null;
    submittedAt: string | null;
    operatorId?: string | null;
  }) => {
    return await withCreditsOperatorCoordinationLock(async () => {
      const queue = await readCreditsOperatorQueue();
      const ownedIds = new Set(
        queue.items
          .filter((item) => candidateIds.includes(item.id) && isCreditsOperatorLeaseOwnedBy(item, creditsOperatorId, leaseId))
          .map((item) => item.id)
      );
      if (ownedIds.size !== candidateIds.length) {
        const batches = await readCreditsCheckpointBatches();
        return {
          processed: queue.items.filter((item) => candidateIds.includes(item.id)),
          batch: null as CreditsCheckpointBatchRecord | null,
          summary: summarizeCreditsCheckpointBatches(batches)
        };
      }

      const batchId = `credits-checkpoint-${crypto.randomUUID()}`;
      const existingBatches = await readCreditsCheckpointBatches();
      const existingBatch =
        existingBatches.batches.find(
          (batch) =>
            batch.finalCreditsRoot === anchor.payload.creditsRoot &&
            batch.finalNullifierRoot === anchor.payload.nullifierRoot &&
            batch.itemIds.length === candidateIds.length &&
            batch.itemIds.every((id, index) => id === candidateIds[index])
        ) || null;
      const batchRecord: CreditsCheckpointBatchRecord =
        existingBatch || {
          id: batchId,
          createdAt: nowIso(),
          operatorId: params.operatorId || creditsOperatorId,
          itemIds: candidateIds,
          itemCount: candidates.length,
          txHash: params.txHash,
          finalCreditsRoot: anchor.payload.creditsRoot,
          finalNullifierRoot: anchor.payload.nullifierRoot,
          settledAt: params.settled ? nowIso() : null,
          observedCreditsRoot: params.observedCreditsRoot,
          observedNullifierRoot: params.observedNullifierRoot,
          status: params.settled ? 'settled' : 'submitted',
          lastError: params.lastError
        };

      queue.items = queue.items.map((item) => {
        if (!candidateIds.includes(item.id)) return item;
        if (item.id === anchor.id) {
          const next: CreditsOperatorQueueItem = {
            ...item,
            status: params.settled ? 'settled' : 'submitted',
            txHash: params.txHash,
            submittedAt: params.submittedAt || item.submittedAt,
            settledAt: params.settled ? nowIso() : item.settledAt,
            observedCreditsRoot: params.observedCreditsRoot,
            observedNullifierRoot: params.observedNullifierRoot,
            lastError: params.lastError,
            batchId: batchRecord.id,
            lastOperatorId: params.operatorId || creditsOperatorId
          };
          return params.settled ? clearCreditsOperatorLease(next) : next;
        }
        return clearCreditsOperatorLease({
          ...item,
          status: 'superseded',
          txHash: params.txHash,
          submittedAt: params.submittedAt || item.submittedAt,
          settledAt: params.settled ? nowIso() : item.settledAt,
          observedCreditsRoot: params.observedCreditsRoot,
          observedNullifierRoot: params.observedNullifierRoot,
          lastError: params.lastError,
          supersededBy: anchor.id,
          batchId: batchRecord.id,
          lastOperatorId: params.operatorId || creditsOperatorId
        });
      });
      await writeCreditsOperatorQueue(queue);

      if (!existingBatch) {
        existingBatches.batches.unshift(batchRecord);
      }
      existingBatches.lastProcessedAt = nowIso();
      existingBatches.lastError = params.lastError;
      await writeCreditsCheckpointBatches(existingBatches);

      return {
        processed: queue.items.filter((item) => candidateIds.includes(item.id)),
        batch: batchRecord,
        summary: summarizeCreditsCheckpointBatches(existingBatches)
      };
    });
  };

  try {
    let chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (isCreditsPayloadApplied(anchor.payload, chainState)) {
      return await finalizeBatch({
        txHash: anchor.txHash,
        settled: true,
        observedCreditsRoot: chainState?.zkappState[3] || null,
        observedNullifierRoot: chainState?.zkappState[4] || null,
        lastError: null,
        submittedAt: anchor.submittedAt
      });
    }

    const submission = await submitCreditsViaCreditsLaneV2(anchor.payload);
    const submittedAt = nowIso();
    const options = normalizeLiveSettlementOptions(optionsInput);
    if (options.waitForSettlement) {
      const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));
      const settledState = await waitForZkappStateValueV2(3, anchor.payload.creditsRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
      if (!settledState) {
        const txStatus = submission.hash
          ? await fetchZekoTransactionStatusV2(submission.hash)
          : { status: 'missing_hash' };
        throw new Error(
          `Checkpoint batch did not apply expected credits root. txHash=${submission.hash ?? 'null'} txStatus=${JSON.stringify(txStatus)}`
        );
      }
      chainState = settledState;
    }

    const observedCreditsRoot = chainState?.zkappState[3] || null;
    const observedNullifierRoot = chainState?.zkappState[4] || null;
    return await finalizeBatch({
      txHash: submission.hash,
      settled: isCreditsPayloadApplied(anchor.payload, chainState),
      observedCreditsRoot,
      observedNullifierRoot,
      lastError: null,
      submittedAt,
      operatorId: submission.route.operatorId || creditsOperatorId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withCreditsOperatorCoordinationLock(async () => {
      const failedQueue = await readCreditsOperatorQueue();
      failedQueue.items = failedQueue.items.map((item) =>
        candidateIds.includes(item.id) && isCreditsOperatorLeaseOwnedBy(item, creditsOperatorId, leaseId)
          ? clearCreditsOperatorLease({
              ...item,
              status: 'failed',
              lastError: message,
              lastOperatorId: creditsOperatorId
            })
          : item
      );
      await writeCreditsOperatorQueue(failedQueue);

      const batches = await readCreditsCheckpointBatches();
      batches.lastProcessedAt = nowIso();
      batches.lastError = message;
      await writeCreditsCheckpointBatches(batches);
    });
    throw error;
  }
}

function ensureCreditsOperatorWorker() {
  if (creditsOperatorWorkerStarted || creditsOperatorAutoProcessMs <= 0) return;
  creditsOperatorWorkerStarted = true;
  const timer = setInterval(() => {
    void (async () => {
      if (!(await hasSponsorSubmissionCapability('credits'))) return;
      await heartbeatOperatorRegistryRecord(creditsOperatorId).catch(() => undefined);
      await processCreditsCheckpointBatches({
        maxBatchSize: creditsCheckpointMaxBatchSize,
        waitForSettlement: true,
        retryFailed: true
      });
      await processCreditsOperatorQueue({
        limit: 1,
        waitForSettlement: true,
        retryFailed: true
      });
    })().catch(() => undefined);
  }, creditsOperatorAutoProcessMs);
  (timer as any).unref?.();
}

async function getCreditsDepositMonitorById(id: string) {
  const monitors = await readCreditsDepositMonitors();
  return monitors.items.find((item) => item.id === id) || null;
}

async function updateCreditsDepositMonitorById(
  id: string,
  update: (item: CreditsDepositMonitorItem) => CreditsDepositMonitorItem
): Promise<CreditsDepositMonitorItem | null> {
  const monitors = await readCreditsDepositMonitors();
  const index = monitors.items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const next = update(monitors.items[index]);
  monitors.items[index] = next;
  await writeCreditsDepositMonitors(monitors);
  return next;
}

export async function getCreditsDepositMonitorSnapshot() {
  const monitors = await readCreditsDepositMonitors();
  return {
    monitors,
    summary: summarizeCreditsDepositMonitors(monitors),
    settings: {
      autoProcessMs: creditsDepositMonitorAutoProcessMs,
      autoProcessingEnabled: creditsDepositMonitorAutoProcessMs > 0,
      maxAttempts: creditsDepositMonitorMaxAttempts
    }
  };
}

export async function enqueueCreditsDepositMonitor(params: {
  ownerPublicKey: string;
  creditsRoot: string;
  txHash: string;
  idempotencyKey?: string | null;
  attribution?: RequestAttributionRecord | null;
}) {
  const ownerPublicKey = params.ownerPublicKey.trim();
  const creditsRoot = params.creditsRoot.trim();
  const txHash = params.txHash.trim();
  if (!ownerPublicKey || !creditsRoot || !txHash) {
    throw new Error('Missing ownerPublicKey, creditsRoot, or txHash.');
  }

  const ledger = await readCreditsLedger();
  const pending = ledger.pendingDeposits[buildPendingDepositKey(ownerPublicKey, creditsRoot)];
  if (!pending) {
    throw new Error('No pending credits deposit for that owner and root.');
  }

  const monitors = await readCreditsDepositMonitors();
  const idempotencyKey =
    params.idempotencyKey?.trim() || buildCreditsDepositMonitorIdempotencyKey(ownerPublicKey, creditsRoot, txHash);
  const existing = monitors.items.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    return {
      item: existing,
      deduped: true
    };
  }

  const item: CreditsDepositMonitorItem = {
    id: `credits-deposit-${crypto.randomUUID()}`,
    idempotencyKey,
    contractVersion: 'v2',
    ownerPublicKey,
    creditsRoot,
    nullifierRoot: pending.nullifierRoot,
    txHash,
    createdAt: new Date().toISOString(),
    status: 'queued',
    attemptCount: 0,
    settledAt: null,
    confirmedAt: null,
    lastAttemptAt: null,
    lastError: null,
    observedCreditsRoot: null,
    observedNullifierRoot: null,
    attribution: params.attribution || null
  };

  monitors.items.push(item);
  await writeCreditsDepositMonitors(monitors);
  return {
    item,
    deduped: false
  };
}

export async function processCreditsDepositMonitorItem(
  itemId: string,
  optionsInput: Partial<LiveSettlementOptions> & { maxAttempts?: number } = {}
) {
  const existing = await getCreditsDepositMonitorById(itemId);
  if (!existing) {
    throw new Error('Credits deposit monitor item not found.');
  }
  if (existing.status === 'confirmed') {
    return existing;
  }

  const options = normalizeLiveSettlementOptions(optionsInput);
  const maxAttempts = Math.max(1, Number(optionsInput.maxAttempts ?? creditsDepositMonitorMaxAttempts));
  if (existing.attemptCount >= maxAttempts && existing.status === 'failed') {
    return existing;
  }

  let item =
    (await updateCreditsDepositMonitorById(itemId, (current) => ({
      ...current,
      status: 'monitoring',
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: null
    }))) || existing;

  try {
    let chainState = await fetchZkappAccountStateV2().catch(() => null);
    if (options.waitForSettlement) {
      const attempts = Math.max(1, Math.ceil(options.waitTimeoutMs / options.pollIntervalMs));
      chainState = await waitForZkappStateValueV2(3, item.creditsRoot, {
        attempts,
        pollIntervalMs: options.pollIntervalMs
      });
    }

    const observedCreditsRoot = chainState?.zkappState[3] || null;
    const observedNullifierRoot = chainState?.zkappState[4] || null;
    const settled = observedCreditsRoot === item.creditsRoot && observedNullifierRoot === item.nullifierRoot;

    if (!settled) {
      item =
        (await updateCreditsDepositMonitorById(item.id, (current) => ({
          ...current,
          status: 'monitoring',
          observedCreditsRoot,
          observedNullifierRoot,
          lastError: null
        }))) || item;
      await markCreditsDepositMonitorsProcessed(null);
      return item;
    }

    try {
      await confirmCreditsDeposit(item.ownerPublicKey, item.creditsRoot, item.txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('No pending credits deposit')) {
        throw error;
      }
    }

    item =
      (await updateCreditsDepositMonitorById(item.id, (current) => ({
        ...current,
        status: 'confirmed',
        settledAt: current.settledAt || new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        observedCreditsRoot,
        observedNullifierRoot,
        lastError: null
      }))) || item;
    await markCreditsDepositMonitorsProcessed(null);
    return item;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    item =
      (await updateCreditsDepositMonitorById(item.id, (current) => ({
        ...current,
        status: 'failed',
        lastError: message
      }))) || item;
    await markCreditsDepositMonitorsProcessed(message);
    return item;
  }
}

export async function processCreditsDepositMonitorQueue(
  optionsInput: Partial<LiveSettlementOptions> & { limit?: number; retryFailed?: boolean; maxAttempts?: number } = {}
) {
  if (creditsDepositMonitorProcessing) {
    const monitors = await readCreditsDepositMonitors();
    return {
      processing: true,
      processed: [] as CreditsDepositMonitorItem[],
      summary: summarizeCreditsDepositMonitors(monitors)
    };
  }

  creditsDepositMonitorProcessing = true;
  try {
    const monitors = await readCreditsDepositMonitors();
    const limit = Math.max(1, Number(optionsInput.limit ?? 10));
    const retryFailed = optionsInput.retryFailed !== false;
    const maxAttempts = Math.max(1, Number(optionsInput.maxAttempts ?? creditsDepositMonitorMaxAttempts));
    const candidates = monitors.items
      .filter(
        (item) =>
          item.status === 'queued' ||
          item.status === 'monitoring' ||
          (retryFailed && item.status === 'failed' && item.attemptCount < maxAttempts)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);

    const processed: CreditsDepositMonitorItem[] = [];
    for (const candidate of candidates) {
      processed.push(await processCreditsDepositMonitorItem(candidate.id, optionsInput));
    }

    const nextMonitors = await readCreditsDepositMonitors();
    nextMonitors.lastProcessedAt = new Date().toISOString();
    nextMonitors.lastError = processed.some((item) => item.status === 'failed')
      ? processed.filter((item) => item.status === 'failed').map((item) => item.lastError).filter(Boolean).join('; ')
      : null;
    await writeCreditsDepositMonitors(nextMonitors);

    return {
      processing: false,
      processed,
      summary: summarizeCreditsDepositMonitors(nextMonitors)
    };
  } finally {
    creditsDepositMonitorProcessing = false;
  }
}

function ensureCreditsDepositMonitorWorker() {
  if (creditsDepositMonitorWorkerStarted || creditsDepositMonitorAutoProcessMs <= 0) return;
  creditsDepositMonitorWorkerStarted = true;
  const timer = setInterval(() => {
    void processCreditsDepositMonitorQueue({
      limit: 5,
      waitForSettlement: false,
      retryFailed: true
    }).catch(() => undefined);
  }, creditsDepositMonitorAutoProcessMs);
  (timer as any).unref?.();
}

export async function createBatch(inferenceIds?: string[]) {
  const inferencesFile = await readJson<InferencesFile>(inferencesPath, { inferences: [] });
  const selected = (inferenceIds?.length
    ? inferencesFile.inferences.filter((entry) => inferenceIds.includes(entry.id))
    : inferencesFile.inferences.filter(
        (entry) => entry.settlementMode === 'SETTLE_BATCH' && !entry.futureEthereum.batchId
      )
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (!selected.length) {
    throw new Error('No eligible batch-mode inferences found.');
  }

  const batchId = `batch_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const receiptHashes = selected.map((entry) => entry.receiptHash);
  const batchHash = hashJsonToField({ batchId, receiptHashes, createdAt }).toJSON();
  const metadataHash = hashJsonToField(
    selected.map((entry) => ({
      id: entry.id,
      modelId: entry.modelId,
      requestHash: entry.requestHash,
      outputHash: entry.outputHash
    }))
  ).toJSON();

  const futureEthereum = createFutureEthereumEnvelope('SETTLE_BATCH');
  futureEthereum.batchId = batchId;
  futureEthereum.batchHash = batchHash;
  futureEthereum.notes.push('Batch receipt is ready to be translated into an Ethereum blob/evaluation claim later.');

  const batchRecord: BatchRecord = {
    id: batchId,
    createdAt,
    inferenceIds: selected.map((entry) => entry.id),
    settlementMode: 'SETTLE_BATCH',
    batchHash,
    metadataHash,
    receiptHashes,
    futureEthereum
  };

  const updatedInferences = inferencesFile.inferences.map((entry) => {
    if (!batchRecord.inferenceIds.includes(entry.id)) return entry;
    return {
      ...entry,
      futureEthereum: {
        ...entry.futureEthereum,
        batchId,
        batchHash
      }
    };
  });

  const batchesFile = await readJson<BatchesFile>(batchesPath, { batches: [] });
  batchesFile.batches.unshift(batchRecord);

  await writeJson(inferencesPath, { inferences: updatedInferences });
  await writeJson(batchesPath, batchesFile);

  return batchRecord;
}

function filterInferencesForAccess(inferencesFile: InferencesFile, access: RequestAccessContext | null): InferencesFile {
  if (!access || access.role !== 'builder') {
    return inferencesFile;
  }
  return {
    ...inferencesFile,
    inferences: inferencesFile.inferences.filter((entry) => builderOwnsAttribution(access, entry.attribution))
  };
}

function filterAgentsForAccess(agentsFile: AgentRegistrationsFile, access: RequestAccessContext | null): AgentRegistrationsFile {
  if (!access || access.role !== 'builder') {
    return agentsFile;
  }
  return {
    ...agentsFile,
    agents: agentsFile.agents.filter((entry) => builderOwnsAttribution(access, entry.attribution))
  };
}

async function getVisibleInferenceById(req: Request, id: string) {
  const inference = await getInferenceById(id);
  if (!inference) return null;
  return builderOwnsAttribution(getRequestAccessContext(req), inference.attribution) ? inference : null;
}

async function getVisibleInferenceByStatusToken(req: Request, token: string) {
  const inference = await getInferenceByStatusToken(token);
  if (!inference) return null;
  return builderOwnsAttribution(getRequestAccessContext(req), inference.attribution) ? inference : null;
}

async function getVisibleAgentById(req: Request, id: string) {
  const agent = await getAgentById(id);
  if (!agent) return null;
  return builderOwnsAttribution(getRequestAccessContext(req), agent.attribution) ? agent : null;
}

async function getVisibleCreditsOperatorItemById(req: Request, id: string) {
  const item = await getCreditsOperatorItemById(id);
  if (!item) return null;
  return builderOwnsAttribution(getRequestAccessContext(req), item.attribution) ? item : null;
}

async function getVisibleCreditsDepositMonitorById(req: Request, id: string) {
  const item = await getCreditsDepositMonitorById(id);
  if (!item) return null;
  return builderOwnsAttribution(getRequestAccessContext(req), item.attribution) ? item : null;
}

async function getVisibleCreditsQueueSnapshot(req: Request) {
  const access = getRequestAccessContext(req);
  const snapshot = await getCreditsOperatorQueueSnapshot();
  if (!access || access.role !== 'builder') {
    return snapshot;
  }
  const queue = {
    ...snapshot.queue,
    items: snapshot.queue.items.filter((entry) => builderOwnsAttribution(access, entry.attribution))
  };
  return {
    ...snapshot,
    queue,
    summary: summarizeCreditsOperatorQueue(queue)
  };
}

async function getVisibleCreditsDepositMonitorSnapshot(req: Request) {
  const access = getRequestAccessContext(req);
  const snapshot = await getCreditsDepositMonitorSnapshot();
  if (!access || access.role !== 'builder') {
    return snapshot;
  }
  const monitors = {
    ...snapshot.monitors,
    items: snapshot.monitors.items.filter((entry) => builderOwnsAttribution(access, entry.attribution))
  };
  return {
    ...snapshot,
    monitors,
    summary: summarizeCreditsDepositMonitors(monitors)
  };
}

async function getVisibleCreditsCheckpointBatchSnapshot(req: Request) {
  const access = getRequestAccessContext(req);
  const snapshot = await getCreditsCheckpointBatchSnapshot();
  if (!access || access.role !== 'builder') {
    return snapshot;
  }
  const queue = await readCreditsOperatorQueue();
  const visibleBatchIds = new Set(
    queue.items
      .filter((entry) => builderOwnsAttribution(access, entry.attribution))
      .map((entry) => entry.batchId)
      .filter((entry): entry is string => Boolean(entry))
  );
  const batches = {
    ...snapshot.batches,
    batches: snapshot.batches.batches.filter((entry) => visibleBatchIds.has(entry.id))
  };
  return {
    ...snapshot,
    batches,
    summary: summarizeCreditsCheckpointBatches(batches)
  };
}

function buildAuthMeResponse(req: Request) {
  const access = getRequestAccessContext(req);
  if (!access) {
    return {
      authenticated: false,
      principal: null
    };
  }
  return {
    authenticated: true,
    principal: {
      role: access.role,
      id: access.principalId,
      label: access.principalLabel,
      authMode: access.authMode,
      scopes: access.scopes[0] === '*' ? ['*'] : access.scopes
    },
    usage:
      access.role === 'builder' && access.builder && access.usage
        ? getBuilderUsageStatus(access.builder, access.usage)
        : null
  };
}

function stringifyInferenceOutput(output: unknown) {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    if (typeof (output as any).text === 'string') return String((output as any).text);
    if (typeof (output as any).content === 'string') return String((output as any).content);
  }
  return JSON.stringify(output, null, 2);
}

function extractPromptFromCompatMessages(messages: unknown) {
  if (!Array.isArray(messages)) return '';
  return messages
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const role = typeof (entry as any).role === 'string' ? String((entry as any).role).trim() : 'user';
      const content = typeof (entry as any).content === 'string' ? String((entry as any).content).trim() : '';
      if (!content) return null;
      return `${role}: ${content}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join('\n');
}

function normalizeCompatInferenceRequest(body: Record<string, unknown>, mode: 'inference' | 'chat') {
  const prompt =
    typeof body.prompt === 'string' && body.prompt.trim().length > 0
      ? body.prompt.trim()
      : extractPromptFromCompatMessages(body.messages);
  const scalarInput = typeof body.input === 'undefined' ? undefined : body.input;
  const objectInputs =
    typeof body.inputs === 'object' && body.inputs !== null
      ? (body.inputs as Record<string, unknown>)
      : typeof body.input === 'object' && body.input !== null && !Array.isArray(body.input)
        ? (body.input as Record<string, unknown>)
        : {};
  const inputs: Record<string, unknown> =
    mode === 'chat'
      ? {
          messages: Array.isArray(body.messages) ? body.messages : [],
          ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
          ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
          ...(typeof body.top_p === 'number' ? { top_p: body.top_p } : {}),
          ...objectInputs
        }
      : {
          ...objectInputs,
          ...(typeof scalarInput !== 'undefined' && (typeof scalarInput !== 'object' || scalarInput === null || Array.isArray(scalarInput))
            ? { input: scalarInput }
            : {}),
          ...(body.metadata && typeof body.metadata === 'object' ? { metadata: body.metadata } : {})
        };

  return {
    modelId: String(body.modelId || body.model || '').trim(),
    prompt,
    inputs,
    settlementMode: normalizeSettlementMode(body.settlementMode ?? body.settlement_mode),
    clientEncryptionPublicKeyPem:
      typeof body.clientEncryptionPublicKeyPem === 'string'
        ? body.clientEncryptionPublicKeyPem
        : typeof body.client_encryption_public_key_pem === 'string'
          ? body.client_encryption_public_key_pem
          : undefined,
    publishToDa:
      body.publishToDa === true ||
      body.publish_to_da === true ||
      body.publishToDa === 'true' ||
      body.publish_to_da === 'true',
    waitForSettlement:
      body.waitForSettlement === true ||
      body.wait_for_settlement === true ||
      body.waitForSettlement === 'true' ||
      body.wait_for_settlement === 'true',
    live:
      body.live === true ||
      body.live_settlement === true ||
      body.liveSettlement === true ||
      body.settle === true,
    statusToken:
      typeof body.statusToken === 'string'
        ? body.statusToken
        : typeof body.status_token === 'string'
          ? body.status_token
          : undefined,
    callbackUrl:
      typeof body.callbackUrl === 'string'
        ? body.callbackUrl
        : typeof body.callback_url === 'string'
          ? body.callback_url
          : undefined,
    callbackMode:
      typeof body.callbackMode === 'string'
        ? normalizeInferenceCallbackMode(body.callbackMode)
        : normalizeInferenceCallbackMode(body.callback_mode)
  };
}

function buildCompatModelResponse(model: ModelRecord) {
  return {
    id: model.id,
    object: 'model',
    created_at: model.createdAt,
    name: model.name,
    version: model.version,
    description: model.description,
    verification_method: model.verificationMethod,
    transport_mode: model.transportMode,
    settlement_mode_default: model.settlementModeDefault,
    tags: model.tags
  };
}

function buildCompatInferenceResponse(inference: InferenceRecord, req?: Request) {
  const status = buildInferenceStatusSnapshot(inference, req);
  return {
    id: inference.id,
    object: 'compat.inference',
    created_at: inference.createdAt,
    request_id: status.requestId,
    model: {
      id: inference.modelId,
      name: inference.modelName,
      verification_method: inference.verificationMethod,
      transport_mode: inference.transportMode
    },
    prompt: inference.prompt,
    input: inference.inputs,
    output: inference.output,
    encrypted_output: inference.encryptedOutput,
    metadata: inference.metadata,
    status: status.status,
    status_token: status.statusToken,
    status_path: status.statusPath,
    status_url: status.statusUrl,
    callback: status.callback,
    settlement: status.settlement,
    privacy: inference.privacy,
    compatibility: {
      surface: 'reference-protocol',
      settlement_backend: 'zeko-native-v2'
    }
  };
}

function buildCompatReceiptResponse(inference: InferenceRecord, req?: Request) {
  const status = buildInferenceStatusSnapshot(inference, req);
  return {
    object: 'compat.receipt',
    inference_id: inference.id,
    request_id: status.requestId,
    status: status.status,
    status_token: status.statusToken,
    status_path: status.statusPath,
    status_url: status.statusUrl,
    settlement: status.settlement,
    links: status.links,
    attestations: inference.attestations
  };
}

function buildCompatChatCompletionResponse(inference: InferenceRecord, req?: Request) {
  const content = stringifyInferenceOutput(inference.output);
  const status = buildInferenceStatusSnapshot(inference, req);
  return {
    id: inference.id,
    object: 'chat.completion',
    created: Math.floor(new Date(inference.createdAt).getTime() / 1_000),
    model: inference.modelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content
        },
        finish_reason: 'stop'
      }
    ],
    request_id: status.requestId,
    status: status.status,
    status_token: status.statusToken,
    status_path: status.statusPath,
    status_url: status.statusUrl,
    settlement: status.settlement,
    inference: buildCompatInferenceResponse(inference, req)
  };
}

function buildMcpToolsList() {
  return [
    {
      name: 'auth_me',
      description: 'Inspect the authenticated builder or operator principal.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'list_models',
      description: 'List coordinator models through the compatibility surface.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'get_routing',
      description: 'Return the current lane routing snapshot for request, output, registry, and credits lanes.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'create_inference',
      description: 'Create an inference receipt or live-settled inference through the native coordinator.',
      inputSchema: {
        type: 'object',
        required: ['modelId', 'prompt'],
        properties: {
          modelId: { type: 'string' },
          prompt: { type: 'string' },
          inputs: { type: 'object', additionalProperties: true },
          live: { type: 'boolean' },
          waitForSettlement: { type: 'boolean' }
        }
      }
    },
    {
      name: 'get_inference',
      description: 'Read one inference in the compatibility response shape.',
      inputSchema: {
        type: 'object',
        required: ['inferenceId'],
        properties: {
          inferenceId: { type: 'string' }
        }
      }
    },
    {
      name: 'get_status',
      description: 'Read builder-friendly request status by inference id or opaque status token.',
      inputSchema: {
        type: 'object',
        properties: {
          inferenceId: { type: 'string' },
          statusToken: { type: 'string' }
        }
      }
    }
  ];
}

function buildMcpSuccess(id: unknown, result: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result
  };
}

function buildMcpError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(typeof data === 'undefined' ? {} : { data })
    }
  };
}

app.get('/health', async (_req, res) => {
  try {
    await ensureStore();
    const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
    const inferencesFile = await readJson<InferencesFile>(inferencesPath, { inferences: [] });
    const batchesFile = await readJson<BatchesFile>(batchesPath, { batches: [] });
    const treeState = await readJson<TreeState>(treeStatePath, defaultTreeState());
    const coordinationTrees = await readCoordinationTreeState();
    const agentsFile = await readAgentsFile();
    const creditsLedger = await readCreditsLedger();
    const creditsOperator = await getCreditsOperatorQueueSnapshot();
    const creditsDeposits = await getCreditsDepositMonitorSnapshot();
    const creditsCheckpointBatches = await getCreditsCheckpointBatchSnapshot();
    const operatorRegistry = await getOperatorRegistrySnapshot();
    const oraclePublicKey = (await getOraclePrivateKey()).toPublicKey().toBase58();
    const attesterFile = await ensureAttesterKeys();
    res.json({
      ok: true,
      app: 'Zeko AI Runtime',
      models: modelsFile.models.length,
      inferences: inferencesFile.inferences.length,
      batches: batchesFile.batches.length,
      agents: agentsFile.agents.length,
      oraclePublicKey,
      attesters: {
        available: attesterFile.attesters.length,
        quorum: Math.min(attesterFile.quorum, attesterFile.attesters.length)
      },
      da: {
        endpointConfigured: Boolean(daEndpoint),
        schema: daSchema,
        appId: daAppId
      },
      currentRoots: {
        requestRoot: buildTree(treeState.requestLeaves).getRoot().toJSON(),
        outputRoot: buildTree(treeState.outputLeaves).getRoot().toJSON(),
        agentRoot: buildCoordinationTree(coordinationTrees.agentLeaves).getRoot().toJSON(),
        creditsRoot: buildCoordinationTree(coordinationTrees.creditsLeaves).getRoot().toJSON(),
        nullifierRoot: buildCoordinationTree(coordinationTrees.nullifierLeaves).getRoot().toJSON()
      },
      credits: {
        creditedWallets: Object.keys(creditsLedger.balances).length,
        pendingDeposits: Object.keys(creditsLedger.pendingDeposits).length
      },
      creditsOperator: {
        ...creditsOperator.settings,
        summary: creditsOperator.summary
      },
      creditsDeposits: {
        ...creditsDeposits.settings,
        summary: creditsDeposits.summary
      },
      creditsCheckpointBatches: {
        ...creditsCheckpointBatches.settings,
        summary: creditsCheckpointBatches.summary
      },
      operatorRegistry: {
        localOperatorId: operatorRegistry.localOperatorId,
        summary: operatorRegistry.summary,
        localOperator: operatorRegistry.localOperator
      },
      sponsorLanes: listSponsorLaneStatuses(),
      zekoNetwork
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/architecture', async (_req, res) => {
  const attesterFile = await ensureAttesterKeys();
  res.json({
    product: 'Zeko AI Runtime',
    reverseEngineeredFrom: [
      'https://www.opengradient.ai/',
      'https://docs.opengradient.ai/about/',
      'https://docs.opengradient.ai/learn/architecture/',
      'https://docs.opengradient.ai/learn/onchain_inference/llm_execution.html',
      'https://docs.opengradient.ai/learn/onchain_inference/da.html',
      'https://docs.opengradient.ai/developers/'
    ],
    corePosition: {
      sdkAndMcpAreClients: true,
      preferredPermissionlessTransport: 'HTTP_X402',
      settlementLedger: 'Zeko testnet now, Ethereum later',
      privacyUpgrade: 'client-encrypted outputs plus commitment-first DA publication',
      decentralizationUpgrade: `threshold settlement attestations with quorum ${Math.min(attesterFile.quorum, attesterFile.attesters.length)} of ${attesterFile.attesters.length}`
    },
    mapping: [
      {
        opengradient: 'Inference nodes execute requests quickly off-chain',
        zekoPrototype: 'Model endpoints or local mock models return outputs immediately'
      },
      {
        opengradient: 'Full nodes verify proofs and record settlement',
        zekoPrototype:
          'Request and output receipts are anchored into Zeko-oriented Merkle roots, while a quorum of attesters signs the receipt digest'
      },
      {
        opengradient: 'Settlement modes control on-chain visibility',
        zekoPrototype:
          'Each inference carries SETTLE_INDIVIDUAL, SETTLE_BATCH, or SETTLE_INDIVIDUAL_WITH_METADATA semantics'
      },
      {
        opengradient: 'Python SDK and x402 help developers integrate',
        zekoPrototype:
          'SDK or MCP are optional clients, but HTTP-style transport and wallet-verifiable receipts remain the actual interoperability layer'
      },
      {
        opengradient: 'TEE attestation proves trusted execution',
        zekoPrototype:
          'Threshold attestations remove the single-signer settlement bottleneck, while execution honesty still needs TEE, zkML, MPC, or FHE for full trustlessness'
      }
    ],
    privacyRealityCheck: {
      fullyPrivateAndTrustlessToday: false,
      closestPracticalPath: [
        'client-encrypt outputs and publish ciphertext only',
        'use threshold attestations or real TEE quotes for settlement',
        'move small deterministic models to zkML when feasible',
        'use TEEs or MPC for large LLM execution until zkML catches up'
      ]
    },
    futureEthereumPath: {
      dataAvailability: 'EIP-4844 blobs',
      bridgeShape:
        'Batch or receipt export should become a blob-equivalence claim bound to the same witness that Zeko commits today.',
      status: 'planned'
    },
    zekoNetwork
  });
});

app.get('/api/trustless-design', async (_req, res) => {
  const attesterFile = await ensureAttesterKeys();
  res.json({
    recommendation: 'Treat MCP and SDK as convenience layers, not trust layers.',
    bestTransport: {
      choice: 'HTTP_X402',
      why: [
        'Most permissionless: standard HTTP semantics instead of app-specific SDK lock-in.',
        'Works across languages and wallets.',
        'Can be wrapped by SDKs or MCP tools later without changing the settlement format.'
      ]
    },
    trustMinimization: [
      'Quorum attestations reduce single-operator control over settlement.',
      'Client-encrypted outputs keep stored results private from DA and indexers.',
      'Commitment-first publishing lets Zeko store hashes while encrypted blobs live off-chain.',
      'Ethereum settlement metadata is attached early so the format does not need to change later.'
    ],
    honestLimits: [
      'If the model runs outside zkML, MPC, FHE, or a verified TEE, execution is not fully trustless.',
      'MCP server access is useful for analytics and automation, but it does not make inference more decentralized on its own.'
    ],
    attesters: {
      available: attesterFile.attesters.length,
      quorum: Math.min(attesterFile.quorum, attesterFile.attesters.length)
    }
  });
});

app.get(['/api/ai-protocol-critique', '/api/opengradient-critique'], (_req, res) => {
  res.json({
    sources: [
      'https://docs.opengradient.ai/about/',
      'https://docs.opengradient.ai/learn/architecture/',
      'https://docs.opengradient.ai/learn/architecture/inference_nodes.html',
      'https://docs.opengradient.ai/learn/architecture/full_nodes.html',
      'https://docs.opengradient.ai/learn/architecture/data_nodes',
      'https://docs.opengradient.ai/learn/architecture/storage_nodes.html',
      'https://docs.opengradient.ai/learn/onchain_inference/llm_execution.html',
      'https://docs.opengradient.ai/learn/network/consensus.html',
      'https://docs.opengradient.ai/learn/network/deployment.html'
    ],
    inevitable: [
      'Execution and verification must be separated for GPU-heavy, non-deterministic inference.',
      'Specialized node roles are the practical way to scale AI workloads without forcing every validator to own GPUs.',
      'Large models and proofs need off-chain storage and local caching.'
    ],
    breakpoints: [
      'TEE proxying to external LLM providers does not obviously give end-to-end private inference against the provider itself.',
      'Asynchronous settlement is awkward for actions that must be final before execution, like irreversible financial operations.',
      'The permissionless story weakens where critical node types remain non-public, incomplete, or custom-node-only.',
      'Private-model support falls back to custom inference nodes, which is a different trust model from shared public serving.',
      'Using Base Sepolia for payment and a separate OpenGradient chain for verification adds cross-domain fragility.'
    ],
    fragileAssumptions: [
      'TEE attestation equals fully trustless inference correctness.',
      'Underlying providers cannot meaningfully correlate or learn from proxied requests.',
      'Developers and users will accept split payment and verification networks indefinitely.',
      'External data trust can be solved primarily by enclave wrapping.',
      'TEE-based verification will be enough for increasingly high-stakes AI workflows.'
    ],
    stance:
      'The architecture is directionally right and probably necessary, but its strongest privacy and trustlessness interpretation does not hold for large-model execution today.'
  });
});

app.get('/api/crypto/generate-client-keypair', (_req, res) => {
  res.json(generateClientKeypair());
});

app.get('/api/private-lane/config', async (_req, res) => {
  res.json(await getPrivateLaneConfig());
});

app.get('/api/zeko/config', (_req, res) => {
  res.json(getZekoRuntimeConfigV2());
});

app.get('/api/zeko/v1/config', (_req, res) => {
  res.json(getZekoRuntimeConfig());
});

app.get('/api/zeko/v2/config', (_req, res) => {
  res.json(getZekoRuntimeConfigV2());
});

app.get('/api/zeko/preflight', async (_req, res) => {
  try {
    const preflight = await getZekoPreflightV2();
    res.status(preflight.ok ? 200 : 400).json(preflight);
  } catch (error) {
    res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.get('/api/zeko/v1/preflight', async (_req, res) => {
  try {
    const preflight = await getZekoPreflight();
    res.status(preflight.ok ? 200 : 400).json(preflight);
  } catch (error) {
    res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.get('/api/zeko/v2/preflight', async (_req, res) => {
  try {
    const preflight = await getZekoPreflightV2();
    res.status(preflight.ok ? 200 : 400).json(preflight);
  } catch (error) {
    res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/zeko/status', async (req, res) => {
  try {
    const hash = String(req.body?.hash || '').trim();
    if (!hash) throw new Error('Missing transaction hash.');
    const status = await fetchZekoTransactionStatus(hash);
    res.json(status);
  } catch (error) {
    res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.get('/api/coordination/state', async (_req, res) => {
  const coordinationTrees = await readCoordinationTreeState();
  const creditsLedger = await readCreditsLedger();
  const creditsOperator = await getCreditsOperatorQueueSnapshot();
  const creditsDeposits = await getCreditsDepositMonitorSnapshot();
  const creditsCheckpointBatches = await getCreditsCheckpointBatchSnapshot();
  const operatorRegistry = await getOperatorRegistrySnapshot();
  res.json({
    roots: {
      agentRoot: buildCoordinationTree(coordinationTrees.agentLeaves).getRoot().toJSON(),
      creditsRoot: buildCoordinationTree(coordinationTrees.creditsLeaves).getRoot().toJSON(),
      nullifierRoot: buildCoordinationTree(coordinationTrees.nullifierLeaves).getRoot().toJSON()
    },
    counts: {
      agents: Object.keys(coordinationTrees.agentLeaves).length,
      creditsLeaves: Object.keys(coordinationTrees.creditsLeaves).length,
      nullifiers: Object.keys(coordinationTrees.nullifierLeaves).length,
      creditedWallets: Object.keys(creditsLedger.balances).length
    },
    creditsOperator: {
      ...creditsOperator.settings,
      summary: creditsOperator.summary
    },
    creditsDeposits: {
      ...creditsDeposits.settings,
      summary: creditsDeposits.summary
    },
    creditsCheckpointBatches: {
      ...creditsCheckpointBatches.settings,
      summary: creditsCheckpointBatches.summary
    },
    operatorRegistry: {
      localOperatorId: operatorRegistry.localOperatorId,
      summary: operatorRegistry.summary,
      localOperator: operatorRegistry.localOperator
    }
  });
});

app.get('/api/auth/me', async (req, res) => {
  return res.json(buildAuthMeResponse(req));
});

app.get('/api/request-status/:token', async (req, res) => {
  try {
    const existing = await getVisibleInferenceByStatusToken(req, req.params.token);
    if (!existing) {
      return res.status(404).json({ error: 'Request status token not found.' });
    }
    const inference = (await reconcileInferenceRequestStatus(existing.id, { refreshChain: true })) || existing;
    return res.json(buildInferenceStatusSnapshot(inference, req));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/mcp', async (req, res) => {
  try {
    await ensureStore();
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const id = body.id ?? null;
    const method = String(body.method || '').trim();
    const params = body.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : {};
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : params.args && typeof params.args === 'object'
          ? (params.args as Record<string, unknown>)
          : {};

    if (!method) {
      return res.status(400).json(buildMcpError(id, -32600, 'Invalid Request: missing method.'));
    }

    if (method === 'initialize') {
      return res.json(
        buildMcpSuccess(id, {
          protocolVersion: '2025-03-26',
          serverInfo: {
            name: 'zeko-ai-runtime',
            version: '0.1.0'
          },
          capabilities: {
            tools: {
              listChanged: false
            }
          }
        })
      );
    }

    if (method === 'notifications/initialized' || method === 'ping') {
      return res.json(buildMcpSuccess(id, { ok: true }));
    }

    if (method === 'tools/list') {
      return res.json(buildMcpSuccess(id, { tools: buildMcpToolsList() }));
    }

    if (method !== 'tools/call') {
      return res.status(400).json(buildMcpError(id, -32601, `Method not found: ${method}`));
    }

    const toolName = String((params as any).name || '').trim();
    let structuredContent: unknown;

    if (toolName === 'auth_me') {
      structuredContent = buildAuthMeResponse(req);
    } else if (toolName === 'list_models') {
      const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
      structuredContent = {
        models: modelsFile.models.map((entry) => buildCompatModelResponse(entry))
      };
    } else if (toolName === 'get_routing') {
      structuredContent = await getOperatorRoutingSnapshot();
    } else if (toolName === 'create_inference') {
      const normalized = normalizeCompatInferenceRequest(args, 'inference');
      if (!normalized.modelId) {
        return res.status(400).json(buildMcpError(id, -32602, 'create_inference requires modelId.'));
      }
      if (!normalized.prompt) {
        return res.status(400).json(buildMcpError(id, -32602, 'create_inference requires prompt.'));
      }
      const created = normalized.live
        ? await createAndSubmitLiveInferenceV2(
            {
              modelId: normalized.modelId,
              prompt: normalized.prompt,
              inputs: normalized.inputs,
              settlementMode: normalized.settlementMode,
              clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
              publishToDa: normalized.publishToDa,
              statusToken: normalized.statusToken,
              callbackUrl: normalized.callbackUrl,
              callbackMode: normalized.callbackMode,
              attribution: getRequestAttribution(req)
            },
            {
              waitForSettlement: normalized.waitForSettlement
            }
          )
        : {
            inference: await createInference({
              modelId: normalized.modelId,
              prompt: normalized.prompt,
              inputs: normalized.inputs,
              settlementMode: normalized.settlementMode,
              clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
              publishToDa: normalized.publishToDa,
              statusToken: normalized.statusToken,
              callbackUrl: normalized.callbackUrl,
              callbackMode: normalized.callbackMode,
              attribution: getRequestAttribution(req)
            })
          };
      structuredContent = buildCompatInferenceResponse(created.inference, req);
    } else if (toolName === 'get_inference') {
      const inferenceId = String(args.inferenceId || '').trim();
      const inference = await getVisibleInferenceById(req, inferenceId);
      if (!inference) {
        return res.status(404).json(buildMcpError(id, -32004, 'Inference not found.'));
      }
      structuredContent = buildCompatInferenceResponse((await reconcileInferenceRequestStatus(inference.id, { refreshChain: true })) || inference, req);
    } else if (toolName === 'get_status') {
      const inferenceId = String(args.inferenceId || '').trim();
      const statusToken = String(args.statusToken || '').trim();
      const existing = inferenceId
        ? await getVisibleInferenceById(req, inferenceId)
        : await getVisibleInferenceByStatusToken(req, statusToken);
      if (!existing) {
        return res.status(404).json(buildMcpError(id, -32004, 'Inference status not found.'));
      }
      const inference = (await reconcileInferenceRequestStatus(existing.id, { refreshChain: true })) || existing;
      structuredContent = buildInferenceStatusSnapshot(inference, req);
    } else {
      return res.status(400).json(buildMcpError(id, -32601, `Tool not found: ${toolName}`));
    }

    return res.json(
      buildMcpSuccess(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent, null, 2)
          }
        ],
        structuredContent,
        isError: false
      })
    );
  } catch (error) {
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    return res.status(400).json(buildMcpError(body.id ?? null, -32000, error instanceof Error ? error.message : String(error)));
  }
});

app.get('/api/operators', async (_req, res) => {
  try {
    await ensureStore();
    const snapshot = await getOperatorRegistrySnapshot();
    return res.json({
      ...snapshot,
      sponsorLanes: listSponsorLaneStatuses()
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/operators/membership', async (_req, res) => {
  try {
    await ensureStore();
    return res.json(await getOperatorMembershipSnapshot());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/operators/policy', async (_req, res) => {
  try {
    await ensureStore();
    return res.json(buildOperatorRoutingPolicySnapshot());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/operators/health', async (_req, res) => {
  try {
    await ensureStore();
    return res.json(await getOperatorHealthSnapshot());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/operators/isolation/audit', async (_req, res) => {
  try {
    await ensureStore();
    return res.json(await getOperatorIsolationAuditSnapshot());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/operators/routing', async (_req, res) => {
  try {
    await ensureStore();
    return res.json(await getOperatorRoutingSnapshot());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/operators/routing/:lane', async (req, res) => {
  try {
    await ensureStore();
    const lane = normalizeSponsorLaneParam(req.params.lane);
    if (!lane) {
      return res.status(404).json({ error: 'Lane not found.' });
    }
    return res.json(await resolveOperatorLaneRoute(lane));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/operators/internal/registry/v1/submit', async (req, res) => {
  try {
    const payload = req.body?.payload as AgentRegistrationRecord['zeko']['registrationPayload'] | undefined;
    if (!payload) throw new Error('Missing payload.');
    const submission = await submitAgentRegistrationTxWithSponsor(payload);
    return res.json({
      hash: submission.hash,
      operatorId: creditsOperatorId,
      lane: 'registry',
      contractVersion: 'v1'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/operators/internal/registry/v2/submit', async (req, res) => {
  try {
    const payload = req.body?.payload as ZekoThresholdAgentRegistrationPayload | undefined;
    if (!payload) throw new Error('Missing payload.');
    const submission = await submitAgentRegistrationTxWithSponsorV2(payload);
    return res.json({
      hash: submission.hash,
      operatorId: creditsOperatorId,
      lane: 'registry',
      contractVersion: 'v2'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/operators/internal/credits/v1/submit', async (req, res) => {
  try {
    const payload = req.body?.payload as ZekoCreditsPayload | undefined;
    if (!payload) throw new Error('Missing payload.');
    const submission = await submitCreditsTxWithSponsor({
      ...payload,
      spendTo: payload.spendTo || undefined,
      platformPayee: payload.platformPayee || undefined
    });
    return res.json({
      hash: submission.hash,
      operatorId: creditsOperatorId,
      lane: 'credits',
      contractVersion: 'v1'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/operators/internal/credits/v2/submit', async (req, res) => {
  try {
    const payload = req.body?.payload as ZekoThresholdCreditsPayload | undefined;
    if (!payload) throw new Error('Missing payload.');
    const submission = await submitCreditsTxWithSponsorV2(payload);
    return res.json({
      hash: submission.hash,
      operatorId: creditsOperatorId,
      lane: 'credits',
      contractVersion: 'v2'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.get('/api/operators/:id', async (req, res) => {
  try {
    await ensureStore();
    const operator = await getOperatorRegistryRecordById(String(req.params.id || '').trim());
    if (!operator) {
      return res.status(404).json({ error: 'Operator not found.' });
    }
    return res.json(operator);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/operators/register', async (req, res) => {
  try {
    await ensureStore();
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const sponsorLanes = Array.isArray(body.sponsorLanes)
      ? body.sponsorLanes.map((entry) => normalizeOperatorLaneAssignment(entry)).filter(Boolean)
      : undefined;
    const operator = await registerOperatorRegistryRecord({
      id: typeof body.id === 'string' ? body.id : undefined,
      label: typeof body.label === 'string' ? body.label : null,
      endpoint: typeof body.endpoint === 'string' ? body.endpoint : null,
      status: normalizeOperatorRegistryStatus(body.status, 'active'),
      local: body.local === true,
      networkId: typeof body.networkId === 'string' ? body.networkId : null,
      contractVersions: Array.isArray(body.contractVersions)
        ? body.contractVersions.filter((entry): entry is 'v1' | 'v2' => entry === 'v1' || entry === 'v2')
        : undefined,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((entry) => String(entry)) : undefined,
      sponsorLanes: sponsorLanes as OperatorLaneAssignment[] | undefined,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? (body.metadata as Record<string, unknown>) : null
    });
    return res.status(201).json(operator);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/operators/:id/heartbeat', async (req, res) => {
  try {
    await ensureStore();
    const operatorId = String(req.params.id || '').trim();
    const operator =
      operatorId === creditsOperatorId && ((req.body ?? {}) as Record<string, unknown>).local !== false
        ? await ensureLocalOperatorRegistryEntry()
        : await heartbeatOperatorRegistryRecord(operatorId);
    return res.json(operator);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/operators/:id/status', async (req, res) => {
  try {
    await ensureStore();
    const operatorId = String(req.params.id || '').trim();
    const status = normalizeOperatorRegistryStatus((req.body ?? {}).status);
    const operator = await updateOperatorRegistryStatus(operatorId, status);
    return res.json(operator);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/agents', async (req, res) => {
  const agentsFile = await readAgentsFile();
  res.json(filterAgentsForAccess(agentsFile, getRequestAccessContext(req)));
});

app.get('/api/agents/:id', async (req, res) => {
  const agent = await getVisibleAgentById(req, req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found.' });
  }
  return res.json(agent);
});

app.post('/api/agents', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreateAgentParams>;
    const agent = await createAgentRegistration({
      id: typeof body.id === 'string' ? body.id : undefined,
      name: String(body.name || ''),
      description: typeof body.description === 'string' ? body.description : undefined,
      ownerPublicKey: String(body.ownerPublicKey || ''),
      treasuryPublicKey: typeof body.treasuryPublicKey === 'string' ? body.treasuryPublicKey : undefined,
      stakeAmountMina: typeof body.stakeAmountMina === 'number' ? body.stakeAmountMina : undefined,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((entry) => String(entry)) : undefined,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : undefined,
      attribution: getRequestAttribution(req)
    });
    return res.status(201).json(agent);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/agents/:id/zeko/register-tx', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const agent = await ensureAgentHasV2Payload(existingAgent);
    if (!agent.zekoV2) {
      return res.status(404).json({ error: 'Agent has no v2 threshold settlement payload.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedAgentRegistrationTxV2(agent.zekoV2.registrationPayload, feePayer);
    return res.json({
      agentId: agent.id,
      kind: 'agent-registration',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/agents/:id/zeko/register-submit', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const agent = await ensureAgentHasV2Payload(existingAgent);
    if (!agent.zekoV2) {
      return res.status(404).json({ error: 'Agent has no v2 threshold settlement payload.' });
    }
    const submission = await submitAgentRegistrationViaRegistryLaneV2(agent.zekoV2.registrationPayload);
    return res.json({
      agentId: agent.id,
      kind: 'agent-registration',
      submitted: true,
      contractVersion: 'v2',
      hash: submission.hash,
      proxied: submission.proxied,
      route: submission.route
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/agents/:id/zeko/live-submit', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const result = await submitLiveAgentRegistration(
      req.params.id,
      normalizeLiveSettlementOptions((req.body ?? {}) as LiveReceiptActionBody)
    );
    return res.json({
      agentId: result.agent.id,
      submitted: true,
      liveSettlement: result.liveSettlement,
      chainState: result.chainState,
      agent: result.agent,
      route: result.submissionRoute,
      contractVersion: 'v2'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/agents/:id/zeko/v1/register-tx', async (req, res) => {
  try {
    const agent = await getVisibleAgentById(req, req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedAgentRegistrationTx(agent.zeko.registrationPayload, feePayer);
    return res.json({
      agentId: agent.id,
      kind: 'agent-registration',
      contractVersion: 'v1',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/agents/:id/zeko/v1/register-submit', async (req, res) => {
  try {
    const agent = await getVisibleAgentById(req, req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const submission = await submitAgentRegistrationViaRegistryLane(agent.zeko.registrationPayload);
    return res.json({
      agentId: agent.id,
      kind: 'agent-registration',
      submitted: true,
      contractVersion: 'v1',
      hash: submission.hash,
      proxied: submission.proxied,
      route: submission.route
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/agents/:id/zeko/v1/live-submit', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const result = await submitLiveAgentRegistrationV1(
      req.params.id,
      normalizeLiveSettlementOptions((req.body ?? {}) as LiveReceiptActionBody)
    );
    return res.json({
      agentId: result.agent.id,
      submitted: true,
      liveSettlement: result.liveSettlement,
      chainState: result.chainState,
      agent: result.agent,
      route: result.submissionRoute,
      contractVersion: 'v1'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/agents/:id/zeko/v2/register-tx', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const agent = await ensureAgentHasV2Payload(existingAgent);
    if (!agent.zekoV2) {
      return res.status(404).json({ error: 'Agent has no v2 threshold settlement payload.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedAgentRegistrationTxV2(agent.zekoV2.registrationPayload, feePayer);
    return res.json({
      agentId: agent.id,
      kind: 'agent-registration',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/agents/:id/zeko/v2/register-submit', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const agent = await ensureAgentHasV2Payload(existingAgent);
    if (!agent.zekoV2) {
      return res.status(404).json({ error: 'Agent has no v2 threshold settlement payload.' });
    }
    const submission = await submitAgentRegistrationViaRegistryLaneV2(agent.zekoV2.registrationPayload);
    return res.json({
      agentId: agent.id,
      kind: 'agent-registration',
      submitted: true,
      contractVersion: 'v2',
      hash: submission.hash,
      proxied: submission.proxied,
      route: submission.route
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/agents/:id/zeko/v2/live-submit', async (req, res) => {
  try {
    const existingAgent = await getVisibleAgentById(req, req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }
    const result = await submitLiveAgentRegistrationV2(
      req.params.id,
      normalizeLiveSettlementOptions((req.body ?? {}) as LiveReceiptActionBody)
    );
    return res.json({
      agentId: result.agent.id,
      submitted: true,
      liveSettlement: result.liveSettlement,
      chainState: result.chainState,
      agent: result.agent,
      route: result.submissionRoute,
      contractVersion: 'v2'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/credits/deposit-intent', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreditsDepositIntentParams> & CreditsIntentActionBody;
    if (body.enqueue) {
      throw new Error(
        'Deposit intents still require a wallet-funded tx. Use /api/credits-tx with the returned payload, then /api/credits/confirm after submission.'
      );
    }
    const intent = await createCreditsDepositIntent({
      ownerPublicKey: String(body.ownerPublicKey || ''),
      amountMina: Number(body.amountMina ?? creditsMinDeposit)
    });
    return res.json({
      ...intent,
      monitorHint: {
        endpoint: '/api/credits/deposit-monitor',
        note: 'After the wallet-funded deposit tx is broadcast, call this endpoint with ownerPublicKey, creditsRoot, and txHash to auto-confirm credits asynchronously.'
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/credits/deposit-monitors', async (req, res) => {
  const snapshot = await getVisibleCreditsDepositMonitorSnapshot(req);
  res.json(snapshot);
});

app.get('/api/credits/deposit-monitors/:id', async (req, res) => {
  const item = await getVisibleCreditsDepositMonitorById(req, req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Credits deposit monitor item not found.' });
  }
  return res.json({ item });
});

app.post('/api/credits/deposit-monitor', async (req, res) => {
  try {
    const body = (req.body ?? {}) as CreditsDepositMonitorActionBody;
    const enqueued = await enqueueCreditsDepositMonitor({
      ownerPublicKey: String(body.ownerPublicKey || ''),
      creditsRoot: String(body.creditsRoot || ''),
      txHash: String(body.txHash || ''),
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      attribution: getRequestAttribution(req)
    });
    const item = shouldProcessCreditsOperatorNow(body)
      ? await processCreditsDepositMonitorItem(enqueued.item.id, {
          ...normalizeLiveSettlementOptions(body),
          maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined
        })
      : enqueued.item;
    const snapshot = await getCreditsDepositMonitorSnapshot();
    return res.status(enqueued.deduped ? 200 : 201).json({
      queued: true,
      deduped: enqueued.deduped,
      item,
      summary: snapshot.summary,
      settings: snapshot.settings
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/credits/deposit-monitor/process', async (req, res) => {
  try {
    const body = (req.body ?? {}) as CreditsDepositMonitorActionBody;
    if (typeof body.id === 'string' && body.id.trim()) {
      const item = await processCreditsDepositMonitorItem(body.id.trim(), {
        ...normalizeLiveSettlementOptions(body),
        maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined
      });
      const snapshot = await getCreditsDepositMonitorSnapshot();
      return res.json({
        processing: false,
        processed: [item],
        summary: snapshot.summary,
        settings: snapshot.settings
      });
    }

    const result = await processCreditsDepositMonitorQueue({
      ...normalizeLiveSettlementOptions(body),
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      retryFailed: body.retryFailed,
      maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined
    });
    const snapshot = await getCreditsDepositMonitorSnapshot();
    return res.json({
      ...result,
      summary: snapshot.summary,
      settings: snapshot.settings
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

async function handleCreditsSpendIntentRequest(
  body: Partial<CreditsSpendIntentParams> & CreditsIntentActionBody,
  settlementStrategyInput?: unknown,
  attribution?: RequestAttributionRecord | null
) {
  const settlementStrategy = normalizeCreditsSettlementStrategy(settlementStrategyInput ?? body.settlementStrategy);
  const intent = await createCreditsSpendIntent({
    ownerPublicKey: String(body.ownerPublicKey || ''),
    requestId: String(body.requestId || ''),
    amountMina: Number(body.amountMina),
    spendTo: typeof body.spendTo === 'string' ? body.spendTo : undefined,
    platformPayee: typeof body.platformPayee === 'string' ? body.platformPayee : undefined,
    settlementStrategy
  });

  if (!body.enqueue) {
    return {
      statusCode: 200,
      payload: intent
    };
  }

  const enqueued = await enqueueCreditsOperatorItem({
    payload: intent.payloadV2,
    source: 'spend-intent',
    settlementStrategy,
    kind: 'credits-spend',
    ownerPublicKey: intent.ownerPublicKey,
    requestId: String(body.requestId || ''),
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    attribution
  });

  const item =
    settlementStrategy === 'checkpoint'
      ? enqueued.item
      : shouldProcessCreditsOperatorNow(body)
        ? await processCreditsOperatorItem(enqueued.item.id, normalizeLiveSettlementOptions(body))
        : enqueued.item;

  const queue = await getCreditsOperatorQueueSnapshot();
  return {
    statusCode: enqueued.deduped ? 200 : 201,
    payload: {
      ...intent,
      operator: {
        queued: true,
        deduped: enqueued.deduped,
        item,
        summary: queue.summary,
        settings: queue.settings
      }
    }
  };
}

app.post('/api/credits/spend-intent', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreditsSpendIntentParams> & CreditsIntentActionBody;
    const result = await handleCreditsSpendIntentRequest(body, undefined, getRequestAttribution(req));
    return res.status(result.statusCode).json(result.payload);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/credits/spend-intent/batched', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreditsSpendIntentParams> & CreditsIntentActionBody;
    const result = await handleCreditsSpendIntentRequest(
      {
        ...body,
        enqueue: body.enqueue !== false
      },
      'checkpoint',
      getRequestAttribution(req)
    );
    return res.status(result.statusCode).json(result.payload);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/credits/spend-intent/fast', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreditsSpendIntentParams> & CreditsIntentActionBody;
    const result = await handleCreditsSpendIntentRequest(
      {
        ...body,
        enqueue: body.enqueue !== false,
        processNow: body.processNow === true ? true : false,
        waitForSettlement: body.waitForSettlement === true ? true : false
      },
      'checkpoint',
      getRequestAttribution(req)
    );
    return res.status(result.statusCode).json({
      ...result.payload,
      fastPath: true,
      finality: {
        localLedgerCommitted: true,
        queuedForCheckpointBatch:
          typeof (result.payload as any)?.operator === 'object' && (result.payload as any).operator !== null
      },
      note:
        'Fast credits spends debit the off-chain ledger immediately and queue the on-chain threshold checkpoint in the background.'
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/credits/operator/queue', async (req, res) => {
  const snapshot = await getVisibleCreditsQueueSnapshot(req);
  res.json(snapshot);
});

app.get('/api/credits/operator/queue/:id', async (req, res) => {
  const item = await getVisibleCreditsOperatorItemById(req, req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Credits operator item not found.' });
  }
  return res.json({ item });
});

app.post('/api/credits/operator/enqueue', async (req, res) => {
  try {
    const body = (req.body ?? {}) as CreditsOperatorEnqueueBody;
    if (!body.payload) throw new Error('Missing payload.');
    const enqueued = await enqueueCreditsOperatorItem({
      payload: body.payload,
      source: normalizeOperatorSource(body.source),
      ownerPublicKey: typeof body.ownerPublicKey === 'string' ? body.ownerPublicKey : undefined,
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      pendingDepositKey: typeof body.pendingDepositKey === 'string' ? body.pendingDepositKey : undefined,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      attribution: getRequestAttribution(req)
    });
    const item = shouldProcessCreditsOperatorNow(body)
      ? await processCreditsOperatorItem(enqueued.item.id, {
          ...normalizeLiveSettlementOptions(body),
          maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined
        })
      : enqueued.item;
    const queue = await getCreditsOperatorQueueSnapshot();
    return res.status(enqueued.deduped ? 200 : 201).json({
      queued: true,
      deduped: enqueued.deduped,
      item,
      summary: queue.summary,
      settings: queue.settings
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/credits/operator/process', async (req, res) => {
  try {
    const body = (req.body ?? {}) as CreditsOperatorProcessBody;
    if (typeof body.id === 'string' && body.id.trim()) {
      const item = await processCreditsOperatorItem(body.id.trim(), {
        ...normalizeLiveSettlementOptions(body),
        maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined
      });
      const queue = await getCreditsOperatorQueueSnapshot();
      return res.json({
        processing: false,
        processed: [item],
        summary: queue.summary,
        settings: queue.settings
      });
    }

    const result = await processCreditsOperatorQueue({
      ...normalizeLiveSettlementOptions(body),
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      retryFailed: body.retryFailed,
      maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined
    });
    const queue = await getCreditsOperatorQueueSnapshot();
    return res.json({
      ...result,
      summary: queue.summary,
      settings: queue.settings
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/credits/operator/checkpoint-batches', async (req, res) => {
  const snapshot = await getVisibleCreditsCheckpointBatchSnapshot(req);
  res.json(snapshot);
});

app.post('/api/credits/operator/checkpoint-batches/process', async (req, res) => {
  try {
    const body = (req.body ?? {}) as CreditsOperatorProcessBody & { maxBatchSize?: number };
    const result = await processCreditsCheckpointBatches({
      ...normalizeLiveSettlementOptions(body),
      maxBatchSize: typeof body.maxBatchSize === 'number' ? body.maxBatchSize : undefined,
      retryFailed: body.retryFailed
    });
    const snapshot = await getCreditsCheckpointBatchSnapshot();
    return res.json({
      ...result,
      summary: snapshot.summary,
      settings: snapshot.settings
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/credits/balance', async (req, res) => {
  try {
    const ownerPublicKey = String(req.query.ownerPublicKey || '').trim();
    if (!ownerPublicKey) throw new Error('Missing ownerPublicKey.');
    const ledger = await readCreditsLedger();
    return res.json({
      ownerPublicKey,
      balanceMina: ledger.balances[ownerPublicKey] || 0
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/credits/confirm', async (req, res) => {
  try {
    const ownerPublicKey = String(req.body?.ownerPublicKey || '').trim();
    const creditsRoot = String(req.body?.creditsRoot || '').trim();
    const txHash = String(req.body?.txHash || '').trim();
    if (!ownerPublicKey || !creditsRoot || !txHash) {
      throw new Error('Missing ownerPublicKey, creditsRoot, or txHash.');
    }
    const result = await confirmCreditsDeposit(ownerPublicKey, creditsRoot, txHash);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/credits-tx', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedCreditsTxV2(payload, feePayer);
    return res.json({
      kind: 'credits-update',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/credits-submit', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const submission = await submitCreditsViaCreditsLaneV2(payload);
    return res.json({
      kind: 'credits-update',
      submitted: true,
      contractVersion: 'v2',
      hash: submission.hash,
      proxied: submission.proxied,
      route: submission.route
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/credits/v1/tx', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedCreditsTx(payload, feePayer);
    return res.json({
      kind: 'credits-update',
      contractVersion: 'v1',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/credits/v1/submit', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const submission = await submitCreditsViaCreditsLane(payload);
    return res.json({
      kind: 'credits-update',
      submitted: true,
      contractVersion: 'v1',
      hash: submission.hash,
      proxied: submission.proxied,
      route: submission.route
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/credits/v2/tx', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedCreditsTxV2(payload, feePayer);
    return res.json({
      kind: 'credits-update',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/credits/v2/submit', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const submission = await submitCreditsViaCreditsLaneV2(payload);
    return res.json({
      kind: 'credits-update',
      submitted: true,
      contractVersion: 'v2',
      hash: submission.hash,
      proxied: submission.proxied,
      route: submission.route
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.get('/api/models', async (_req, res) => {
  const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
  res.json(modelsFile);
});

app.post('/api/models', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<ModelRecord>;
    const name = String(body.name || '').trim();
    if (!name) throw new Error('Missing model name.');

    const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
    const id = String(body.id || slugify(name) || `model-${modelsFile.models.length + 1}`);
    if (modelsFile.models.some((entry) => entry.id === id)) {
      throw new Error(`Model id already exists: ${id}`);
    }

    const model: ModelRecord = {
      id,
      name,
      version: String(body.version || '0.1.0'),
      description: String(
        body.description || 'Reference-protocol inference endpoint adapted to Zeko threshold settlement.'
      ),
      endpoint: body.endpoint ? String(body.endpoint) : null,
      authToken: body.authToken ? String(body.authToken) : null,
      settlementModeDefault: normalizeSettlementMode(body.settlementModeDefault, defaultSettlementMode),
      verificationMethod: normalizeVerificationMethod(body.verificationMethod),
      transportMode: normalizeTransportMode(body.transportMode),
      tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : [],
      createdAt: new Date().toISOString()
    };

    modelsFile.models.unshift(model);
    await writeJson(modelsPath, modelsFile);
    res.status(201).json(model);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get(['/api/compat/reference/models', '/api/compat/opengradient/models'], async (_req, res) => {
  const modelsFile = await readJson<ModelsFile>(modelsPath, { models: [] });
  res.json({
    object: 'list',
    data: modelsFile.models.map((entry) => buildCompatModelResponse(entry))
  });
});

app.post(['/api/compat/reference/inference', '/api/compat/opengradient/inference'], async (req, res) => {
  try {
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const normalized = normalizeCompatInferenceRequest(body, 'inference');
    if (!normalized.modelId) throw new Error('Missing modelId.');
    if (!normalized.prompt) throw new Error('Missing prompt.');

    const created = normalized.live
      ? await createAndSubmitLiveInferenceV2(
          {
            modelId: normalized.modelId,
            prompt: normalized.prompt,
            inputs: normalized.inputs,
            settlementMode: normalized.settlementMode,
            clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
            publishToDa: normalized.publishToDa,
            statusToken: normalized.statusToken,
            callbackUrl: normalized.callbackUrl,
            callbackMode: normalized.callbackMode,
            attribution: getRequestAttribution(req)
          },
          {
            waitForSettlement: normalized.waitForSettlement
          }
        )
      : {
          inference: await createInference({
            modelId: normalized.modelId,
            prompt: normalized.prompt,
            inputs: normalized.inputs,
            settlementMode: normalized.settlementMode,
            clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
            publishToDa: normalized.publishToDa,
            statusToken: normalized.statusToken,
            callbackUrl: normalized.callbackUrl,
            callbackMode: normalized.callbackMode,
            attribution: getRequestAttribution(req)
          })
        };

    return res.status(201).json(buildCompatInferenceResponse(created.inference, req));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post(['/api/compat/reference/chat/completions', '/api/compat/opengradient/chat/completions'], async (req, res) => {
  try {
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const normalized = normalizeCompatInferenceRequest(body, 'chat');
    if (!normalized.modelId) throw new Error('Missing model or modelId.');
    if (!normalized.prompt) throw new Error('Missing prompt or chat messages.');

    const created = normalized.live
      ? await createAndSubmitLiveInferenceV2(
          {
            modelId: normalized.modelId,
            prompt: normalized.prompt,
            inputs: normalized.inputs,
            settlementMode: normalized.settlementMode,
            clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
            publishToDa: normalized.publishToDa,
            statusToken: normalized.statusToken,
            callbackUrl: normalized.callbackUrl,
            callbackMode: normalized.callbackMode,
            attribution: getRequestAttribution(req)
          },
          {
            waitForSettlement: normalized.waitForSettlement
          }
        )
      : {
          inference: await createInference({
            modelId: normalized.modelId,
            prompt: normalized.prompt,
            inputs: normalized.inputs,
            settlementMode: normalized.settlementMode,
            clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
            publishToDa: normalized.publishToDa,
            statusToken: normalized.statusToken,
            callbackUrl: normalized.callbackUrl,
            callbackMode: normalized.callbackMode,
            attribution: getRequestAttribution(req)
          })
        };

    return res.status(201).json(buildCompatChatCompletionResponse(created.inference, req));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get(['/api/compat/reference/inference/:id', '/api/compat/opengradient/inference/:id'], async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  const refreshed = (await reconcileInferenceRequestStatus(inference.id, { refreshChain: true })) || inference;
  return res.json(buildCompatInferenceResponse(refreshed, req));
});

app.get(
  ['/api/compat/reference/inference/:id/status', '/api/compat/opengradient/inference/:id/status'],
  async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  const refreshed = (await reconcileInferenceRequestStatus(inference.id, { refreshChain: true })) || inference;
    return res.json({
      object: 'compat.inference.status',
      ...buildInferenceStatusSnapshot(refreshed, req)
    });
  }
);

app.get(
  ['/api/compat/reference/inference/:id/receipt', '/api/compat/opengradient/inference/:id/receipt'],
  async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  const refreshed = (await reconcileInferenceRequestStatus(inference.id, { refreshChain: true })) || inference;
    return res.json(buildCompatReceiptResponse(refreshed, req));
  }
);

app.get('/api/inferences', async (req, res) => {
  const inferencesFile = await readInferencesFile();
  res.json(filterInferencesForAccess(inferencesFile, getRequestAccessContext(req)));
});

app.get('/api/inferences/:id', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  return res.json(inference);
});

app.get('/api/inferences/:id/zeko-payloads', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  if (!inference.zekoV2) {
    return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
  }
  return res.json({
    inferenceId: inference.id,
    zeko: inference.zekoV2,
    thresholdAttestations: inference.attestations,
    note: 'These are the default threshold-verifying v2 settlement payloads used by the main /zeko endpoints.'
  });
});

app.get('/api/inferences/:id/zeko-v1-payloads', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  return res.json({
    inferenceId: inference.id,
    zeko: inference.zeko,
    thresholdAttestations: inference.attestations,
    note: 'These are the legacy v1 single-signer-compatible settlement payloads.'
  });
});

app.get('/api/inferences/:id/zeko-v2-payloads', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  if (!inference.zekoV2) {
    return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
  }
  return res.json({
    inferenceId: inference.id,
    zeko: inference.zekoV2,
    thresholdAttestations: inference.attestations,
    contractVersion: 'v2',
    note: 'These payloads target the v2 threshold-verifying zkApp and use 2-of-3 on-chain attester verification.'
  });
});

app.get('/api/inferences/:id/relay-payload', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  if (!inference.daPublication?.relayPayload) {
    return res.status(404).json({ error: 'No relay payload prepared for this inference.' });
  }
  return res.json(inference.daPublication);
});

app.get('/api/inferences/:id/zeko/live-settlement', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  return res.json({
    inferenceId: inference.id,
    liveSettlement: inference.liveSettlementV2 || null,
    contractVersion: 'v2'
  });
});

app.get('/api/inferences/:id/zeko/v1/live-settlement', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  return res.json({
    inferenceId: inference.id,
    liveSettlement: inference.liveSettlement || null,
    contractVersion: 'v1'
  });
});

app.get('/api/inferences/:id/zeko/v2/live-settlement', async (req, res) => {
  const inference = await getVisibleInferenceById(req, req.params.id);
  if (!inference) {
    return res.status(404).json({ error: 'Inference not found.' });
  }
  return res.json({
    inferenceId: inference.id,
    liveSettlement: inference.liveSettlementV2 || null,
    contractVersion: 'v2'
  });
});

app.post('/api/inferences/:id/zeko/request-tx', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedRequestReceiptTxV2(inference.zekoV2.requestPayload, feePayer);
    return res.json({
      inferenceId: inference.id,
      kind: 'request-receipt',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/output-tx', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedOutputReceiptTxV2(inference.zekoV2.outputPayload, feePayer);
    return res.json({
      inferenceId: inference.id,
      kind: 'output-receipt',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/request-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const submission = await submitRequestReceiptTxWithSponsorV2(inference.zekoV2.requestPayload);
    return res.json({
      inferenceId: inference.id,
      kind: 'request-receipt',
      submitted: true,
      contractVersion: 'v2',
      ...submission
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/output-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const submission = await submitOutputReceiptTxWithSponsorV2(inference.zekoV2.outputPayload);
    return res.json({
      inferenceId: inference.id,
      kind: 'output-receipt',
      submitted: true,
      contractVersion: 'v2',
      ...submission
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/live-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const result = await submitLiveReceiptsForInferenceV2(
      req.params.id,
      normalizeLiveSettlementOptions((req.body ?? {}) as LiveReceiptActionBody)
    );
    return res.json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlementV2,
      chainState: result.chainState,
      inference: result.inference,
      contractVersion: 'v2'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/v1/request-tx', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedRequestReceiptTx(inference.zeko.requestPayload, feePayer);
    return res.json({
      inferenceId: inference.id,
      kind: 'request-receipt',
      contractVersion: 'v1',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/inferences/:id/zeko/v1/output-tx', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedOutputReceiptTx(inference.zeko.outputPayload, feePayer);
    return res.json({
      inferenceId: inference.id,
      kind: 'output-receipt',
      contractVersion: 'v1',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/inferences/:id/zeko/v1/request-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const submission = await submitRequestReceiptTxWithSponsor(inference.zeko.requestPayload);
    return res.json({
      inferenceId: inference.id,
      kind: 'request-receipt',
      submitted: true,
      contractVersion: 'v1',
      ...submission
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/inferences/:id/zeko/v1/output-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const submission = await submitOutputReceiptTxWithSponsor(inference.zeko.outputPayload);
    return res.json({
      inferenceId: inference.id,
      kind: 'output-receipt',
      submitted: true,
      contractVersion: 'v1',
      ...submission
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/inferences/:id/zeko/v1/live-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const result = await submitLiveReceiptsForInference(
      req.params.id,
      normalizeLiveSettlementOptions((req.body ?? {}) as LiveReceiptActionBody)
    );
    return res.json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlement,
      chainState: result.chainState,
      inference: result.inference,
      contractVersion: 'v1'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadError(error) });
  }
});

app.post('/api/inferences/:id/zeko/v2/request-tx', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedRequestReceiptTxV2(inference.zekoV2.requestPayload, feePayer);
    return res.json({
      inferenceId: inference.id,
      kind: 'request-receipt',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/v2/output-tx', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const feePayer = String(((req.body ?? {}) as ZekoReceiptActionBody).feePayer || '').trim();
    if (!feePayer) throw new Error('Missing feePayer.');
    const tx = await buildUnsignedOutputReceiptTxV2(inference.zekoV2.outputPayload, feePayer);
    return res.json({
      inferenceId: inference.id,
      kind: 'output-receipt',
      contractVersion: 'v2',
      ...tx
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/v2/request-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const submission = await submitRequestReceiptTxWithSponsorV2(inference.zekoV2.requestPayload);
    return res.json({
      inferenceId: inference.id,
      kind: 'request-receipt',
      submitted: true,
      contractVersion: 'v2',
      ...submission
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/v2/output-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    if (!inference.zekoV2) {
      return res.status(404).json({ error: 'Inference has no v2 threshold settlement payloads.' });
    }
    const submission = await submitOutputReceiptTxWithSponsorV2(inference.zekoV2.outputPayload);
    return res.json({
      inferenceId: inference.id,
      kind: 'output-receipt',
      submitted: true,
      contractVersion: 'v2',
      ...submission
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

app.post('/api/inferences/:id/zeko/v2/live-submit', async (req, res) => {
  try {
    const inference = await getVisibleInferenceById(req, req.params.id);
    if (!inference) {
      return res.status(404).json({ error: 'Inference not found.' });
    }
    const result = await submitLiveReceiptsForInferenceV2(
      req.params.id,
      normalizeLiveSettlementOptions((req.body ?? {}) as LiveReceiptActionBody)
    );
    return res.json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlementV2,
      chainState: result.chainState,
      inference: result.inference,
      contractVersion: 'v2'
    });
  } catch (error) {
    return res.status(400).json({ error: describeZekoPayloadErrorV2(error) });
  }
});

function normalizeClientEncryptedEnvelope(value: unknown): ClientEncryptedEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const required = ['recipientPublicKeyFingerprint', 'ephemeralPublicKeyPem', 'iv', 'tag', 'ciphertext'] as const;
  if (body.mode !== 'aes-256-gcm' || body.curve !== 'x25519') return null;
  if (required.some((field) => typeof body[field] !== 'string' || String(body[field]).trim().length === 0)) {
    return null;
  }
  return {
    mode: 'aes-256-gcm',
    curve: 'x25519',
    recipientPublicKeyFingerprint: String(body.recipientPublicKeyFingerprint),
    ephemeralPublicKeyPem: String(body.ephemeralPublicKeyPem),
    iv: String(body.iv),
    tag: String(body.tag),
    ciphertext: String(body.ciphertext)
  };
}

function normalizePrivateInferenceBody(input: unknown) {
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    modelId: String(body.modelId || body.model || '').trim(),
    privateInputEnvelope: normalizeClientEncryptedEnvelope(
      body.privateInputEnvelope ?? body.private_input_envelope ?? body.requestEnvelope ?? body.envelope
    ),
    settlementMode: normalizeSettlementMode(body.settlementMode ?? body.settlement_mode),
    clientEncryptionPublicKeyPem:
      typeof body.clientEncryptionPublicKeyPem === 'string'
        ? body.clientEncryptionPublicKeyPem
        : typeof body.client_encryption_public_key_pem === 'string'
          ? body.client_encryption_public_key_pem
          : undefined,
    publishToDa:
      body.publishToDa === true ||
      body.publish_to_da === true ||
      body.publishToDa === 'true' ||
      body.publish_to_da === 'true',
    statusToken:
      typeof body.statusToken === 'string'
        ? body.statusToken
        : typeof body.status_token === 'string'
          ? body.status_token
          : undefined,
    callbackUrl:
      typeof body.callbackUrl === 'string'
        ? body.callbackUrl
        : typeof body.callback_url === 'string'
          ? body.callback_url
          : undefined,
    callbackMode:
      typeof body.callbackMode === 'string'
        ? normalizeInferenceCallbackMode(body.callbackMode)
        : normalizeInferenceCallbackMode(body.callback_mode),
    storePlaintextPrompt: body.storePlaintextPrompt === true || body.persistPlaintext === true
  };
}

app.post('/api/infer', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      modelId?: string;
      prompt?: string;
      inputs?: Record<string, unknown>;
      settlementMode?: SettlementMode;
      clientEncryptionPublicKeyPem?: string;
      publishToDa?: boolean;
      statusToken?: string;
      callbackUrl?: string;
      callbackMode?: InferenceCallbackMode;
    };
    const modelId = String(body.modelId || '').trim();
    const prompt = String(body.prompt || '').trim();
    if (!modelId) throw new Error('Missing modelId.');
    if (!prompt) throw new Error('Missing prompt.');

    const record = await createInference({
      modelId,
      prompt,
      inputs: typeof body.inputs === 'object' && body.inputs !== null ? body.inputs : {},
      settlementMode: normalizeSettlementMode(body.settlementMode),
      clientEncryptionPublicKeyPem:
        typeof body.clientEncryptionPublicKeyPem === 'string'
          ? body.clientEncryptionPublicKeyPem
          : undefined,
      publishToDa: Boolean(body.publishToDa),
      statusToken: typeof body.statusToken === 'string' ? body.statusToken : undefined,
      callbackUrl: typeof body.callbackUrl === 'string' ? body.callbackUrl : undefined,
      callbackMode: normalizeInferenceCallbackMode(body.callbackMode),
      attribution: getRequestAttribution(req)
    });
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/infer/private', async (req, res) => {
  try {
    const normalized = normalizePrivateInferenceBody(req.body);
    if (!normalized.modelId) throw new Error('Missing modelId.');
    if (!normalized.privateInputEnvelope) throw new Error('Missing privateInputEnvelope.');

    const record = await createInference({
      modelId: normalized.modelId,
      prompt: '',
      inputs: {},
      privateInputEnvelope: normalized.privateInputEnvelope,
      storePlaintextPrompt: normalized.storePlaintextPrompt,
      settlementMode: normalized.settlementMode,
      clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
      publishToDa: normalized.publishToDa,
      statusToken: normalized.statusToken,
      callbackUrl: normalized.callbackUrl,
      callbackMode: normalized.callbackMode,
      attribution: getRequestAttribution(req)
    });
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/infer/live', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      modelId?: string;
      prompt?: string;
      inputs?: Record<string, unknown>;
      settlementMode?: SettlementMode;
      clientEncryptionPublicKeyPem?: string;
      publishToDa?: boolean;
      statusToken?: string;
      callbackUrl?: string;
      callbackMode?: InferenceCallbackMode;
      waitForSettlement?: boolean;
      waitTimeoutMs?: number;
      pollIntervalMs?: number;
    };
    const modelId = String(body.modelId || '').trim();
    const prompt = String(body.prompt || '').trim();
    if (!modelId) throw new Error('Missing modelId.');
    if (!prompt) throw new Error('Missing prompt.');

    const result = await createAndSubmitLiveInferenceV2(
      {
        modelId,
        prompt,
        inputs: typeof body.inputs === 'object' && body.inputs !== null ? body.inputs : {},
        settlementMode: normalizeSettlementMode(body.settlementMode),
        clientEncryptionPublicKeyPem:
          typeof body.clientEncryptionPublicKeyPem === 'string'
            ? body.clientEncryptionPublicKeyPem
            : undefined,
        publishToDa: Boolean(body.publishToDa),
        statusToken: typeof body.statusToken === 'string' ? body.statusToken : undefined,
        callbackUrl: typeof body.callbackUrl === 'string' ? body.callbackUrl : undefined,
        callbackMode: normalizeInferenceCallbackMode(body.callbackMode),
        attribution: getRequestAttribution(req)
      },
      normalizeLiveSettlementOptions(body)
    );

    res.status(201).json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlementV2,
      chainState: result.chainState,
      requestStatus: buildInferenceStatusSnapshot(result.inference, req),
      inference: result.inference,
      contractVersion: 'v2'
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/infer/private/live', async (req, res) => {
  try {
    const normalized = normalizePrivateInferenceBody(req.body);
    if (!normalized.modelId) throw new Error('Missing modelId.');
    if (!normalized.privateInputEnvelope) throw new Error('Missing privateInputEnvelope.');

    const result = await createAndSubmitLiveInferenceV2(
      {
        modelId: normalized.modelId,
        prompt: '',
        inputs: {},
        privateInputEnvelope: normalized.privateInputEnvelope,
        storePlaintextPrompt: normalized.storePlaintextPrompt,
        settlementMode: normalized.settlementMode,
        clientEncryptionPublicKeyPem: normalized.clientEncryptionPublicKeyPem,
        publishToDa: normalized.publishToDa,
        statusToken: normalized.statusToken,
        callbackUrl: normalized.callbackUrl,
        callbackMode: normalized.callbackMode,
        attribution: getRequestAttribution(req)
      },
      normalizeLiveSettlementOptions(req.body)
    );

    res.status(201).json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlementV2,
      chainState: result.chainState,
      requestStatus: buildInferenceStatusSnapshot(result.inference, req),
      inference: result.inference,
      contractVersion: 'v2'
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/infer/v1/live', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      modelId?: string;
      prompt?: string;
      inputs?: Record<string, unknown>;
      settlementMode?: SettlementMode;
      clientEncryptionPublicKeyPem?: string;
      publishToDa?: boolean;
      statusToken?: string;
      callbackUrl?: string;
      callbackMode?: InferenceCallbackMode;
      waitForSettlement?: boolean;
      waitTimeoutMs?: number;
      pollIntervalMs?: number;
    };
    const modelId = String(body.modelId || '').trim();
    const prompt = String(body.prompt || '').trim();
    if (!modelId) throw new Error('Missing modelId.');
    if (!prompt) throw new Error('Missing prompt.');

    const result = await createAndSubmitLiveInference(
      {
        modelId,
        prompt,
        inputs: typeof body.inputs === 'object' && body.inputs !== null ? body.inputs : {},
        settlementMode: normalizeSettlementMode(body.settlementMode),
        clientEncryptionPublicKeyPem:
          typeof body.clientEncryptionPublicKeyPem === 'string'
            ? body.clientEncryptionPublicKeyPem
            : undefined,
        publishToDa: Boolean(body.publishToDa),
        statusToken: typeof body.statusToken === 'string' ? body.statusToken : undefined,
        callbackUrl: typeof body.callbackUrl === 'string' ? body.callbackUrl : undefined,
        callbackMode: normalizeInferenceCallbackMode(body.callbackMode),
        attribution: getRequestAttribution(req)
      },
      normalizeLiveSettlementOptions(body)
    );

    res.status(201).json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlement,
      chainState: result.chainState,
      requestStatus: buildInferenceStatusSnapshot(result.inference, req),
      inference: result.inference,
      contractVersion: 'v1'
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/infer/v2/live', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      modelId?: string;
      prompt?: string;
      inputs?: Record<string, unknown>;
      settlementMode?: SettlementMode;
      clientEncryptionPublicKeyPem?: string;
      publishToDa?: boolean;
      statusToken?: string;
      callbackUrl?: string;
      callbackMode?: InferenceCallbackMode;
      waitForSettlement?: boolean;
      waitTimeoutMs?: number;
      pollIntervalMs?: number;
    };
    const modelId = String(body.modelId || '').trim();
    const prompt = String(body.prompt || '').trim();
    if (!modelId) throw new Error('Missing modelId.');
    if (!prompt) throw new Error('Missing prompt.');

    const result = await createAndSubmitLiveInferenceV2(
      {
        modelId,
        prompt,
        inputs: typeof body.inputs === 'object' && body.inputs !== null ? body.inputs : {},
        settlementMode: normalizeSettlementMode(body.settlementMode),
        clientEncryptionPublicKeyPem:
          typeof body.clientEncryptionPublicKeyPem === 'string'
            ? body.clientEncryptionPublicKeyPem
            : undefined,
        publishToDa: Boolean(body.publishToDa),
        statusToken: typeof body.statusToken === 'string' ? body.statusToken : undefined,
        callbackUrl: typeof body.callbackUrl === 'string' ? body.callbackUrl : undefined,
        callbackMode: normalizeInferenceCallbackMode(body.callbackMode),
        attribution: getRequestAttribution(req)
      },
      normalizeLiveSettlementOptions(body)
    );

    res.status(201).json({
      inferenceId: result.inference.id,
      submitted: true,
      liveSettlement: result.liveSettlementV2,
      chainState: result.chainState,
      requestStatus: buildInferenceStatusSnapshot(result.inference, req),
      inference: result.inference,
      contractVersion: 'v2'
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/crypto/decrypt', (req, res) => {
  try {
    const privateKeyPem = String(req.body?.privateKeyPem || '');
    const envelope = req.body?.envelope as ClientEncryptedEnvelope | undefined;
    if (!privateKeyPem) throw new Error('Missing privateKeyPem.');
    if (!envelope) throw new Error('Missing envelope.');
    const payload = decryptClientEnvelope(privateKeyPem, envelope);
    res.json({ payload });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/batches', async (_req, res) => {
  const batchesFile = await readJson<BatchesFile>(batchesPath, { batches: [] });
  res.json(batchesFile);
});

app.post('/api/batches', async (req, res) => {
  try {
    const inferenceIds = Array.isArray(req.body?.inferenceIds)
      ? req.body.inferenceIds.map((entry: unknown) => String(entry))
      : undefined;
    const batch = await createBatch(inferenceIds);
    res.status(201).json(batch);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export { app };

ensureStore()
  .then(() => {
    if (!shouldListen) {
      console.log('Zeko AI Runtime initialized without opening a port.');
      return;
    }
    app.listen(port, host, () => {
      console.log(`Zeko AI Runtime listening on http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize Zeko AI Runtime:', error);
    process.exit(1);
  });
