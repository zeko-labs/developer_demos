import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import cors from 'cors';
import express from 'express';
import type { Server } from 'node:http';
import {
  BridgeEntryRequestSchema,
  BridgeExitRequestSchema,
  BurnRequestSchema,
  CustodyHoldingsSourceSchema,
  EligibilityProofRequestSchema,
  GenericRestSourceSchema,
  IncreaseSourceSchema,
  IssuerApprovalActionSchema,
  MintRequestSchema,
  MockBankSourceSchema,
  PersonaSourceSchema,
  PlaidSourceSchema,
  PolicyVersionSchema,
  ProofEnvelopeSchema,
  RecordSettlementRequestSchema,
  RoleSchema,
  RiskOperationSchema,
  StockAllocationRequestSchema,
  StockIssueRequestSchema,
  StockRedeemRequestSchema,
  StockRestrictionRequestSchema,
  type AuthProfile,
  type BurnRequest,
  type MintRequest,
  type MtlsProfile,
  type ProofEnvelope,
  type SourceAdapterRequest,
  type StockAllocationRequest,
  type StockIssueRequest,
  type StockRedeemRequest,
  type StockRestrictionRequest,
  SourceAdapterRequestSchema,
  TenantProviderConfigSchema,
  TransferComplianceProofRequestSchema,
  TransferRequestSchema,
  UpsertIssuerControlConfigRequestSchema,
  UpsertRiskConfigRequestSchema,
  UpsertPolicyRequestSchema,
  UploadStatementRequestSchema,
  VerifyPhoneRequestSchema,
  ZkTlsBankSourceSchema,
  ZkTlsEmployerSourceSchema
} from '@tap/shared-types';
import {
  generateEligibilityProof,
  generateTransferComplianceProof,
  getProofById,
  getProofMode,
  verifyProofEnvelope
} from '@tap/prover-service';
import {
  applySettlementFinality,
  getSettlementById,
  getSettlementByProofHash,
  listRecentSettlements,
  recordSettlement,
  resetSettlementStore,
  upsertSettlementByProofHash
} from '@tap/contracts';
import {
  assertZkTlsRepoReady,
  getZkTlsArtifacts,
  latestZkTlsArtifacts,
  mapZkTlsArtifactsToTapProof,
  runZkTlsTask,
  runZkTlsPipeline
} from '@tap/attestor-service';
import { AdapterError, collectPartnerAttestation, listSourceProviders } from '@tap/source-adapters';
import {
  getTenantProviderConfig,
  listAllTenantProviderConfigs,
  listTenantProviderConfigs,
  upsertTenantProviderConfig
} from '@tap/tenant-config';
import { listPolicyVersions, resolveActivePolicy, upsertPolicyVersion } from '@tap/policy-engine';
import {
  evaluateAndRecordRisk,
  listRiskConfigs,
  resetRiskRuntimeState,
  upsertRiskConfig
} from '@tap/compliance-engine';
import { extractPolicyLinkage, validatePolicyAtSettlement } from './policySettlementGuard.js';
import {
  getIssuerControl,
  getIssuerRequest,
  listIssuerRequests,
  resetIssuerStore,
  type IssuerApproval,
  type IssuerControlConfig,
  type IssuerRequestKind,
  type IssuerRequestRecord,
  upsertIssuerControl,
  upsertIssuerRequest
} from './issuerStore.js';

export const app: express.Express = express();
const port = Number(process.env.PORT || 7001);

app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  })
);

const mintRequestStore = new Map<string, unknown>();
const burnRequestStore = new Map<string, unknown>();
const stockIssueRequestStore = new Map<string, unknown>();
const stockAllocationRequestStore = new Map<string, unknown>();
const stockRestrictionRequestStore = new Map<string, unknown>();
const stockRedeemRequestStore = new Map<string, unknown>();
const transferRequestStore = new Map<string, unknown>();
const bridgeRequestStore = new Map<string, unknown>();
const sourceCollectIdempotency = new Map<string, unknown>();
const sourceUsagePerHour = new Map<string, { windowHour: string; count: number }>();
const sourceRetryBudgetPerHour = new Map<string, { windowHour: string; count: number }>();
const sourceRetryQueue: Array<{
  queueId: string;
  dlqId?: string;
  requestData: SourceAdapterRequest;
  attempts: number;
  nextAttemptAtMs: number;
  lastError?: { code: string; message: string };
}> = [];
interface ReconcileActionPolicy {
  allowFinalizeMissingTimestamp: boolean;
  allowRetryPendingSubmit: boolean;
  allowPromoteSubmittedRecorded: boolean;
  allowMarkSubmittedFailed: boolean;
}

interface ReconcileSupervisorConfig {
  staleMinutes: number;
  maxActionsPerRun: number;
  failureBudgetPerHour: number;
  pauseMinutesOnBudgetExceeded: number;
  alertWebhookUrl?: string;
  slackWebhookUrl?: string;
  policy: ReconcileActionPolicy;
  updatedAt: string;
}

interface ReconcileFailureBudgetState {
  windowHour: string;
  failures: number;
  pausedUntilMs?: number;
}

interface ProviderHealthState {
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  state: 'closed' | 'open';
  openUntilMs?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

const providerHealth = new Map<string, ProviderHealthState>();
let reconcileSupervisorConfigOverride: ReconcileSupervisorConfig | null = null;
let reconcileFailureBudgetState: ReconcileFailureBudgetState | null = null;

function nowIso() {
  return new Date().toISOString();
}

function auditDir() {
  return process.env.TAP_DATA_DIR || path.join(process.cwd(), 'output');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
    return sorted;
  }
  return value;
}

function hashObject(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function currentUtcHourKey() {
  return new Date().toISOString().slice(0, 13);
}

function sourceRetryBudgetLimit() {
  return Number(process.env.TAP_SOURCE_RETRY_BUDGET_PER_HOUR || 100);
}

function sourceRetryMaxAttempts() {
  return Number(process.env.TAP_SOURCE_RETRY_MAX_ATTEMPTS || 3);
}

function sourceRetryBaseDelayMs() {
  return Number(process.env.TAP_SOURCE_RETRY_BASE_DELAY_MS || 3000);
}

function consumeSourceRetryBudget(tenantId: string | undefined, provider: string): boolean {
  const key = `${tenantId || 'global'}:${provider}`;
  const hour = currentUtcHourKey();
  const usage = sourceRetryBudgetPerHour.get(key);
  if (!usage || usage.windowHour !== hour) {
    sourceRetryBudgetPerHour.set(key, { windowHour: hour, count: 1 });
    return true;
  }
  if (usage.count >= sourceRetryBudgetLimit()) return false;
  usage.count += 1;
  sourceRetryBudgetPerHour.set(key, usage);
  return true;
}

function providerCircuitThreshold() {
  return Number(process.env.TAP_SOURCE_CB_FAILURE_THRESHOLD || 3);
}

function providerCircuitOpenMs() {
  return Number(process.env.TAP_SOURCE_CB_OPEN_MS || 30000);
}

function providerKey(tenantId: string | undefined, provider: string) {
  return `${tenantId || 'global'}:${provider}`;
}

function parseFailoverOrderConfig(): Record<string, string[]> {
  const raw = process.env.TAP_SOURCE_FAILOVER_ORDER_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed || {})) {
      if (!Array.isArray(v)) continue;
      const list = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (list.length > 0) out[k] = list;
    }
    return out;
  } catch {
    return {};
  }
}

function getDefaultFailoverProviders(tenantId: string | undefined, provider: string): string[] {
  const cfg = parseFailoverOrderConfig();
  const tenantKey = `${tenantId || 'global'}:${provider}`;
  const globalKey = `global:${provider}`;
  return cfg[tenantKey] || cfg[globalKey] || [];
}

function parseRoutingWeightsConfig(): Record<string, number> {
  const raw = process.env.TAP_SOURCE_ROUTING_WEIGHTS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed || {})) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function getRoutingWeight(tenantId: string | undefined, provider: string): number {
  const cfg = parseRoutingWeightsConfig();
  const tenantKey = `${tenantId || 'global'}:${provider}`;
  return cfg[tenantKey] ?? cfg[`global:${provider}`] ?? cfg[provider] ?? 0;
}

function routingStrategyDefault(): 'ordered' | 'health-weighted' {
  return process.env.TAP_SOURCE_ROUTING_STRATEGY === 'health-weighted' ? 'health-weighted' : 'ordered';
}

function getProviderHealthEntry(key: string): ProviderHealthState {
  const current = providerHealth.get(key);
  if (current) return current;
  const created: ProviderHealthState = {
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    state: 'closed'
  };
  providerHealth.set(key, created);
  return created;
}

function providerHealthScore(entry: ProviderHealthState): number {
  if (entry.state === 'open') return 0;
  const total = entry.successCount + entry.failureCount;
  const successRate = total === 0 ? 1 : entry.successCount / total;
  const penalty = Math.min(0.5, entry.consecutiveFailures * 0.1);
  return Math.max(0, Math.round((successRate - penalty) * 100));
}

function isFailoverEligibleError(error: AdapterError): boolean {
  if (!error.retryable) return false;
  return (
    error.code === 'upstream_unavailable' ||
    error.code === 'upstream_timeout' ||
    error.code === 'upstream_bad_response'
  );
}

function rankProvidersForRouting(
  tenantId: string | undefined,
  providers: string[],
  strategy: 'ordered' | 'health-weighted',
  routingWeights?: Record<string, number>
): Array<{
  provider: string;
  healthScore: number;
  weight: number;
  weightedScore: number;
}> {
  const rows = providers.map((provider) => {
    const entry = getProviderHealthEntry(providerKey(tenantId, provider));
    const healthScore = providerHealthScore(entry);
    const weight =
      routingWeights && Number.isFinite(routingWeights[provider])
        ? Number(routingWeights[provider])
        : getRoutingWeight(tenantId, provider);
    const weightedScore = healthScore + weight;
    return { provider, healthScore, weight, weightedScore };
  });
  if (strategy === 'ordered') return rows;
  return rows.sort((a, b) => b.weightedScore - a.weightedScore || b.healthScore - a.healthScore);
}

function ensureCircuitClosedOrThrow(tenantId: string | undefined, provider: string) {
  const key = providerKey(tenantId, provider);
  const entry = getProviderHealthEntry(key);
  if (entry.state !== 'open') return;
  if (entry.openUntilMs && Date.now() >= entry.openUntilMs) {
    entry.state = 'closed';
    entry.openUntilMs = undefined;
    entry.consecutiveFailures = 0;
    providerHealth.set(key, entry);
    return;
  }
  throw new AdapterError('upstream_unavailable', `circuit open for ${key}`, {
    statusCode: 503,
    retryable: true,
    details: {
      circuitState: entry.state,
      openUntil: entry.openUntilMs ? new Date(entry.openUntilMs).toISOString() : null,
      consecutiveFailures: entry.consecutiveFailures
    }
  });
}

function recordProviderSuccess(tenantId: string | undefined, provider: string) {
  const key = providerKey(tenantId, provider);
  const entry = getProviderHealthEntry(key);
  entry.successCount += 1;
  entry.consecutiveFailures = 0;
  entry.state = 'closed';
  entry.openUntilMs = undefined;
  entry.lastSuccessAt = nowIso();
  providerHealth.set(key, entry);
}

function recordProviderFailure(
  tenantId: string | undefined,
  provider: string,
  errorCode: string,
  errorMessage: string
) {
  const key = providerKey(tenantId, provider);
  const entry = getProviderHealthEntry(key);
  entry.failureCount += 1;
  entry.consecutiveFailures += 1;
  entry.lastFailureAt = nowIso();
  entry.lastErrorCode = errorCode;
  entry.lastErrorMessage = errorMessage;
  if (entry.consecutiveFailures >= providerCircuitThreshold()) {
    entry.state = 'open';
    entry.openUntilMs = Date.now() + providerCircuitOpenMs();
  }
  providerHealth.set(key, entry);
}

function enforceSourceQuota(tenantId: string, provider: string, quotaPerHour: number) {
  const key = `${tenantId}:${provider}`;
  const hour = currentUtcHourKey();
  const usage = sourceUsagePerHour.get(key);
  if (!usage || usage.windowHour !== hour) {
    sourceUsagePerHour.set(key, { windowHour: hour, count: 1 });
    return;
  }
  if (usage.count >= quotaPerHour) {
    throw new AdapterError('upstream_unavailable', `quota exceeded for ${tenantId}/${provider}`, {
      statusCode: 429,
      retryable: false,
      details: { quotaPerHour }
    });
  }
  usage.count += 1;
  sourceUsagePerHour.set(key, usage);
}

async function appendSourceAudit(entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(auditDir(), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(path.join(auditDir(), 'source-adapter-audit.ndjson'), line, 'utf8');
}

async function appendSourceDlq(entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(auditDir(), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(path.join(auditDir(), 'source-adapter-dlq.ndjson'), line, 'utf8');
}

async function readSourceDlq(limit = 50): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(path.join(auditDir(), 'source-adapter-dlq.ndjson'), 'utf8');
    const rows = raw
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((v): v is Record<string, unknown> => v !== null);
    return rows.slice(-Math.max(1, limit)).reverse();
  } catch {
    return [];
  }
}

async function processSourceRetryQueueTick(maxItems = 5): Promise<number> {
  let processed = 0;
  for (let i = 0; i < sourceRetryQueue.length && processed < maxItems; i += 1) {
    const entry = sourceRetryQueue[i];
    if (entry.nextAttemptAtMs > Date.now()) continue;
    processed += 1;
    entry.attempts += 1;
    try {
      const response = await executeSourceCollectWorkflow({
        ...entry.requestData,
        idempotencyKey: entry.requestData.idempotencyKey || `retry-${entry.queueId}-a${entry.attempts}`
      });
      await appendSourceAudit({
        at: nowIso(),
        retryQueueId: entry.queueId,
        replayedFromDlqId: entry.dlqId || null,
        mode: 'retry_worker_success',
        provider: entry.requestData.provider,
        tenantId: entry.requestData.tenantId,
        subjectCommitment: entry.requestData.subjectCommitment,
        proofHash: response.proof.proofHash,
        settlementId:
          response.settlement && typeof response.settlement === 'object'
            ? (response.settlement as Record<string, unknown>).settlementId
            : null
      });
      sourceRetryQueue.splice(i, 1);
      i -= 1;
    } catch (error) {
      const e =
        error instanceof AdapterError
          ? error
          : new AdapterError('upstream_unavailable', String(error), { retryable: true, statusCode: 502 });
      entry.lastError = { code: e.code, message: e.message };
      if (!e.retryable || entry.attempts >= sourceRetryMaxAttempts()) {
        await appendSourceDlq({
          dlqId: `dlq_retry_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          at: nowIso(),
          mode: 'retry_worker_exhausted',
          retryQueueId: entry.queueId,
          replayedFromDlqId: entry.dlqId || null,
          requestData: entry.requestData,
          errorCode: e.code,
          errorMessage: e.message,
          retryable: e.retryable,
          statusCode: e.statusCode
        });
        sourceRetryQueue.splice(i, 1);
        i -= 1;
      } else {
        const delay = sourceRetryBaseDelayMs() * 2 ** Math.max(0, entry.attempts - 1);
        entry.nextAttemptAtMs = Date.now() + delay;
      }
    }
  }
  return processed;
}

async function appendPolicySettlementAudit(entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(auditDir(), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(path.join(auditDir(), 'policy-settlement-audit.ndjson'), line, 'utf8');
}

async function appendSettlementReconcileAudit(entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(auditDir(), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(path.join(auditDir(), 'settlement-reconcile-audit.ndjson'), line, 'utf8');
}

async function readSettlementReconcileAudit(limit = 50): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(path.join(auditDir(), 'settlement-reconcile-audit.ndjson'), 'utf8');
    const rows = raw
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((v): v is Record<string, unknown> => v !== null);
    return rows.slice(-Math.max(1, limit)).reverse();
  } catch {
    return [];
  }
}

function settlementReconcileStaleMinutesDefault() {
  return Number(process.env.TAP_SETTLEMENT_RECONCILE_STALE_MINUTES || 15);
}

function reconcileSupervisorDefaults(): ReconcileSupervisorConfig {
  return {
    staleMinutes: Math.max(1, Number(process.env.TAP_SETTLEMENT_RECONCILE_STALE_MINUTES || 15)),
    maxActionsPerRun: Math.max(1, Number(process.env.TAP_SETTLEMENT_RECONCILE_MAX_ACTIONS_PER_RUN || 200)),
    failureBudgetPerHour: Math.max(1, Number(process.env.TAP_SETTLEMENT_RECONCILE_FAILURE_BUDGET_PER_HOUR || 20)),
    pauseMinutesOnBudgetExceeded: Math.max(
      1,
      Number(process.env.TAP_SETTLEMENT_RECONCILE_PAUSE_MINUTES_ON_BUDGET_EXCEEDED || 30)
    ),
    alertWebhookUrl: process.env.TAP_SETTLEMENT_RECONCILE_ALERT_WEBHOOK_URL || undefined,
    slackWebhookUrl: process.env.TAP_SETTLEMENT_RECONCILE_SLACK_WEBHOOK_URL || undefined,
    policy: {
      allowFinalizeMissingTimestamp:
        process.env.TAP_SETTLEMENT_RECONCILE_ALLOW_FINALIZE_MISSING_TIMESTAMP !== '0',
      allowRetryPendingSubmit: process.env.TAP_SETTLEMENT_RECONCILE_ALLOW_RETRY_PENDING_SUBMIT !== '0',
      allowPromoteSubmittedRecorded:
        process.env.TAP_SETTLEMENT_RECONCILE_ALLOW_PROMOTE_SUBMITTED_RECORDED !== '0',
      allowMarkSubmittedFailed: process.env.TAP_SETTLEMENT_RECONCILE_ALLOW_MARK_SUBMITTED_FAILED !== '0'
    },
    updatedAt: nowIso()
  };
}

function getReconcileSupervisorConfig(): ReconcileSupervisorConfig {
  return reconcileSupervisorConfigOverride || reconcileSupervisorDefaults();
}

function currentFailureBudgetWindow() {
  return currentUtcHourKey();
}

function getReconcileFailureBudgetState() {
  const windowHour = currentFailureBudgetWindow();
  if (!reconcileFailureBudgetState || reconcileFailureBudgetState.windowHour !== windowHour) {
    reconcileFailureBudgetState = { windowHour, failures: 0 };
  }
  return reconcileFailureBudgetState;
}

function isReconcilePausedNow(nowMs = Date.now()): boolean {
  const state = getReconcileFailureBudgetState();
  return Boolean(state.pausedUntilMs && nowMs < state.pausedUntilMs);
}

function recordReconcileFailure(config: ReconcileSupervisorConfig, nowMs = Date.now()) {
  const state = getReconcileFailureBudgetState();
  state.failures += 1;
  if (state.failures >= config.failureBudgetPerHour) {
    state.pausedUntilMs = nowMs + config.pauseMinutesOnBudgetExceeded * 60 * 1000;
  }
  reconcileFailureBudgetState = state;
  return state;
}

function clearReconcileFailureBudget(nowMs = Date.now()) {
  const state = getReconcileFailureBudgetState();
  if (state.failures > 0 || state.pausedUntilMs) {
    reconcileFailureBudgetState = { windowHour: currentFailureBudgetWindow(), failures: 0, pausedUntilMs: undefined };
    return true;
  }
  if (state.pausedUntilMs && nowMs >= state.pausedUntilMs) {
    reconcileFailureBudgetState = { windowHour: currentFailureBudgetWindow(), failures: 0, pausedUntilMs: undefined };
    return true;
  }
  return false;
}

async function postJsonSafely(url: string, payload: Record<string, unknown>) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // alert dispatch must never crash the worker
  }
}

async function notifyReconcileAlert(
  level: 'warning' | 'error',
  title: string,
  detail: Record<string, unknown>
) {
  const cfg = getReconcileSupervisorConfig();
  const payload = {
    at: nowIso(),
    subsystem: 'settlement_reconcile_supervisor',
    level,
    title,
    detail
  };
  if (cfg.alertWebhookUrl) {
    await postJsonSafely(cfg.alertWebhookUrl, payload);
  }
  if (cfg.slackWebhookUrl) {
    await postJsonSafely(cfg.slackWebhookUrl, {
      text: `[${level.toUpperCase()}] ${title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*\n\`\`\`${JSON.stringify(detail, null, 2)}\`\`\``
          }
        }
      ]
    });
  }
}

export async function runSettlementReconcileOnce(input?: {
  limit?: number;
  staleMinutes?: number;
  dryRun?: boolean;
  force?: boolean;
  policy?: Partial<ReconcileActionPolicy>;
}) {
  const cfg = getReconcileSupervisorConfig();
  const limit = Math.max(1, Number(input?.limit || cfg.maxActionsPerRun || 200));
  const staleMinutes = Math.max(1, Number(input?.staleMinutes || cfg.staleMinutes || settlementReconcileStaleMinutesDefault()));
  const dryRun = Boolean(input?.dryRun);
  const force = Boolean(input?.force);
  const policy: ReconcileActionPolicy = {
    allowFinalizeMissingTimestamp:
      input?.policy?.allowFinalizeMissingTimestamp ?? cfg.policy.allowFinalizeMissingTimestamp,
    allowRetryPendingSubmit: input?.policy?.allowRetryPendingSubmit ?? cfg.policy.allowRetryPendingSubmit,
    allowPromoteSubmittedRecorded:
      input?.policy?.allowPromoteSubmittedRecorded ?? cfg.policy.allowPromoteSubmittedRecorded,
    allowMarkSubmittedFailed: input?.policy?.allowMarkSubmittedFailed ?? cfg.policy.allowMarkSubmittedFailed
  };
  const staleMs = staleMinutes * 60 * 1000;
  const nowMs = Date.now();
  const records = await listRecentSettlements(limit);
  const actions: Array<Record<string, unknown>> = [];

  for (const record of records) {
    const createdAtMs = parseIsoMs(record.createdAt) || nowMs;
    const ageMs = nowMs - createdAtMs;
    let action: Record<string, unknown> | null = null;

    if (
      policy.allowFinalizeMissingTimestamp &&
      (record.status === 'recorded' ||
        record.status === 'confirmed' ||
        record.status === 'failed' ||
        record.status === 'rejected') &&
      !record.finalizedAt
    ) {
      action = {
        kind: 'finalize_missing_timestamp',
        targetStatus: record.status,
        update: {
          settlementId: record.settlementId,
          status: record.status,
          anchored: record.anchored,
          txHash: record.txHash,
          eventId: record.eventId,
          confirmationSource: 'reconciler_finalize'
        }
      };
    } else if (
      policy.allowRetryPendingSubmit &&
      record.status === 'pending_submit' &&
      (force || ageMs >= staleMs)
    ) {
      action = {
        kind: 'retry_pending_submit',
        targetStatus: 'submitted',
        update: {
          settlementId: record.settlementId,
          status: 'submitted',
          anchored: record.anchored,
          txHash: record.txHash,
          eventId: record.eventId,
          confirmationSource: 'reconciler_submit_retry'
        }
      };
    } else if (record.status === 'submitted' && (force || ageMs >= staleMs)) {
      const proofVerification = verifyProofEnvelope(record.proof);
      if (proofVerification.verified && !policy.allowPromoteSubmittedRecorded) continue;
      if (!proofVerification.verified && !policy.allowMarkSubmittedFailed) continue;
      action = {
        kind: proofVerification.verified ? 'promote_submitted_recorded' : 'mark_submitted_failed',
        targetStatus: proofVerification.verified ? 'recorded' : 'failed',
        verifyReason: proofVerification.reason,
        update: {
          settlementId: record.settlementId,
          status: proofVerification.verified ? 'recorded' : 'failed',
          anchored: proofVerification.verified,
          txHash: record.txHash,
          eventId: record.eventId,
          confirmationSource: proofVerification.verified ? 'reconciler_local_verify' : 'reconciler_verify_failed'
        }
      };
    }

    if (!action) continue;
    actions.push({
      settlementId: record.settlementId,
      priorStatus: record.status,
      ageMinutes: Math.floor(ageMs / 60000),
      ...action
    });
    if (!dryRun) {
      const update = action.update as {
        settlementId: string;
        status: 'pending_submit' | 'submitted' | 'confirmed' | 'recorded' | 'rejected' | 'failed';
        anchored: boolean;
        txHash: string;
        eventId: string;
        confirmationSource: string;
      };
      await applySettlementFinality(update);
      await appendSettlementReconcileAudit({
        at: nowIso(),
        ...actions[actions.length - 1]
      });
    }
  }

  return {
    ranAt: nowIso(),
    dryRun,
    force,
    policy,
    limit,
    staleMinutes,
    scanned: records.length,
    actions
  };
}

async function truncateAuditFile(name: string): Promise<void> {
  await fs.mkdir(auditDir(), { recursive: true });
  await fs.writeFile(path.join(auditDir(), name), '', 'utf8');
}

async function resolveSettlementPolicyGuard(
  endpoint: string,
  proof: { publicInput: Record<string, string | number | boolean>; proofHash: string },
  metadata?: Record<string, unknown>
) {
  const linkage = extractPolicyLinkage(proof, metadata);
  const activePolicy =
    linkage.tenantId && linkage.policyId !== undefined
      ? await resolveActivePolicy(linkage.tenantId, linkage.policyId)
      : null;
  const guard = validatePolicyAtSettlement(linkage, activePolicy);
  await appendPolicySettlementAudit({
    at: nowIso(),
    endpoint,
    proofHash: proof.proofHash,
    linkage,
    activePolicy: activePolicy
      ? {
          version: activePolicy.version,
          policyHash: activePolicy.policyHash,
          effectiveAt: activePolicy.effectiveAt
        }
      : null,
    accepted: guard.ok,
    reason: guard.ok ? 'accepted' : guard.reason,
    detail: guard.ok ? undefined : guard.detail
  });
  return guard;
}

function ok(service: string) {
  return { service, status: 'ok', timestamp: nowIso() };
}

interface ActorContext {
  keyId: string;
  role: string;
  tenantId?: string;
}

function parseApiKeyRecords(): Record<string, { role: string; tenantId?: string }> {
  const raw = process.env.TAP_API_KEYS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { role: string; tenantId?: string }>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseBearerOrApiKey(req: express.Request): string | null {
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const apiKey = req.header('x-api-key');
  return apiKey ? apiKey.trim() : null;
}

function resolveActor(req: express.Request): ActorContext | null {
  const provided = parseBearerOrApiKey(req);
  if (!provided) return null;
  const records = parseApiKeyRecords();
  const actor = records[provided];
  if (!actor) return null;
  const parsedRole = RoleSchema.safeParse(actor.role);
  if (!parsedRole.success) return null;
  return {
    keyId: provided,
    role: parsedRole.data,
    tenantId: actor.tenantId
  };
}

function requireActor(req: express.Request, res: express.Response): ActorContext | null {
  const actor = resolveActor(req);
  if (!actor) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return actor;
}

function requireAdmin(actor: ActorContext, res: express.Response): boolean {
  if (actor.role !== 'CONSORTIUM_ADMIN') {
    res.status(403).json({ error: 'forbidden_role' });
    return false;
  }
  return true;
}

function requireAnyRole(actor: ActorContext, roles: string[], res: express.Response): boolean {
  if (actor.role === 'CONSORTIUM_ADMIN') return true;
  if (!roles.includes(actor.role)) {
    res.status(403).json({ error: 'forbidden_role' });
    return false;
  }
  return true;
}

function requireTenantScope(
  actor: ActorContext,
  tenantId: string,
  res: express.Response
): boolean {
  if (actor.role === 'CONSORTIUM_ADMIN') return true;
  if (!actor.tenantId || actor.tenantId !== tenantId) {
    res.status(403).json({ error: 'forbidden_tenant_scope' });
    return false;
  }
  return true;
}

function parseOr400<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: unknown } },
  body: unknown
) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error } as const;
  }
  return { data: parsed.data } as const;
}

function parseProviderSourceOrThrow(
  provider: 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank',
  source: unknown
): SourceAdapterRequest['source'] {
  if (provider === 'mock-bank') {
    return MockBankSourceSchema.parse(source || {});
  }
  if (provider === 'generic-rest') {
    return GenericRestSourceSchema.parse(source || {});
  }
  if (provider === 'increase') {
    return IncreaseSourceSchema.parse(source || {});
  }
  if (provider === 'persona') {
    return PersonaSourceSchema.parse(source || {});
  }
  if (provider === 'custody-holdings') {
    return CustodyHoldingsSourceSchema.parse(source || {});
  }
  if (provider === 'zktls-employer') {
    return ZkTlsEmployerSourceSchema.parse(source || {});
  }
  if (provider === 'zktls-bank') {
    return ZkTlsBankSourceSchema.parse(source || {});
  }
  return PlaidSourceSchema.parse(source || {});
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function dayDiff(nowMs: number, targetMs: number): number {
  return Math.floor((targetMs - nowMs) / (24 * 60 * 60 * 1000));
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function providerSourceProfile(provider: string): 'employment' | 'bank' | null {
  if (provider === 'zktls-employer') return 'employment';
  if (provider === 'zktls-bank') return 'bank';
  return null;
}

function parsePersonaSignatureHeader(header: string | undefined): { t: string; v1: string } | null {
  if (!header) return null;
  const parts = header.split(',').map((v) => v.trim());
  const out: Record<string, string> = {};
  for (const part of parts) {
    const [k, v] = part.split('=', 2);
    if (k && v) out[k] = v;
  }
  if (!out.t || !out.v1) return null;
  return { t: out.t, v1: out.v1 };
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA.length !== normB.length) return false;
  const bufA = Buffer.from(normA, 'utf8');
  const bufB = Buffer.from(normB, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseBigIntSafe(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

function issuerControlDefaults(tenantId: string): IssuerControlConfig {
  return {
    tenantId,
    approvalExpiryMinutes: Number(process.env.TAP_ISSUER_APPROVAL_EXPIRY_MINUTES || 24 * 60),
    dualApprovalThresholdCents: process.env.TAP_ISSUER_DUAL_APPROVAL_THRESHOLD_CENTS || '0',
    requireReasonCode: process.env.TAP_ISSUER_REQUIRE_REASON_CODE === '1',
    allowedReasonCodes: (process.env.TAP_ISSUER_ALLOWED_REASON_CODES || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    updatedAt: nowIso()
  };
}

async function getIssuerControlConfig(tenantId?: string): Promise<IssuerControlConfig> {
  if (!tenantId) {
    return issuerControlDefaults('global');
  }
  const existing = await getIssuerControl(tenantId);
  return existing || issuerControlDefaults(tenantId);
}

function requiredApprovalsForRecord(record: IssuerRequestRecord, cfg: IssuerControlConfig): number {
  const threshold = parseBigIntSafe(cfg.dualApprovalThresholdCents) ?? 0n;
  if (threshold <= 0n) return 1;
  const amountRaw = record.payload?.amountCents ?? record.payload?.notionalCents;
  const amount = parseBigIntSafe(amountRaw) ?? 0n;
  return amount >= threshold ? 2 : 1;
}

function settlementRequiresIssuerApproval(kind: string): kind is IssuerRequestKind {
  return ['mint', 'burn', 'issue', 'allocate', 'restrict', 'redeem'].includes(kind);
}

function normalizeIssuerKindParam(kind: string | undefined): IssuerRequestKind | undefined {
  if (kind === 'mint' || kind === 'burn' || kind === 'issue' || kind === 'allocate' || kind === 'restrict' || kind === 'redeem') {
    return kind;
  }
  return undefined;
}

function resolveIssuerSubjectCommitment(kind: IssuerRequestKind, payload: Record<string, unknown>, fallback: string): string {
  if ((kind === 'mint') && typeof payload.recipientCommitment === 'string') return payload.recipientCommitment;
  if ((kind === 'burn' || kind === 'restrict' || kind === 'redeem') && typeof payload.holderCommitment === 'string') {
    return payload.holderCommitment;
  }
  if ((kind === 'issue' || kind === 'allocate') && typeof payload.investorCommitment === 'string') {
    return payload.investorCommitment;
  }
  return fallback;
}

function issuerPayloadMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const passthroughKeys = [
    'assetId',
    'issuerId',
    'recipientCommitment',
    'holderCommitment',
    'investorCommitment',
    'amountCents',
    'notionalCents',
    'quantityUnits',
    'securityId',
    'issuanceType',
    'allocationId',
    'restrictionCode',
    'redemptionType'
  ];
  for (const key of passthroughKeys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = value;
    }
  }
  return metadata;
}

async function createIssuerRequestRecord<T extends Record<string, unknown>>(
  kind: IssuerRequestKind,
  parsedData: T,
  actor: { keyId: string; role: string }
): Promise<IssuerRequestRecord> {
  return {
    requestId: `${kind}_${Date.now()}`,
    kind,
    tenantId: typeof parsedData.tenantId === 'string' ? parsedData.tenantId : undefined,
    policyId: typeof parsedData.policyId === 'number' ? parsedData.policyId : undefined,
    payload: parsedData,
    status: 'requested',
    makerKeyId: actor.keyId,
    makerRole: actor.role,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function assertIssuerRequestApprovedForSettlement(
  request: { operation: string; metadata?: Record<string, unknown> },
  res: express.Response
): Promise<{ approved: true; record?: IssuerRequestRecord } | { approved: false }> {
  if (!settlementRequiresIssuerApproval(request.operation)) {
    return { approved: true };
  }
  const issuerRequestId = request.metadata?.issuerRequestId;
  if (typeof issuerRequestId !== 'string' || issuerRequestId.length < 1) {
    res.status(422).json({ verified: false, reason: 'issuer_request_linkage_missing' });
    return { approved: false };
  }
  const kind = request.operation;
  const record = await getIssuerRequest(kind, issuerRequestId);
  if (!record) {
    res.status(422).json({ verified: false, reason: 'issuer_request_not_found' });
    return { approved: false };
  }
  if (record.status !== 'approved' || !record.approval) {
    res.status(422).json({ verified: false, reason: 'issuer_request_not_approved' });
    return { approved: false };
  }
  const cfg = await getIssuerControlConfig(record.tenantId);
  const approvals = record.approvals && record.approvals.length > 0 ? record.approvals : [record.approval];
  const requiredApprovals = requiredApprovalsForRecord(record, cfg);
  if (approvals.length < requiredApprovals) {
    res.status(422).json({
      verified: false,
      reason: 'issuer_approval_quorum_not_met',
      detail: { requiredApprovals, actualApprovals: approvals.length }
    });
    return { approved: false };
  }
  if (cfg.approvalExpiryMinutes > 0) {
    const latestApprovalMs = Math.max(
      ...approvals.map((a) => parseIsoMs(a.approvedAt) || 0)
    );
    const expiryMs = latestApprovalMs + cfg.approvalExpiryMinutes * 60 * 1000;
    if (latestApprovalMs > 0 && Date.now() > expiryMs) {
      res.status(422).json({
        verified: false,
        reason: 'issuer_approval_expired',
        detail: {
          approvalExpiryMinutes: cfg.approvalExpiryMinutes,
          latestApprovedAt: new Date(latestApprovalMs).toISOString(),
          expiredAt: new Date(expiryMs).toISOString()
        }
      });
      return { approved: false };
    }
  }
  if (cfg.requireReasonCode) {
    const missingReason = approvals.some((a) => !a.reasonCode);
    if (missingReason) {
      res.status(422).json({ verified: false, reason: 'issuer_reason_code_missing' });
      return { approved: false };
    }
    if (cfg.allowedReasonCodes.length > 0) {
      const invalid = approvals.find((a) => a.reasonCode && !cfg.allowedReasonCodes.includes(a.reasonCode));
      if (invalid) {
        res.status(422).json({
          verified: false,
          reason: 'issuer_reason_code_not_allowed',
          detail: { reasonCode: invalid.reasonCode, allowedReasonCodes: cfg.allowedReasonCodes }
        });
        return { approved: false };
      }
    }
  }
  return { approved: true, record };
}

async function enforceRiskOrRespond(
  res: express.Response,
  input: {
    tenantId?: string;
    operation: 'eligibility' | 'mint' | 'burn' | 'issue' | 'allocate' | 'restrict' | 'redeem';
    subjectCommitment: string;
    amountCents?: string;
    score?: number;
  }
): Promise<boolean> {
  if (!input.tenantId) return true;
  const decision = await evaluateAndRecordRisk({
    tenantId: input.tenantId,
    operation: input.operation,
    subjectCommitment: input.subjectCommitment,
    amountCents: input.amountCents,
    score: input.score
  });
  if (decision.ok) return true;
  res.status(422).json({
    error: decision.reason || 'risk_control_failed',
    detail: decision.detail,
    riskConfig: decision.config
  });
  return false;
}

app.get('/api/v1/health', (_req, res) => {
  res.json(ok('api-gateway'));
});

app.post('/api/v1/admin/demo/reset', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;

  await resetSettlementStore();
  mintRequestStore.clear();
  burnRequestStore.clear();
  stockIssueRequestStore.clear();
  stockAllocationRequestStore.clear();
  stockRestrictionRequestStore.clear();
  stockRedeemRequestStore.clear();
  transferRequestStore.clear();
  bridgeRequestStore.clear();
  sourceCollectIdempotency.clear();
  sourceUsagePerHour.clear();
  sourceRetryBudgetPerHour.clear();
  sourceRetryQueue.length = 0;
  providerHealth.clear();
  await resetIssuerStore();
  reconcileSupervisorConfigOverride = null;
  reconcileFailureBudgetState = null;
  resetRiskRuntimeState();
  await truncateAuditFile('source-adapter-audit.ndjson');
  await truncateAuditFile('source-adapter-dlq.ndjson');
  await truncateAuditFile('policy-settlement-audit.ndjson');
  await truncateAuditFile('settlement-reconcile-audit.ndjson');

  res.json({
    ok: true,
    resetAt: nowIso(),
    cleared: [
      'settlements',
      'issuer-requests',
      'mint-request-store',
      'burn-request-store',
      'transfer-request-store',
      'bridge-request-store',
      'source-idempotency',
      'source-usage',
      'source-retry-budget',
      'source-retry-queue',
      'provider-health',
      'risk-runtime-state',
      'source-adapter-audit.ndjson',
      'source-adapter-dlq.ndjson',
      'policy-settlement-audit.ndjson',
      'settlement-reconcile-audit.ndjson'
    ]
  });
});

app.get('/api/v1/diag/credentials', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;

  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  const providerFilter = typeof req.query.provider === 'string' ? req.query.provider : undefined;
  const rotateSoonDays = Number(req.query.rotateSoonDays || process.env.TAP_DIAG_ROTATE_SOON_DAYS || 14);
  const expireSoonDays = Number(req.query.expireSoonDays || process.env.TAP_DIAG_EXPIRE_SOON_DAYS || 14);

  const all = await listAllTenantProviderConfigs();
  const nowMs = Date.now();
  const rows: Array<Record<string, unknown>> = [];

  for (const cfg of all) {
    if (tenantFilter && cfg.tenantId !== tenantFilter) continue;
    if (providerFilter && cfg.provider !== providerFilter) continue;

    const authProfiles = toRecord(cfg.authProfiles);
    for (const [profileName, value] of Object.entries(authProfiles)) {
      const p = toRecord(value);
      const type = typeof p.type === 'string' ? p.type : 'unknown';
      const lifecycle = toRecord(p.lifecycle);
      const envRefs: string[] = [];

      if (type === 'oauth2-client-credentials') {
        if (typeof p.clientIdEnv === 'string') envRefs.push(p.clientIdEnv);
        if (typeof p.clientSecretEnv === 'string') envRefs.push(p.clientSecretEnv);
      } else if (typeof p.secretEnv === 'string') {
        envRefs.push(p.secretEnv);
      }

      const envPresence = envRefs.map((name) => ({
        name,
        present: Boolean(process.env[name])
      }));
      const missingEnv = envPresence.some((x) => !x.present);

      const rotateByMs = parseIsoMs(lifecycle.rotateBy);
      const expiresAtMs = parseIsoMs(lifecycle.expiresAt);
      const daysToRotate = rotateByMs === null ? null : dayDiff(nowMs, rotateByMs);
      const daysToExpire = expiresAtMs === null ? null : dayDiff(nowMs, expiresAtMs);

      let status = 'ok';
      if (expiresAtMs !== null && nowMs >= expiresAtMs) status = 'expired';
      else if (rotateByMs !== null && nowMs >= rotateByMs) status = 'rotation_overdue';
      else if (missingEnv) status = 'missing_env_secret';
      else if (expiresAtMs !== null && daysToExpire !== null && daysToExpire <= expireSoonDays) status = 'expires_soon';
      else if (rotateByMs !== null && daysToRotate !== null && daysToRotate <= rotateSoonDays) status = 'rotation_due_soon';

      rows.push({
        tenantId: cfg.tenantId,
        provider: cfg.provider,
        profileType: 'auth',
        authType: type,
        profileName,
        keyVersion: typeof lifecycle.keyVersion === 'string' ? lifecycle.keyVersion : undefined,
        owner: typeof lifecycle.owner === 'string' ? lifecycle.owner : undefined,
        lastRotatedAt: typeof lifecycle.lastRotatedAt === 'string' ? lifecycle.lastRotatedAt : undefined,
        rotateBy: typeof lifecycle.rotateBy === 'string' ? lifecycle.rotateBy : undefined,
        expiresAt: typeof lifecycle.expiresAt === 'string' ? lifecycle.expiresAt : undefined,
        daysToRotate,
        daysToExpire,
        envRefs: envPresence,
        status
      });
    }

    const mtlsProfiles = toRecord(cfg.mtlsProfiles);
    for (const [profileName, value] of Object.entries(mtlsProfiles)) {
      const p = toRecord(value);
      const lifecycle = toRecord(p.lifecycle);
      const envRefs: string[] = [];

      if (typeof p.certEnv === 'string') envRefs.push(p.certEnv);
      if (typeof p.keyEnv === 'string') envRefs.push(p.keyEnv);
      if (typeof p.caEnv === 'string') envRefs.push(p.caEnv);
      if (typeof p.passphraseEnv === 'string') envRefs.push(p.passphraseEnv);

      const envPresence = envRefs.map((name) => ({
        name,
        present: Boolean(process.env[name])
      }));
      const missingEnv = envPresence.some((x) => !x.present);

      const rotateByMs = parseIsoMs(lifecycle.rotateBy);
      const expiresAtMs = parseIsoMs(lifecycle.expiresAt);
      const daysToRotate = rotateByMs === null ? null : dayDiff(nowMs, rotateByMs);
      const daysToExpire = expiresAtMs === null ? null : dayDiff(nowMs, expiresAtMs);

      let status = 'ok';
      if (expiresAtMs !== null && nowMs >= expiresAtMs) status = 'expired';
      else if (rotateByMs !== null && nowMs >= rotateByMs) status = 'rotation_overdue';
      else if (missingEnv) status = 'missing_env_secret';
      else if (expiresAtMs !== null && daysToExpire !== null && daysToExpire <= expireSoonDays) status = 'expires_soon';
      else if (rotateByMs !== null && daysToRotate !== null && daysToRotate <= rotateSoonDays) status = 'rotation_due_soon';

      rows.push({
        tenantId: cfg.tenantId,
        provider: cfg.provider,
        profileType: 'mtls',
        profileName,
        keyVersion: typeof lifecycle.keyVersion === 'string' ? lifecycle.keyVersion : undefined,
        owner: typeof lifecycle.owner === 'string' ? lifecycle.owner : undefined,
        lastRotatedAt: typeof lifecycle.lastRotatedAt === 'string' ? lifecycle.lastRotatedAt : undefined,
        rotateBy: typeof lifecycle.rotateBy === 'string' ? lifecycle.rotateBy : undefined,
        expiresAt: typeof lifecycle.expiresAt === 'string' ? lifecycle.expiresAt : undefined,
        daysToRotate,
        daysToExpire,
        envRefs: envPresence,
        status
      });
    }
  }

  const summary: Record<string, number> = {
    ok: 0,
    rotation_due_soon: 0,
    rotation_overdue: 0,
    expires_soon: 0,
    expired: 0,
    missing_env_secret: 0
  };
  for (const row of rows) {
    const status = String(row.status || 'ok');
    summary[status] = (summary[status] || 0) + 1;
  }

  res.json({
    generatedAt: nowIso(),
    filters: { tenantId: tenantFilter, provider: providerFilter },
    windows: { rotateSoonDays, expireSoonDays },
    summary,
    records: rows
  });
});

app.get('/api/v1/diag/providers', (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  const providerFilter = typeof req.query.provider === 'string' ? req.query.provider : undefined;

  const records = [...providerHealth.entries()]
    .map(([key, value]) => {
      const [tenantId, provider] = key.split(':', 2);
      return {
        tenantId: tenantId === 'global' ? null : tenantId,
        provider,
        healthScore: providerHealthScore(value),
        state: value.state,
        successCount: value.successCount,
        failureCount: value.failureCount,
        consecutiveFailures: value.consecutiveFailures,
        openUntil: value.openUntilMs ? new Date(value.openUntilMs).toISOString() : null,
        lastSuccessAt: value.lastSuccessAt || null,
        lastFailureAt: value.lastFailureAt || null,
        lastErrorCode: value.lastErrorCode || null,
        lastErrorMessage: value.lastErrorMessage || null
      };
    })
    .filter((record) => {
      if (tenantFilter && record.tenantId !== tenantFilter) return false;
      if (providerFilter && record.provider !== providerFilter) return false;
      return true;
    })
    .sort((a, b) => Number(b.healthScore) - Number(a.healthScore));

  res.json({
    generatedAt: nowIso(),
    thresholds: {
      failureThreshold: providerCircuitThreshold(),
      openMs: providerCircuitOpenMs()
    },
    records
  });
});

app.get('/api/v1/diag/providers/ranked', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  const providersRaw = typeof req.query.providers === 'string' ? req.query.providers : '';
  const providers = providersRaw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (providers.length === 0) {
    return res.status(400).json({ error: 'providers_query_required' });
  }
  const strategy =
    req.query.strategy === 'health-weighted' || req.query.strategy === 'ordered'
      ? (req.query.strategy as 'ordered' | 'health-weighted')
      : routingStrategyDefault();
  const routingWeights: Record<string, number> = {};
  for (const provider of providers) {
    const cfg = tenantId
      ? await getTenantProviderConfig(
          tenantId,
          provider as 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank'
        )
      : null;
    routingWeights[provider] = Number.isFinite(cfg?.routingWeight) ? Number(cfg?.routingWeight) : getRoutingWeight(tenantId, provider);
  }

  const ranked = rankProvidersForRouting(tenantId, providers, strategy, routingWeights).map((row) => {
    const entry = getProviderHealthEntry(providerKey(tenantId, row.provider));
    return {
      provider: row.provider,
      healthScore: row.healthScore,
      routingWeight: row.weight,
      weightedScore: row.weightedScore,
      state: entry.state,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      consecutiveFailures: entry.consecutiveFailures
    };
  });

  res.json({
    generatedAt: nowIso(),
    tenantId: tenantId || null,
    strategy,
    ranked
  });
});

app.post('/api/v1/routing/config/upsert', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;

  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId : '';
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : '';
  if (!tenantId || !provider) return res.status(400).json({ error: 'tenantId_and_provider_required' });

  const existing = await getTenantProviderConfig(
    tenantId,
    provider as 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank'
  );
  if (!existing) return res.status(404).json({ error: 'tenant_provider_config_not_found' });

  const failoverProviders = Array.isArray(req.body?.failoverProviders)
    ? req.body.failoverProviders.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
    : existing.failoverProviders || [];
  const routingStrategy =
    req.body?.routingStrategy === 'health-weighted' || req.body?.routingStrategy === 'ordered'
      ? req.body.routingStrategy
      : existing.routingStrategy || 'ordered';
  const routingWeight = Number.isFinite(req.body?.routingWeight)
    ? Number(req.body.routingWeight)
    : existing.routingWeight || 0;

  const updated = await upsertTenantProviderConfig({
    ...existing,
    failoverProviders,
    routingStrategy,
    routingWeight
  });
  res.json(updated);
});

app.get('/api/v1/routing/configs', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  if (actor.role !== 'CONSORTIUM_ADMIN' && !tenantId) {
    return res.status(400).json({ error: 'tenant_id_required_for_non_admin' });
  }
  if (tenantId && !requireTenantScope(actor, tenantId, res)) return;
  const records =
    actor.role === 'CONSORTIUM_ADMIN' && !tenantId
      ? await listAllTenantProviderConfigs()
      : await listTenantProviderConfigs(tenantId || actor.tenantId || '');
  res.json({
    records: records.map((v) => ({
      tenantId: v.tenantId,
      provider: v.provider,
      failoverProviders: v.failoverProviders || [],
      routingStrategy: v.routingStrategy || 'ordered',
      routingWeight: v.routingWeight || 0,
      updatedAt: v.updatedAt
    }))
  });
});

app.get('/api/v1/reliability/source-retry-queue', (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  res.json({
    generatedAt: nowIso(),
    budgetPerHour: sourceRetryBudgetLimit(),
    maxAttempts: sourceRetryMaxAttempts(),
    baseDelayMs: sourceRetryBaseDelayMs(),
    records: sourceRetryQueue.map((entry) => ({
      queueId: entry.queueId,
      dlqId: entry.dlqId || null,
      tenantId: entry.requestData.tenantId || null,
      provider: entry.requestData.provider,
      subjectCommitment: entry.requestData.subjectCommitment,
      attempts: entry.attempts,
      nextAttemptAt: new Date(entry.nextAttemptAtMs).toISOString(),
      lastError: entry.lastError || null
    }))
  });
});

app.get('/api/v1/reliability/source-dlq', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const limit = Number(req.query.limit || 50);
  const records = await readSourceDlq(limit);
  res.json({ records });
});

app.post('/api/v1/reliability/source-retry/run-once', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const processed = await processSourceRetryQueueTick(Number(req.body?.maxItems || 5));
  res.json({
    ok: true,
    processed,
    pending: sourceRetryQueue.length
  });
});

app.post('/api/v1/reliability/source-dlq/replay', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;

  let requestData: SourceAdapterRequest | null = null;
  if (req.body?.requestData) {
    const parsed = SourceAdapterRequestSchema.safeParse(req.body.requestData);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request_data', detail: parsed.error });
    requestData = parsed.data;
  } else if (typeof req.body?.dlqId === 'string' && req.body.dlqId) {
    const records = await readSourceDlq(Number(req.body?.searchLimit || 200));
    const found = records.find((r) => r.dlqId === req.body.dlqId);
    if (!found) return res.status(404).json({ error: 'dlq_entry_not_found' });
    const parsed = SourceAdapterRequestSchema.safeParse(found.requestData);
    if (!parsed.success) return res.status(422).json({ error: 'dlq_request_invalid', detail: parsed.error });
    requestData = parsed.data;
  } else {
    return res.status(400).json({ error: 'request_data_or_dlq_id_required' });
  }

  try {
    const response = await executeSourceCollectWorkflow({
      ...requestData,
      idempotencyKey: requestData.idempotencyKey || `replay-${Date.now()}`
    });
    await appendSourceAudit({
      at: nowIso(),
      mode: 'manual_dlq_replay_success',
      actorKeyId: actor.keyId,
      provider: requestData.provider,
      tenantId: requestData.tenantId || null,
      subjectCommitment: requestData.subjectCommitment,
      proofHash: response.proof.proofHash,
      settlementId:
        response.settlement && typeof response.settlement === 'object'
          ? (response.settlement as Record<string, unknown>).settlementId
          : null
    });
    res.json({ ok: true, response });
  } catch (error) {
    const e =
      error instanceof AdapterError
        ? error
        : new AdapterError('upstream_unavailable', String(error), { retryable: true, statusCode: 502 });
    await appendSourceDlq({
      dlqId: `dlq_replay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: nowIso(),
      mode: 'manual_dlq_replay_failed',
      actorKeyId: actor.keyId,
      requestData,
      errorCode: e.code,
      errorMessage: e.message,
      retryable: e.retryable,
      statusCode: e.statusCode,
      details: e.details
    });
    res.status(e.statusCode).json({
      error: {
        code: e.code,
        message: e.message,
        retryable: e.retryable,
        details: e.details
      }
    });
  }
});

app.post('/api/v1/reliability/settlement-reconcile/run-once', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const paused = isReconcilePausedNow();
  if (paused && !Boolean(req.body?.forceSupervisor)) {
    const state = getReconcileFailureBudgetState();
    return res.status(429).json({
      error: 'reconcile_supervisor_paused',
      detail: {
        failures: state.failures,
        windowHour: state.windowHour,
        pausedUntil: state.pausedUntilMs ? new Date(state.pausedUntilMs).toISOString() : null
      }
    });
  }
  const result = await runSettlementReconcileOnce({
    limit: Number(req.body?.limit || 200),
    staleMinutes: Number(req.body?.staleMinutes || settlementReconcileStaleMinutesDefault()),
    dryRun: Boolean(req.body?.dryRun),
    force: Boolean(req.body?.force),
    policy: req.body?.policy
  });
  res.json(result);
});

app.get('/api/v1/reliability/settlement-reconcile/audit', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const limit = Math.max(1, Number(req.query.limit || 50));
  const records = await readSettlementReconcileAudit(limit);
  res.json({ records });
});

app.get('/api/v1/reliability/settlement-reconcile/supervisor', (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const cfg = getReconcileSupervisorConfig();
  const state = getReconcileFailureBudgetState();
  res.json({
    config: cfg,
    failureBudget: {
      windowHour: state.windowHour,
      failures: state.failures,
      failureBudgetPerHour: cfg.failureBudgetPerHour,
      pausedUntil: state.pausedUntilMs ? new Date(state.pausedUntilMs).toISOString() : null,
      paused: isReconcilePausedNow()
    }
  });
});

app.post('/api/v1/reliability/settlement-reconcile/supervisor/upsert', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const current = getReconcileSupervisorConfig();
  const next: ReconcileSupervisorConfig = {
    ...current,
    staleMinutes: Number.isFinite(req.body?.staleMinutes)
      ? Math.max(1, Number(req.body.staleMinutes))
      : current.staleMinutes,
    maxActionsPerRun: Number.isFinite(req.body?.maxActionsPerRun)
      ? Math.max(1, Number(req.body.maxActionsPerRun))
      : current.maxActionsPerRun,
    failureBudgetPerHour: Number.isFinite(req.body?.failureBudgetPerHour)
      ? Math.max(1, Number(req.body.failureBudgetPerHour))
      : current.failureBudgetPerHour,
    pauseMinutesOnBudgetExceeded: Number.isFinite(req.body?.pauseMinutesOnBudgetExceeded)
      ? Math.max(1, Number(req.body.pauseMinutesOnBudgetExceeded))
      : current.pauseMinutesOnBudgetExceeded,
    alertWebhookUrl:
      typeof req.body?.alertWebhookUrl === 'string'
        ? (req.body.alertWebhookUrl || undefined)
        : current.alertWebhookUrl,
    slackWebhookUrl:
      typeof req.body?.slackWebhookUrl === 'string'
        ? (req.body.slackWebhookUrl || undefined)
        : current.slackWebhookUrl,
    policy: {
      allowFinalizeMissingTimestamp:
        typeof req.body?.policy?.allowFinalizeMissingTimestamp === 'boolean'
          ? req.body.policy.allowFinalizeMissingTimestamp
          : current.policy.allowFinalizeMissingTimestamp,
      allowRetryPendingSubmit:
        typeof req.body?.policy?.allowRetryPendingSubmit === 'boolean'
          ? req.body.policy.allowRetryPendingSubmit
          : current.policy.allowRetryPendingSubmit,
      allowPromoteSubmittedRecorded:
        typeof req.body?.policy?.allowPromoteSubmittedRecorded === 'boolean'
          ? req.body.policy.allowPromoteSubmittedRecorded
          : current.policy.allowPromoteSubmittedRecorded,
      allowMarkSubmittedFailed:
        typeof req.body?.policy?.allowMarkSubmittedFailed === 'boolean'
          ? req.body.policy.allowMarkSubmittedFailed
          : current.policy.allowMarkSubmittedFailed
    },
    updatedAt: nowIso()
  };
  reconcileSupervisorConfigOverride = next;
  if (Boolean(req.body?.resetFailureBudget)) {
    reconcileFailureBudgetState = { windowHour: currentFailureBudgetWindow(), failures: 0 };
  }
  await appendSettlementReconcileAudit({
    at: nowIso(),
    kind: 'supervisor_config_updated',
    actorKeyId: actor.keyId,
    config: next
  });
  res.json(next);
});

app.post('/api/v1/reliability/settlement/manual-status', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;

  const status =
    req.body?.status === 'pending_submit' ||
    req.body?.status === 'submitted' ||
    req.body?.status === 'confirmed' ||
    req.body?.status === 'recorded' ||
    req.body?.status === 'rejected' ||
    req.body?.status === 'failed'
      ? req.body.status
      : null;
  if (!status) return res.status(400).json({ error: 'invalid_status' });
  if (typeof req.body?.settlementId !== 'string' && typeof req.body?.proofHash !== 'string') {
    return res.status(400).json({ error: 'settlement_id_or_proof_hash_required' });
  }

  const updated = await applySettlementFinality({
    settlementId: typeof req.body?.settlementId === 'string' ? req.body.settlementId : undefined,
    proofHash: typeof req.body?.proofHash === 'string' ? req.body.proofHash : undefined,
    status,
    anchored: typeof req.body?.anchored === 'boolean' ? req.body.anchored : undefined,
    txHash: typeof req.body?.txHash === 'string' ? req.body.txHash : undefined,
    eventId: typeof req.body?.eventId === 'string' ? req.body.eventId : undefined,
    confirmationSource:
      typeof req.body?.confirmationSource === 'string' ? req.body.confirmationSource : 'manual_operator_update'
  });
  if (!updated) return res.status(404).json({ error: 'settlement_not_found' });
  res.json({ ok: true, record: updated });
});

app.get('/api/v1/config/public', (_req, res) => {
  res.json({
    networkId: process.env.ZEKO_NETWORK_ID || 'testnet',
    zekoGraphqlUrl: process.env.ZEKO_GRAPHQL_URL || 'https://testnet.zeko.io/graphql',
    bridgeEnabled: true,
    environment: process.env.NODE_ENV || 'development',
    proofMode: getProofMode(),
    zktlsRepoPath: process.env.ZKTLS_REPO_PATH || 'external/zk-verify-poc'
  });
});

app.get('/api/v1/attest/zktls/status', async (_req, res) => {
  const status = await assertZkTlsRepoReady();
  res.json(status);
});

app.get('/api/v1/attest/zktls/latest', async (_req, res) => {
  try {
    const artifacts = await latestZkTlsArtifacts();
    res.json(artifacts);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/v1/attest/zktls/run', async (req, res) => {
  const mode = req.body?.mode === 'ineligible' ? 'ineligible' : 'eligible';
  const sourceProfile = req.body?.profile === 'bank' ? 'bank' : 'employment';
  try {
    const result = await runZkTlsPipeline({ mode, profile: sourceProfile });
    res.json({
      mode,
      profile: sourceProfile,
      stdoutPreview: result.stdout.slice(-4000),
      stderrPreview: result.stderr.slice(-4000),
      artifacts: result.artifacts
    });
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    res.status(500).json({
      error: err?.message || String(error),
      stdoutPreview: err?.stdout ? String(err.stdout).slice(-4000) : undefined,
      stderrPreview: err?.stderr ? String(err.stderr).slice(-4000) : undefined,
      hint: 'Ensure moon/proto/rust dependencies are installed in external/zk-verify-poc, then configure external/zk-verify-poc/.env.'
    });
  }
});

app.post('/api/v1/attest/zktls/ingest', async (req, res) => {
  const mode = req.body?.mode === 'ineligible' ? 'ineligible' : 'eligible';
  const sourceProfile = req.body?.profile === 'bank' ? 'bank' : 'employment';
  const runPipelineFirst = Boolean(req.body?.runPipelineFirst);
  const subjectCommitment = String(req.body?.subjectCommitment || 'zktls_subject');
  const settle = req.body?.settle === false ? false : true;
  const tenantId = req.body?.tenantId ? String(req.body.tenantId) : undefined;
  const policyId = req.body?.policyId !== undefined ? Number(req.body.policyId) : undefined;

  let pipelineStdout = '';
  let pipelineStderr = '';
  let externalVerified = false;

  try {
    let artifacts;
    if (runPipelineFirst) {
      const result = await runZkTlsPipeline({ mode, profile: sourceProfile });
      artifacts = result.artifacts;
      pipelineStdout = result.stdout;
      pipelineStderr = result.stderr;
      externalVerified = /\[verify-chain\] GraphQL source-of-truth verification passed/.test(result.stdout);
    } else {
      artifacts = await latestZkTlsArtifacts();
    }

    let policySnapshot:
      | {
          version: number;
          policyHash: string;
          effectiveAt: string;
        }
      | undefined;
    if (tenantId && Number.isFinite(policyId)) {
      const activePolicy = await resolveActivePolicy(tenantId, Number(policyId));
      if (activePolicy) {
        policySnapshot = {
          version: activePolicy.version,
          policyHash: activePolicy.policyHash,
          effectiveAt: activePolicy.effectiveAt
        };
      }
    }

    const tapProof = mapZkTlsArtifactsToTapProof(artifacts, {
      subjectCommitment,
      sourceProfile,
      tenantId,
      policyId,
      policyVersion: policySnapshot?.version,
      policyHash: policySnapshot?.policyHash
    });
    if (!tapProof) {
      return res.status(422).json({
        error: 'zktls_proof_missing',
        artifacts,
        stdoutPreview: pipelineStdout.slice(-4000),
        stderrPreview: pipelineStderr.slice(-4000)
      });
    }

    const txHashMatch = pipelineStdout.match(/\[settle\] Transaction hash:\s*([A-Za-z0-9]+)/);
    const externalTxHash = txHashMatch ? txHashMatch[1] : null;

    let settlementResult: unknown = null;
    if (settle) {
      const policyGuard = await resolveSettlementPolicyGuard('/api/v1/attest/zktls/ingest', tapProof, {
        tenantId,
        policyId
      });
      if (!policyGuard.ok) {
        return res.status(422).json({
          error: policyGuard.reason,
          detail: policyGuard.detail
        });
      }

      settlementResult = await upsertSettlementByProofHash(
        {
          operation: 'eligibility',
          subjectCommitment,
          proof: tapProof,
          metadata: {
            source: 'zk-verify-poc',
            runId: artifacts.runId,
            outputDir: artifacts.outputDir,
            externalVerified,
            externalTxHash,
            tenantId: policyGuard.tenantId,
            policyId: policyGuard.policyId,
            policyVersion: policyGuard.policyVersion,
            policyHash: policyGuard.policySnapshotHash,
            policySnapshotHash: policyGuard.policySnapshotHash,
            policyEffectiveAt: policyGuard.policyEffectiveAt
          }
        },
        {
          status: externalVerified || Boolean(artifacts.settlement) || runPipelineFirst ? 'submitted' : 'failed',
          anchored: false,
          txHash: externalTxHash || undefined,
          confirmationSource: 'zktls_ingest'
        }
      );
    }

    return res.json({
      mode,
      profile: sourceProfile,
      runPipelineFirst,
      externalVerified,
      externalTxHash,
      tapProof,
      settlement: settlementResult,
      artifacts,
      stdoutPreview: pipelineStdout.slice(-4000),
      stderrPreview: pipelineStderr.slice(-4000)
    });
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return res.status(500).json({
      error: err?.message || String(error),
      stdoutPreview: err?.stdout ? String(err.stdout).slice(-4000) : undefined,
      stderrPreview: err?.stderr ? String(err.stderr).slice(-4000) : undefined
    });
  }
});

app.post('/api/v1/settlement/zktls/submit-latest', async (req, res) => {
  try {
    const subjectCommitment = String(req.body?.subjectCommitment || 'zktls_subject');
    const sourceProfile = req.body?.profile === 'bank' ? 'bank' : 'employment';
    const runId = req.body?.runId ? String(req.body.runId) : undefined;
    const tenantId = req.body?.tenantId ? String(req.body.tenantId) : undefined;
    const policyId = req.body?.policyId !== undefined ? Number(req.body.policyId) : undefined;
    const artifacts = runId ? await getZkTlsArtifacts(runId) : await latestZkTlsArtifacts();
    let policySnapshot:
      | {
          version: number;
          policyHash: string;
          effectiveAt: string;
        }
      | undefined;
    if (tenantId && Number.isFinite(policyId)) {
      const activePolicy = await resolveActivePolicy(tenantId, Number(policyId));
      if (activePolicy) {
        policySnapshot = {
          version: activePolicy.version,
          policyHash: activePolicy.policyHash,
          effectiveAt: activePolicy.effectiveAt
        };
      }
    }

    const tapProof = mapZkTlsArtifactsToTapProof(artifacts, {
      subjectCommitment,
      sourceProfile,
      tenantId,
      policyId,
      policyVersion: policySnapshot?.version,
      policyHash: policySnapshot?.policyHash
    });
    if (!tapProof) {
      return res.status(422).json({ error: 'zktls_proof_missing', artifacts });
    }

    const policyGuard = await resolveSettlementPolicyGuard('/api/v1/settlement/zktls/submit-latest', tapProof, {
      tenantId,
      policyId
    });
    if (!policyGuard.ok) {
      return res.status(422).json({
        error: policyGuard.reason,
        detail: policyGuard.detail
      });
    }

    const settleTask = await runZkTlsTask('poc:settle', { runId: artifacts.runId });
    const txHashMatch = settleTask.stdout.match(/\[settle\] Transaction hash:\s*([A-Za-z0-9]+)/);
    const txHash = txHashMatch ? txHashMatch[1] : undefined;

    const settlement = await upsertSettlementByProofHash(
      {
        operation: 'eligibility',
        subjectCommitment,
        proof: tapProof,
        metadata: {
          source: 'zk-verify-poc',
          runId: artifacts.runId,
          outputDir: artifacts.outputDir,
          tenantId: policyGuard.tenantId,
          policyId: policyGuard.policyId,
          policyVersion: policyGuard.policyVersion,
          policyHash: policyGuard.policySnapshotHash,
          policySnapshotHash: policyGuard.policySnapshotHash,
          policyEffectiveAt: policyGuard.policyEffectiveAt
        }
      },
      {
        status: 'submitted',
        anchored: false,
        txHash,
        confirmationSource: 'zktls_settle_task'
      }
    );

    return res.json({
      settlement,
      artifacts,
      stdoutPreview: settleTask.stdout.slice(-4000),
      stderrPreview: settleTask.stderr.slice(-4000)
    });
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return res.status(500).json({
      error: err?.message || String(error),
      stdoutPreview: err?.stdout ? String(err.stdout).slice(-4000) : undefined,
      stderrPreview: err?.stderr ? String(err.stderr).slice(-4000) : undefined
    });
  }
});

app.post('/api/v1/finality/sync/zktls-latest', async (_req, res) => {
  try {
    const runId = _req.body?.runId ? String(_req.body.runId) : undefined;
    const subjectCommitment = String(_req.body?.subjectCommitment || 'zktls_subject');
    const sourceProfile = _req.body?.profile === 'bank' ? 'bank' : 'employment';
    const artifacts = runId ? await getZkTlsArtifacts(runId) : await latestZkTlsArtifacts();
    const proof = mapZkTlsArtifactsToTapProof(artifacts, { subjectCommitment, sourceProfile });
    if (!proof) {
      return res.status(422).json({ error: 'zktls_proof_missing', artifacts });
    }

    const verifyTask = await runZkTlsTask('poc:verify-chain', { runId: artifacts.runId });
    const externalVerified = /\[verify-chain\] GraphQL source-of-truth verification passed/.test(verifyTask.stdout);
    const txHashMatch = verifyTask.stdout.match(/\[verify-chain\] settlement tx:\s*([A-Za-z0-9]+)/);
    const settlementTxHash = txHashMatch ? txHashMatch[1] : undefined;

    const existing = await getSettlementByProofHash(proof.proofHash);
    if (!existing) {
      return res.status(404).json({
        error: 'settlement_for_proof_not_found',
        proofHash: proof.proofHash,
        stdoutPreview: verifyTask.stdout.slice(-4000),
        stderrPreview: verifyTask.stderr.slice(-4000)
      });
    }

    // verify-chain may return any matching settlement event for the proof hash.
    // Preserve the submit step tx hash when already recorded.
    const txHashForFinality = existing.txHash || settlementTxHash;

    const updated = await applySettlementFinality({
      settlementId: existing.settlementId,
      status: externalVerified ? 'confirmed' : 'failed',
      anchored: externalVerified,
      txHash: txHashForFinality,
      confirmationSource: 'zktls_verify_chain'
    });

    return res.json({
      updated,
      externalVerified,
      stdoutPreview: verifyTask.stdout.slice(-4000),
      stderrPreview: verifyTask.stderr.slice(-4000)
    });
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return res.status(500).json({
      error: err?.message || String(error),
      stdoutPreview: err?.stdout ? String(err.stdout).slice(-4000) : undefined,
      stderrPreview: err?.stderr ? String(err.stderr).slice(-4000) : undefined
    });
  }
});

app.post('/api/v1/attest/upload-statement', (req, res) => {
  const parsed = parseOr400(UploadStatementRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  res.json({
    attestationId: `att_stmt_${Date.now()}`,
    type: 'statement',
    receivedAt: nowIso(),
    request: parsed.data
  });
});

app.post('/api/v1/attest/verify-phone', (req, res) => {
  const parsed = parseOr400(VerifyPhoneRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  res.json({
    attestationId: `att_phone_${Date.now()}`,
    type: 'phone',
    score: 95,
    receivedAt: nowIso(),
    request: parsed.data
  });
});

app.post('/api/v1/attest/identity/persona/webhook', (req, res) => {
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'persona_webhook_secret_not_configured' });
  }

  const sig = parsePersonaSignatureHeader(req.header('persona-signature') || req.header('x-persona-signature'));
  if (!sig) {
    return res.status(401).json({ verified: false, reason: 'signature_header_missing' });
  }

  const toleranceSec = Number(process.env.PERSONA_WEBHOOK_TOLERANCE_SEC || 300);
  const ts = Number(sig.t);
  if (!Number.isFinite(ts)) {
    return res.status(401).json({ verified: false, reason: 'signature_timestamp_invalid' });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) {
    return res.status(401).json({ verified: false, reason: 'signature_timestamp_out_of_tolerance' });
  }

  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const payload = rawBody && rawBody.length > 0 ? rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const signedPayload = `${sig.t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (!timingSafeHexEqual(expected, sig.v1)) {
    return res.status(401).json({ verified: false, reason: 'signature_mismatch' });
  }

  const body = toRecord(req.body);
  const data = toRecord(body.data);
  const attrs = toRecord(data.attributes);
  const inquiryId =
    (typeof data.id === 'string' ? data.id : undefined) ||
    (typeof attrs.inquiryId === 'string' ? attrs.inquiryId : undefined) ||
    '';
  const status =
    (typeof attrs.status === 'string' ? attrs.status : undefined) ||
    (typeof data.status === 'string' ? data.status : undefined) ||
    '';
  const referenceId =
    (typeof attrs['reference-id'] === 'string' ? attrs['reference-id'] : undefined) ||
    (typeof attrs.referenceId === 'string' ? attrs.referenceId : undefined) ||
    '';

  res.json({
    verified: true,
    provider: 'persona',
    receivedAt: nowIso(),
    eventType: typeof body.type === 'string' ? body.type : 'unknown',
    inquiryId,
    status,
    referenceId
  });
});

app.post('/api/v1/attest/holdings/custody/webhook', (req, res) => {
  const secret = process.env.CUSTODY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'custody_webhook_secret_not_configured' });
  }

  const sig = parsePersonaSignatureHeader(req.header('x-custody-signature') || req.header('custody-signature'));
  if (!sig) {
    return res.status(401).json({ verified: false, reason: 'signature_header_missing' });
  }

  const toleranceSec = Number(process.env.CUSTODY_WEBHOOK_TOLERANCE_SEC || 300);
  const ts = Number(sig.t);
  if (!Number.isFinite(ts)) {
    return res.status(401).json({ verified: false, reason: 'signature_timestamp_invalid' });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) {
    return res.status(401).json({ verified: false, reason: 'signature_timestamp_out_of_tolerance' });
  }

  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const payload = rawBody && rawBody.length > 0 ? rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const signedPayload = `${sig.t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (!timingSafeHexEqual(expected, sig.v1)) {
    return res.status(401).json({ verified: false, reason: 'signature_mismatch' });
  }

  const body = toRecord(req.body);
  const data = toRecord(body.data);
  const attrs = toRecord(data.attributes);
  const accountId =
    (typeof attrs.accountId === 'string' ? attrs.accountId : undefined) ||
    (typeof attrs['account-id'] === 'string' ? attrs['account-id'] : undefined) ||
    '';
  const symbol = typeof attrs.symbol === 'string' ? attrs.symbol : '';
  const certificateId =
    (typeof attrs.certificateId === 'string' ? attrs.certificateId : undefined) ||
    (typeof attrs['certificate-id'] === 'string' ? attrs['certificate-id'] : undefined) ||
    '';
  const status =
    (typeof attrs.status === 'string' ? attrs.status : undefined) ||
    (typeof attrs.certificateStatus === 'string' ? attrs.certificateStatus : undefined) ||
    '';

  res.json({
    verified: true,
    provider: 'custody-holdings',
    receivedAt: nowIso(),
    eventType: typeof body.type === 'string' ? body.type : 'unknown',
    accountId,
    symbol,
    certificateId,
    status
  });
});

app.get('/api/v1/attest/source/providers', (_req, res) => {
  res.json({ providers: listSourceProviders() });
});

app.post('/api/v1/tenant/:tenantId/provider-config', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const tenantId = String(req.params.tenantId);
  const parsed = parseOr400(TenantProviderConfigSchema, {
    ...req.body,
    tenantId
  });
  if ('error' in parsed) return res.status(400).json(parsed);
  const config = await upsertTenantProviderConfig(parsed.data);
  res.json(config);
});

app.get('/api/v1/tenant/:tenantId/provider-configs', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireTenantScope(actor, String(req.params.tenantId), res)) return;
  const records = await listTenantProviderConfigs(String(req.params.tenantId));
  res.json({ records });
});

app.get('/api/v1/tenant/:tenantId/provider-config/:provider', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const tenantId = String(req.params.tenantId);
  if (!requireTenantScope(actor, tenantId, res)) return;
  const provider = String(req.params.provider);
  const record = await getTenantProviderConfig(
    tenantId,
    provider as 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank'
  );
  if (!record) return res.status(404).json({ error: 'tenant_provider_config_not_found' });
  res.json(record);
});

app.post('/api/v1/policy/upsert', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const parsed = parseOr400(UpsertPolicyRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const policy = await upsertPolicyVersion(parsed.data);
  const validated = PolicyVersionSchema.parse(policy);
  res.json(validated);
});

app.get('/api/v1/policy/:tenantId/:policyId/versions', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const tenantId = String(req.params.tenantId);
  if (!requireTenantScope(actor, tenantId, res)) return;
  const policyId = Number(req.params.policyId);
  if (!Number.isFinite(policyId)) return res.status(400).json({ error: 'invalid_policy_id' });
  const records = await listPolicyVersions(tenantId, policyId);
  res.json({ records });
});

app.get('/api/v1/policy/:tenantId/:policyId/active', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const tenantId = String(req.params.tenantId);
  if (!requireTenantScope(actor, tenantId, res)) return;
  const policyId = Number(req.params.policyId);
  if (!Number.isFinite(policyId)) return res.status(400).json({ error: 'invalid_policy_id' });
  const asOf = req.query.asOf ? String(req.query.asOf) : undefined;
  const policy = await resolveActivePolicy(tenantId, policyId, asOf);
  if (!policy) return res.status(404).json({ error: 'active_policy_not_found' });
  res.json(policy);
});

app.post('/api/v1/risk/config/upsert', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const parsed = parseOr400(UpsertRiskConfigRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const config = await upsertRiskConfig(parsed.data);
  res.json(config);
});

app.get('/api/v1/risk/configs', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  const operationQuery = typeof req.query.operation === 'string' ? req.query.operation : undefined;
  if (actor.role !== 'CONSORTIUM_ADMIN' && !tenantId) {
    return res.status(400).json({ error: 'tenant_id_required_for_non_admin' });
  }
  if (tenantId && !requireTenantScope(actor, tenantId, res)) return;
  if (operationQuery) {
    const op = RiskOperationSchema.safeParse(operationQuery);
    if (!op.success) return res.status(400).json({ error: 'invalid_risk_operation' });
    const records = (await listRiskConfigs(tenantId)).filter((v: { operation: string }) => v.operation === op.data);
    return res.json({ records });
  }
  const records = await listRiskConfigs(tenantId);
  res.json({ records });
});

app.post('/api/v1/issuer/controls/upsert', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAdmin(actor, res)) return;
  const parsed = parseOr400(UpsertIssuerControlConfigRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const normalized: IssuerControlConfig = {
    ...(parsed.data as Omit<IssuerControlConfig, 'updatedAt'>),
    updatedAt: nowIso()
  };
  await upsertIssuerControl(normalized);
  res.json(normalized);
});

app.get('/api/v1/issuer/controls', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : actor.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'tenant_id_required_for_non_admin' });
  }
  if (!requireTenantScope(actor, tenantId, res)) return;
  res.json(await getIssuerControlConfig(tenantId));
});

async function executeSourceCollectWorkflow(
  requestData: SourceAdapterRequest
): Promise<{
  provider: string;
  tenantId?: string;
  policy?: {
    version: number;
    policyHash: string;
    jurisdiction: string;
    effectiveAt: string;
  };
  attestation: Awaited<ReturnType<typeof collectPartnerAttestation>>;
  proof: ProofEnvelope;
  verify: ReturnType<typeof verifyProofEnvelope>;
  settlement: unknown;
}> {
  let runtime:
    | {
        allowedHosts?: string[];
        authProfiles?: Record<string, AuthProfile>;
        mtlsProfiles?: Record<string, MtlsProfile>;
      }
    | undefined;
  let resolvedPolicy:
    | {
        version: number;
        policyHash: string;
        jurisdiction: string;
        effectiveAt: string;
      }
    | undefined;

  if (requestData.tenantId) {
    const providerConfig = await getTenantProviderConfig(requestData.tenantId, requestData.provider);
    if (!providerConfig) {
      throw new AdapterError('invalid_config', 'tenant_provider_config_not_found', { statusCode: 404 });
    }
    if (!providerConfig.enabled) {
      throw new AdapterError('invalid_config', 'provider_disabled_for_tenant', { statusCode: 403 });
    }
    enforceSourceQuota(requestData.tenantId, requestData.provider, providerConfig.quotaPerHour);
    runtime = {
      allowedHosts: providerConfig.allowedHosts,
      authProfiles: providerConfig.authProfiles,
      mtlsProfiles: providerConfig.mtlsProfiles
    };
    const activePolicy = await resolveActivePolicy(requestData.tenantId, requestData.policyId);
    if (activePolicy) {
      resolvedPolicy = {
        version: activePolicy.version,
        policyHash: activePolicy.policyHash,
        jurisdiction: activePolicy.jurisdiction,
        effectiveAt: activePolicy.effectiveAt
      };
    }
  }

  ensureCircuitClosedOrThrow(requestData.tenantId, requestData.provider);
  const attestation = await collectPartnerAttestation(requestData, runtime);
  recordProviderSuccess(requestData.tenantId, requestData.provider);
  const sourceProfile = providerSourceProfile(requestData.provider);
  const proof =
    sourceProfile &&
    attestation.raw &&
    typeof attestation.raw === 'object' &&
    'runId' in attestation.raw
      ? mapZkTlsArtifactsToTapProof(
          {
            runId: String((attestation.raw as Record<string, unknown>).runId || ''),
            outputDir: String((attestation.raw as Record<string, unknown>).outputDir || ''),
            attestation: (attestation.raw as Record<string, unknown>).attestation,
            disclosedFields: (attestation.raw as Record<string, unknown>).disclosedFields,
            proof: (attestation.raw as Record<string, unknown>).proof,
            verificationKey: (attestation.raw as Record<string, unknown>).verificationKey
          },
          {
            subjectCommitment: requestData.subjectCommitment,
            tenantId: requestData.tenantId,
            policyId: requestData.policyId,
            policyVersion: resolvedPolicy?.version,
            policyHash: resolvedPolicy?.policyHash,
            jurisdiction: resolvedPolicy?.jurisdiction,
            sourceProfile
          }
        ) ||
        generateEligibilityProof({
          subjectCommitment: requestData.subjectCommitment,
          policyId: requestData.policyId,
          tenantId: requestData.tenantId,
          policyVersion: resolvedPolicy?.version,
          policyHash: resolvedPolicy?.policyHash,
          jurisdiction: resolvedPolicy?.jurisdiction,
          attestationId: attestation.attestationId
        })
      : generateEligibilityProof({
          subjectCommitment: requestData.subjectCommitment,
          policyId: requestData.policyId,
          tenantId: requestData.tenantId,
          policyVersion: resolvedPolicy?.version,
          policyHash: resolvedPolicy?.policyHash,
          jurisdiction: resolvedPolicy?.jurisdiction,
          attestationId: attestation.attestationId
        });
  const verify = verifyProofEnvelope(proof);

  let settlement: unknown = null;
  if (requestData.settle) {
    const policyGuard = await resolveSettlementPolicyGuard('/api/v1/attest/source/collect', proof, {
      tenantId: requestData.tenantId,
      policyId: requestData.policyId
    });
    if (!policyGuard.ok) {
      throw new AdapterError('invalid_config', 'policy_guard_rejected', {
        statusCode: 422,
        details: { reason: policyGuard.reason, ...toRecord(policyGuard.detail) }
      });
    }
    const riskDecision = await evaluateAndRecordRisk({
      tenantId: requestData.tenantId || '',
      operation: 'eligibility',
      subjectCommitment: requestData.subjectCommitment,
      score: attestation.score
    });
    if (requestData.tenantId && !riskDecision.ok) {
      throw new AdapterError('invalid_config', 'risk_control_failed', {
        statusCode: 422,
        details: { reason: riskDecision.reason, ...toRecord(riskDecision.detail) },
        retryable: false
      });
    }

    settlement = await recordSettlement(
      {
        operation: 'eligibility',
        subjectCommitment: requestData.subjectCommitment,
        proof,
        metadata: {
          sourceProvider: requestData.provider,
          tenantId: requestData.tenantId,
          idempotencyKey: requestData.idempotencyKey,
          policyId: requestData.policyId,
          policyVersion: resolvedPolicy?.version,
          policyHash: resolvedPolicy?.policyHash,
          policySnapshotHash: policyGuard.policySnapshotHash,
          policyEffectiveAt: policyGuard.policyEffectiveAt,
          jurisdiction: resolvedPolicy?.jurisdiction,
          attestationId: attestation.attestationId,
          eligible: attestation.eligible,
          score: attestation.score,
          fields: attestation.fields
        }
      },
      verify.verified
    );
  }

  return {
    provider: requestData.provider,
    tenantId: requestData.tenantId,
    policy: resolvedPolicy,
    attestation,
    proof,
    verify,
    settlement
  };
}

app.post('/api/v1/attest/source/collect', async (req, res) => {
  const parsed = parseOr400(SourceAdapterRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const baseRequestData: SourceAdapterRequest = parsed.data;

  const actor = requireActor(req, res);
  if (!actor) return;
  if (baseRequestData.tenantId && !requireTenantScope(actor, baseRequestData.tenantId, res)) return;

  const startedAtMs = Date.now();
  const idempotencyKey = baseRequestData.idempotencyKey;
  if (idempotencyKey && sourceCollectIdempotency.has(idempotencyKey)) {
    return res.json({
      ...(sourceCollectIdempotency.get(idempotencyKey) as Record<string, unknown>),
      idempotentReplay: true
    });
  }

  try {
    const primaryProviderConfig = baseRequestData.tenantId
      ? await getTenantProviderConfig(
          baseRequestData.tenantId,
          baseRequestData.provider as 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank'
        )
      : null;
    const explicitFailover = baseRequestData.failover?.providers || [];
    const defaultFailover =
      primaryProviderConfig?.failoverProviders && primaryProviderConfig.failoverProviders.length > 0
        ? primaryProviderConfig.failoverProviders
        : getDefaultFailoverProviders(baseRequestData.tenantId, baseRequestData.provider);
    const candidateProvidersRaw = [
      baseRequestData.provider,
      ...explicitFailover,
      ...defaultFailover
    ].filter((v, idx, arr) => arr.indexOf(v) === idx);
    const strategy =
      baseRequestData.failover?.strategy ||
      primaryProviderConfig?.routingStrategy ||
      routingStrategyDefault();
    const routingWeights: Record<string, number> = {};
    for (const provider of candidateProvidersRaw) {
      const cfg = baseRequestData.tenantId
        ? await getTenantProviderConfig(
            baseRequestData.tenantId,
            provider as 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank'
          )
        : null;
      routingWeights[provider] = Number.isFinite(cfg?.routingWeight) ? Number(cfg?.routingWeight) : getRoutingWeight(baseRequestData.tenantId, provider);
    }
    const rankedCandidates = rankProvidersForRouting(
      baseRequestData.tenantId,
      candidateProvidersRaw,
      strategy,
      routingWeights
    );
    const candidateProviders = rankedCandidates.map((v) => v.provider);

    let response: Awaited<ReturnType<typeof executeSourceCollectWorkflow>> | null = null;
    let selectedProvider: string | null = null;
    let lastError: AdapterError | null = null;
    const attemptedProviders: string[] = [];

    for (const candidate of candidateProviders) {
      attemptedProviders.push(candidate);
      const sourceRaw =
        candidate === baseRequestData.provider
          ? req.body?.source
          : req.body?.failover?.sources?.[candidate] ?? req.body?.source;
      let candidateSource: SourceAdapterRequest['source'];
      try {
        candidateSource = parseProviderSourceOrThrow(
          candidate as 'mock-bank' | 'generic-rest' | 'increase' | 'plaid' | 'persona' | 'custody-holdings' | 'zktls-employer' | 'zktls-bank',
          sourceRaw
        );
      } catch (error) {
        lastError = new AdapterError('invalid_config', 'invalid_provider_source', {
          statusCode: 400,
          retryable: false,
          details: { provider: candidate, detail: String(error) }
        });
        continue;
      }

      const candidateRequest: SourceAdapterRequest = {
        ...baseRequestData,
        provider: candidate as SourceAdapterRequest['provider'],
        source: candidateSource,
        idempotencyKey:
          idempotencyKey && candidate !== baseRequestData.provider ? `${idempotencyKey}:${candidate}` : idempotencyKey
      };

      try {
        response = await executeSourceCollectWorkflow(candidateRequest);
        selectedProvider = candidate;
        break;
      } catch (error) {
        const e =
          error instanceof AdapterError
            ? error
            : new AdapterError('upstream_unavailable', String(error), { retryable: true, statusCode: 502 });
        if (e.retryable || e.statusCode >= 500) {
          recordProviderFailure(baseRequestData.tenantId, candidate, e.code, e.message);
        }
        lastError = e;
        if (!isFailoverEligibleError(e)) {
          break;
        }
      }
    }

    if (!response) {
      throw (
        lastError ||
        new AdapterError('upstream_unavailable', 'all provider candidates failed', {
          statusCode: 502,
          retryable: true
        })
      );
    }

    const responsePayload = {
      ...response,
      selectedProvider,
      attemptedProviders,
      routingStrategy: strategy,
      rankedProviders: rankedCandidates,
      failoverUsed: selectedProvider !== baseRequestData.provider
    };

    if (idempotencyKey) {
      sourceCollectIdempotency.set(idempotencyKey, responsePayload);
    }

    await appendSourceAudit({
      at: nowIso(),
      provider: baseRequestData.provider,
      selectedProvider,
      attemptedProviders,
      subjectCommitment: baseRequestData.subjectCommitment,
      idempotencyKey: baseRequestData.idempotencyKey || null,
      attestationId: responsePayload.attestation.attestationId,
      eligible: responsePayload.attestation.eligible,
      score: responsePayload.attestation.score,
      rawHash: hashObject(responsePayload.attestation.raw),
      fieldsHash: hashObject(responsePayload.attestation.fields),
      proofHash: responsePayload.proof.proofHash,
      settlementId:
        responsePayload.settlement && typeof responsePayload.settlement === 'object' && responsePayload.settlement !== null
          ? (responsePayload.settlement as Record<string, unknown>).settlementId
          : null,
      latencyMs: Date.now() - startedAtMs
    });

    res.json(responsePayload);
  } catch (error) {
    const e =
      error instanceof AdapterError
        ? error
        : new AdapterError('upstream_unavailable', String(error), { retryable: true, statusCode: 502 });

    const dlqId = `dlq_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await appendSourceAudit({
      at: nowIso(),
      provider: baseRequestData.provider,
      subjectCommitment: baseRequestData.subjectCommitment,
      idempotencyKey: baseRequestData.idempotencyKey || null,
      errorCode: e.code,
      errorMessage: e.message,
      retryable: e.retryable,
      details: e.details,
      latencyMs: Date.now() - startedAtMs
    });

    await appendSourceDlq({
      dlqId,
      at: nowIso(),
      tenantId: baseRequestData.tenantId,
      provider: baseRequestData.provider,
      subjectCommitment: baseRequestData.subjectCommitment,
      idempotencyKey: baseRequestData.idempotencyKey || null,
      requestData: baseRequestData,
      errorCode: e.code,
      errorMessage: e.message,
      retryable: e.retryable,
      statusCode: e.statusCode,
      details: e.details
    });

    if (e.retryable && consumeSourceRetryBudget(baseRequestData.tenantId, baseRequestData.provider)) {
      sourceRetryQueue.push({
        queueId: `retry_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        dlqId,
        requestData: baseRequestData,
        attempts: 0,
        nextAttemptAtMs: Date.now() + sourceRetryBaseDelayMs(),
        lastError: { code: e.code, message: e.message }
      });
    }

    const reason = e.details && typeof e.details.reason === 'string' ? e.details.reason : null;
    if (reason) {
      return res.status(e.statusCode).json({
        error: reason,
        detail: e.details
      });
    }
    return res.status(e.statusCode).json({
      error: {
        code: e.code,
        message: e.message,
        retryable: e.retryable,
        details: e.details
      }
    });
  }
});

app.post('/api/v1/proof/eligibility', (req, res) => {
  const parsed = parseOr400(EligibilityProofRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  try {
    const proof = generateEligibilityProof(parsed.data);
    res.json(proof);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/v1/proof/transfer-compliance', (req, res) => {
  const parsed = parseOr400(TransferComplianceProofRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  try {
    const proof = generateTransferComplianceProof(parsed.data);
    res.json(proof);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/v1/proof/:proofId', (req, res) => {
  const proof = getProofById(req.params.proofId);
  if (!proof) {
    return res.status(404).json({ error: 'proof_not_found' });
  }
  return res.json(proof);
});

app.post('/api/v1/proof/verify', (req, res) => {
  const parsed = parseOr400(ProofEnvelopeSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const result = verifyProofEnvelope(parsed.data);
  res.json(result);
});

app.post('/api/v1/settlement/record', async (req, res) => {
  const parsed = parseOr400(RecordSettlementRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);

  const verify = verifyProofEnvelope(parsed.data.proof);
  const issuerApproval = await assertIssuerRequestApprovedForSettlement(parsed.data, res);
  if (!issuerApproval.approved) return;
  const policyGuard = await resolveSettlementPolicyGuard('/api/v1/settlement/record', parsed.data.proof, parsed.data.metadata);
  if (!policyGuard.ok) {
    return res.status(422).json({
      verified: false,
      reason: policyGuard.reason,
      detail: policyGuard.detail
    });
  }
  if (!verify.verified) {
    return res.status(422).json({
      verified: false,
      reason: verify.reason
    });
  }

  if (
    parsed.data.operation === 'eligibility' ||
    parsed.data.operation === 'mint' ||
    parsed.data.operation === 'burn' ||
    parsed.data.operation === 'issue' ||
    parsed.data.operation === 'allocate' ||
    parsed.data.operation === 'restrict' ||
    parsed.data.operation === 'redeem'
  ) {
    let amountCents: string | undefined;
    let score: number | undefined;
    let subjectCommitment = parsed.data.subjectCommitment;
    if (issuerApproval.record) {
      const payload = issuerApproval.record.payload || {};
      if (typeof payload.amountCents === 'string') amountCents = payload.amountCents;
      if (!amountCents && typeof payload.notionalCents === 'string') amountCents = payload.notionalCents;
      if (settlementRequiresIssuerApproval(parsed.data.operation)) {
        subjectCommitment = resolveIssuerSubjectCommitment(parsed.data.operation, payload, subjectCommitment);
      }
    } else {
      const metadata = parsed.data.metadata || {};
      if (typeof metadata.amountCents === 'string') amountCents = metadata.amountCents;
      if (!amountCents && typeof metadata.notionalCents === 'string') amountCents = metadata.notionalCents;
      if (typeof metadata.score === 'number') score = metadata.score;
    }
    const riskOk = await enforceRiskOrRespond(res, {
      tenantId: policyGuard.tenantId,
      operation: parsed.data.operation,
      subjectCommitment,
      amountCents,
      score
    });
    if (!riskOk) return;
  }

  const response = await recordSettlement(
    {
      ...parsed.data,
      metadata: {
        ...(parsed.data.metadata || {}),
        tenantId: policyGuard.tenantId,
        policyId: policyGuard.policyId,
        policyVersion: policyGuard.policyVersion,
        policyHash: policyGuard.policySnapshotHash,
        policySnapshotHash: policyGuard.policySnapshotHash,
        policyEffectiveAt: policyGuard.policyEffectiveAt,
        ...(issuerApproval.record
          ? {
              issuerRequestId: issuerApproval.record.requestId,
              issuerRequestStatus: issuerApproval.record.status,
              makerKeyId: issuerApproval.record.makerKeyId,
              approvedByKeyId: issuerApproval.record.approval?.checkerKeyId,
              approvedAt: issuerApproval.record.approval?.approvedAt,
              approvalCount: issuerApproval.record.approvals?.length || (issuerApproval.record.approval ? 1 : 0),
              approvalReasonCodes:
                issuerApproval.record.approvals?.map((a) => a.reasonCode).filter(Boolean) ||
                (issuerApproval.record.approval?.reasonCode ? [issuerApproval.record.approval.reasonCode] : []),
              approvalPolicySnapshotHash: issuerApproval.record.approval?.policySnapshotHash,
              approvalPolicyEffectiveAt: issuerApproval.record.approval?.policyEffectiveAt,
              issuerRequestKind: issuerApproval.record.kind,
              ...issuerPayloadMetadata(issuerApproval.record.payload || {})
            }
          : {})
      }
    },
    verify.verified
  );
  if (issuerApproval.record) {
    issuerApproval.record.status = 'settled';
    issuerApproval.record.updatedAt = nowIso();
    await upsertIssuerRequest(issuerApproval.record);
  }
  res.status(200).json({
    ...response,
    verified: true,
    reason: verify.reason,
    policySnapshotHash: policyGuard.policySnapshotHash,
    policyEffectiveAt: policyGuard.policyEffectiveAt
  });
});

app.get('/api/v1/settlement/recent', async (req, res) => {
  const limit = Number(req.query.limit || 20);
  const records = await listRecentSettlements(limit);
  res.json({ records });
});

app.get('/api/v1/settlement/:settlementId', async (req, res) => {
  const record = await getSettlementById(req.params.settlementId);
  if (!record) {
    return res.status(404).json({ error: 'settlement_not_found' });
  }
  return res.json(record);
});

app.post('/api/v1/issuer/mint/request', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_MAKER', 'ISSUER'], res)) return;
  const parsed = parseOr400<MintRequest>(MintRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  if (parsed.data.tenantId && !requireTenantScope(actor, parsed.data.tenantId, res)) return;
  const record = await createIssuerRequestRecord('mint', parsed.data as unknown as MintRequest & Record<string, unknown>, actor);
  mintRequestStore.set(record.requestId, parsed.data);
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, request: parsed.data, workflow: record });
});

app.post('/api/v1/issuer/burn/request', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_MAKER', 'ISSUER'], res)) return;
  const parsed = parseOr400<BurnRequest>(BurnRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  if (parsed.data.tenantId && !requireTenantScope(actor, parsed.data.tenantId, res)) return;
  const record = await createIssuerRequestRecord('burn', parsed.data as unknown as BurnRequest & Record<string, unknown>, actor);
  burnRequestStore.set(record.requestId, parsed.data);
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, request: parsed.data, workflow: record });
});

app.post('/api/v1/issuer/stock/issue/request', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_MAKER', 'ISSUER'], res)) return;
  const parsed = parseOr400<StockIssueRequest>(StockIssueRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  if (parsed.data.tenantId && !requireTenantScope(actor, parsed.data.tenantId, res)) return;
  const record = await createIssuerRequestRecord(
    'issue',
    parsed.data as unknown as StockIssueRequest & Record<string, unknown>,
    actor
  );
  stockIssueRequestStore.set(record.requestId, parsed.data);
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, request: parsed.data, workflow: record });
});

app.post('/api/v1/issuer/stock/allocate/request', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_MAKER', 'ISSUER'], res)) return;
  const parsed = parseOr400<StockAllocationRequest>(StockAllocationRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  if (parsed.data.tenantId && !requireTenantScope(actor, parsed.data.tenantId, res)) return;
  const record = await createIssuerRequestRecord(
    'allocate',
    parsed.data as unknown as StockAllocationRequest & Record<string, unknown>,
    actor
  );
  stockAllocationRequestStore.set(record.requestId, parsed.data);
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, request: parsed.data, workflow: record });
});

app.post('/api/v1/issuer/stock/restrict/request', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_MAKER', 'ISSUER'], res)) return;
  const parsed = parseOr400<StockRestrictionRequest>(StockRestrictionRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  if (parsed.data.tenantId && !requireTenantScope(actor, parsed.data.tenantId, res)) return;
  const record = await createIssuerRequestRecord(
    'restrict',
    parsed.data as unknown as StockRestrictionRequest & Record<string, unknown>,
    actor
  );
  stockRestrictionRequestStore.set(record.requestId, parsed.data);
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, request: parsed.data, workflow: record });
});

app.post('/api/v1/issuer/stock/redeem/request', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_MAKER', 'ISSUER'], res)) return;
  const parsed = parseOr400<StockRedeemRequest>(StockRedeemRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  if (parsed.data.tenantId && !requireTenantScope(actor, parsed.data.tenantId, res)) return;
  const record = await createIssuerRequestRecord(
    'redeem',
    parsed.data as unknown as StockRedeemRequest & Record<string, unknown>,
    actor
  );
  stockRedeemRequestStore.set(record.requestId, parsed.data);
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, request: parsed.data, workflow: record });
});

app.get('/api/v1/issuer/requests', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const kind = typeof req.query.kind === 'string' ? normalizeIssuerKindParam(req.query.kind) : undefined;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
  const records = await listIssuerRequests({
    kind,
    status: statusFilter as IssuerRequestRecord['status'] | undefined,
    tenantId: actor.role === 'CONSORTIUM_ADMIN' ? undefined : actor.tenantId
  });
  res.json({ records });
});

app.post('/api/v1/issuer/:kind/:requestId/approve', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_CHECKER'], res)) return;
  const kind = normalizeIssuerKindParam(req.params.kind);
  if (!kind) return res.status(400).json({ error: 'invalid_kind' });
  const parsed = parseOr400(IssuerApprovalActionSchema, req.body || {});
  if ('error' in parsed) return res.status(400).json(parsed);

  const record = await getIssuerRequest(kind, req.params.requestId);
  if (!record) return res.status(404).json({ error: 'issuer_request_not_found' });
  if (record.tenantId && !requireTenantScope(actor, record.tenantId, res)) return;
  if (record.makerKeyId === actor.keyId) {
    return res.status(422).json({ error: 'maker_checker_separation_required' });
  }
  if (record.status !== 'requested' && record.status !== 'approved') {
    return res.status(422).json({ error: 'issuer_request_not_actionable', status: record.status });
  }
  const cfg = await getIssuerControlConfig(record.tenantId);
  if (cfg.requireReasonCode && !parsed.data.reasonCode) {
    return res.status(422).json({ error: 'issuer_reason_code_required' });
  }
  if (
    parsed.data.reasonCode &&
    cfg.allowedReasonCodes.length > 0 &&
    !cfg.allowedReasonCodes.includes(parsed.data.reasonCode)
  ) {
    return res.status(422).json({
      error: 'issuer_reason_code_not_allowed',
      detail: { reasonCode: parsed.data.reasonCode, allowedReasonCodes: cfg.allowedReasonCodes }
    });
  }
  const priorApprovals = record.approvals || (record.approval ? [record.approval] : []);
  if (priorApprovals.some((a) => a.checkerKeyId === actor.keyId)) {
    return res.status(422).json({ error: 'issuer_duplicate_checker_approval' });
  }

  let approvalPolicy:
    | {
        policySnapshotHash?: string;
        policyEffectiveAt?: string;
        policyVersion?: number;
      }
    | undefined;
  if (record.tenantId && record.policyId !== undefined) {
    const activePolicy = await resolveActivePolicy(record.tenantId, record.policyId);
    if (activePolicy) {
      approvalPolicy = {
        policySnapshotHash: activePolicy.policyHash,
        policyEffectiveAt: activePolicy.effectiveAt,
        policyVersion: activePolicy.version
      };
    }
  }
  const nextApproval: IssuerApproval = {
    checkerKeyId: actor.keyId,
    checkerRole: actor.role,
    approvedAt: nowIso(),
    reasonCode: parsed.data.reasonCode,
    note: parsed.data.note,
    ...approvalPolicy
  };
  const approvals = [...priorApprovals, nextApproval];
  const requiredApprovals = requiredApprovalsForRecord(record, cfg);

  record.approvals = approvals;
  record.approval = approvals[approvals.length - 1];
  record.status = approvals.length >= requiredApprovals ? 'approved' : 'requested';
  record.updatedAt = nowIso();
  await upsertIssuerRequest(record);
  res.json({
    requestId: record.requestId,
    status: record.status,
    approvalProgress: {
      requiredApprovals,
      currentApprovals: approvals.length,
      remainingApprovals: Math.max(0, requiredApprovals - approvals.length)
    },
    workflow: record
  });
});

app.post('/api/v1/issuer/:kind/:requestId/reject', async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  if (!requireAnyRole(actor, ['ISSUER_CHECKER'], res)) return;
  const kind = normalizeIssuerKindParam(req.params.kind);
  if (!kind) return res.status(400).json({ error: 'invalid_kind' });
  const parsed = parseOr400(IssuerApprovalActionSchema, req.body || {});
  if ('error' in parsed) return res.status(400).json(parsed);

  const record = await getIssuerRequest(kind, req.params.requestId);
  if (!record) return res.status(404).json({ error: 'issuer_request_not_found' });
  if (record.tenantId && !requireTenantScope(actor, record.tenantId, res)) return;
  if (record.makerKeyId === actor.keyId) {
    return res.status(422).json({ error: 'maker_checker_separation_required' });
  }
  if (record.status !== 'requested') {
    return res.status(422).json({ error: 'issuer_request_not_actionable', status: record.status });
  }
  const cfg = await getIssuerControlConfig(record.tenantId);
  if (cfg.requireReasonCode && !parsed.data.reasonCode) {
    return res.status(422).json({ error: 'issuer_reason_code_required' });
  }
  if (
    parsed.data.reasonCode &&
    cfg.allowedReasonCodes.length > 0 &&
    !cfg.allowedReasonCodes.includes(parsed.data.reasonCode)
  ) {
    return res.status(422).json({
      error: 'issuer_reason_code_not_allowed',
      detail: { reasonCode: parsed.data.reasonCode, allowedReasonCodes: cfg.allowedReasonCodes }
    });
  }
  record.status = 'rejected';
  record.updatedAt = nowIso();
  record.rejection = {
    checkerKeyId: actor.keyId,
    checkerRole: actor.role,
    rejectedAt: nowIso(),
    reasonCode: parsed.data.reasonCode,
    note: parsed.data.note
  };
  await upsertIssuerRequest(record);
  res.json({ requestId: record.requestId, status: record.status, workflow: record });
});

app.post('/api/v1/transfer/request', (req, res) => {
  const parsed = parseOr400(TransferRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const requestId = `xfer_${Date.now()}`;
  transferRequestStore.set(requestId, parsed.data);
  res.json({ requestId, status: 'pending_compliance', request: parsed.data });
});

app.post('/api/v1/bridge/exit/request', (req, res) => {
  const parsed = parseOr400(BridgeExitRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const bridgeOpId = `exit_${Date.now()}`;
  bridgeRequestStore.set(bridgeOpId, parsed.data);
  res.json({ bridgeOpId, status: 'queued', request: parsed.data });
});

app.post('/api/v1/bridge/entry/request', (req, res) => {
  const parsed = parseOr400(BridgeEntryRequestSchema, req.body);
  if ('error' in parsed) return res.status(400).json(parsed);
  const bridgeOpId = `entry_${Date.now()}`;
  bridgeRequestStore.set(bridgeOpId, parsed.data);
  res.json({ bridgeOpId, status: 'queued', request: parsed.data });
});

app.get('/api/v1/auditor/events', async (_req, res) => {
  const records = await listRecentSettlements(50);
  res.json({
    events: records.map((record: { eventId: string; operation: string; status: string; createdAt: string; txHash: string; proofHash: string }) => ({
      id: record.eventId,
      kind: `settlement.${record.operation}.${record.status}`,
      at: record.createdAt,
      txHash: record.txHash,
      proofHash: record.proofHash
    }))
  });
});

let sourceRetryWorkerHandle: ReturnType<typeof setInterval> | null = null;
let settlementReconcileWorkerHandle: ReturnType<typeof setInterval> | null = null;

function startSourceRetryWorker() {
  if (sourceRetryWorkerHandle) return;
  if (process.env.TAP_SOURCE_RETRY_WORKER_ENABLED === '0') return;
  const intervalMs = Number(process.env.TAP_SOURCE_RETRY_WORKER_INTERVAL_MS || 2000);
  sourceRetryWorkerHandle = setInterval(() => {
    void processSourceRetryQueueTick(Number(process.env.TAP_SOURCE_RETRY_WORKER_BATCH_SIZE || 5));
  }, Math.max(250, intervalMs));
  sourceRetryWorkerHandle.unref?.();
}

function startSettlementReconcileWorker() {
  if (settlementReconcileWorkerHandle) return;
  if (process.env.TAP_SETTLEMENT_RECONCILE_WORKER_ENABLED !== '1') return;
  const intervalMs = Number(process.env.TAP_SETTLEMENT_RECONCILE_WORKER_INTERVAL_MS || 15000);
  settlementReconcileWorkerHandle = setInterval(() => {
    void (async () => {
      const cfg = getReconcileSupervisorConfig();
      const nowMs = Date.now();
      if (isReconcilePausedNow(nowMs)) {
        const budget = getReconcileFailureBudgetState();
        await appendSettlementReconcileAudit({
          at: nowIso(),
          kind: 'supervisor_tick_skipped_paused',
          windowHour: budget.windowHour,
          failures: budget.failures,
          pausedUntil: budget.pausedUntilMs ? new Date(budget.pausedUntilMs).toISOString() : null
        });
        return;
      }

      try {
        const result = await runSettlementReconcileOnce({
          limit: Number(process.env.TAP_SETTLEMENT_RECONCILE_WORKER_LIMIT || cfg.maxActionsPerRun || 200),
          staleMinutes: cfg.staleMinutes,
          dryRun: false
        });
        if (result.actions.length > 0) {
          await appendSettlementReconcileAudit({
            at: nowIso(),
            kind: 'supervisor_tick_applied',
            actions: result.actions.length,
            scanned: result.scanned
          });
        }
        clearReconcileFailureBudget();
      } catch (error) {
        const state = recordReconcileFailure(cfg, nowMs);
        const pausedUntil = state.pausedUntilMs ? new Date(state.pausedUntilMs).toISOString() : null;
        await appendSettlementReconcileAudit({
          at: nowIso(),
          kind: 'supervisor_tick_error',
          error: String(error),
          failures: state.failures,
          windowHour: state.windowHour,
          pausedUntil
        });
        await notifyReconcileAlert('error', 'Settlement reconcile worker failure', {
          error: String(error),
          failures: state.failures,
          failureBudgetPerHour: cfg.failureBudgetPerHour,
          windowHour: state.windowHour,
          pausedUntil
        });
      }
    })();
  }, Math.max(1000, intervalMs));
  settlementReconcileWorkerHandle.unref?.();
}

export function startServer(portOverride = port): Server {
  startSourceRetryWorker();
  startSettlementReconcileWorker();
  return app.listen(portOverride, () => {
    console.log(`api-gateway listening on http://localhost:${portOverride}`);
  });
}

if (process.env.TAP_DISABLE_LISTEN !== '1') {
  startServer();
}
