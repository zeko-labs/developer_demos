import { encryptJsonEnvelope, getEnvelopeContext, type X25519EncryptedEnvelope } from '../crypto-envelope.js';

export type SponsorLane = 'request' | 'output' | 'registry' | 'credits';

export type CoordinatorAuth =
  | { kind: 'none' }
  | { kind: 'api-key'; apiKey: string; headerName?: string }
  | { kind: 'bearer'; token: string };

export interface CoordinatorRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryableStatusCodes: number[];
  safeMethods: string[];
}

export interface CoordinatorClientOptions {
  baseUrl: string;
  auth?: CoordinatorAuth;
  timeoutMs?: number;
  retry?: Partial<CoordinatorRetryPolicy>;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface CoordinatorRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retry?: Partial<CoordinatorRetryPolicy>;
  retryUnsafe?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface CoordinatorLaneRouteCandidate {
  id: string;
  label: string;
  endpoint: string | null;
  status: 'active' | 'paused' | 'draining';
  local: boolean;
  publicKey: string | null;
  updatedAt: string;
  lastSeenAt: string | null;
  freshness: CoordinatorRouteFreshness;
  eligible: boolean;
  eligibilityReason: string;
}

export interface CoordinatorRouteFreshness {
  status: 'local' | 'fresh' | 'stale' | 'unknown';
  source: 'local-process' | 'last-seen' | 'updated-at' | 'missing';
  observedAt: string | null;
  ageMs: number | null;
  staleAfterMs: number | null;
}

export interface CoordinatorRoutingSelection {
  mode: 'local-preferred' | 'fresh-remote' | 'unavailable';
  reason: string;
}

export interface CoordinatorLaneRoute {
  lane: SponsorLane;
  via: 'local' | 'remote' | 'unavailable';
  operatorId: string | null;
  operatorLabel: string | null;
  operatorEndpoint: string | null;
  operatorStatus: 'active' | 'paused' | 'draining' | null;
  publicKey: string | null;
  localConfigured: boolean;
  freshness: CoordinatorRouteFreshness;
  selection: CoordinatorRoutingSelection;
  candidates: CoordinatorLaneRouteCandidate[];
}

export interface CoordinatorRoutingPolicy {
  generatedAt: string;
  routeStrategy: 'local-preferred' | 'membership-first';
  coordinatorSyncMs: number;
  routeStaleAfterMs: number;
  requireActiveStatus: boolean;
  preferLocalWhenConfigured: boolean;
  remoteRequiresEndpoint: boolean;
  remoteRequiresFreshHeartbeat: boolean;
  routeSelectionOrder: string[];
  note: string;
}

export interface CoordinatorOperatorMembershipLanePolicy {
  lane: SponsorLane;
  enabled: boolean;
  publicKey: string | null;
  priority: number;
  role: 'primary' | 'backup' | 'standby';
  notes: string[];
}

export interface CoordinatorOperatorMembershipRecord {
  operatorId: string;
  label: string;
  endpoint: string | null;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: CoordinatorOperatorMembershipLanePolicy[];
  allowedStatuses: Array<'active' | 'paused' | 'draining'>;
  metadata: Record<string, unknown> | null;
  issuedAt: string;
  updatedAt: string;
}

export interface CoordinatorRoutingSnapshot {
  generatedAt: string;
  policy: CoordinatorRoutingPolicy;
  localOperatorId: string;
  routes: Record<SponsorLane, CoordinatorLaneRoute>;
  note: string;
}

export interface CoordinatorSubmitResponse {
  hash: string | null;
  proxied: boolean;
  route: CoordinatorLaneRoute;
  submitted?: boolean;
  kind?: string;
  contractVersion?: 'v1' | 'v2';
}

export interface CoordinatorOperatorHealthRecord {
  id: string;
  label: string;
  endpoint: string | null;
  status: 'active' | 'paused' | 'draining';
  local: boolean;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: Array<{
    lane: SponsorLane;
    configured: boolean;
    publicKey: string | null;
    source: string;
    usesSharedFallback: boolean;
  }>;
  freshness: CoordinatorRouteFreshness;
  metadata: Record<string, unknown> | null;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface CoordinatorOperatorHealthSnapshot {
  generatedAt: string;
  policy: CoordinatorRoutingPolicy;
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
  operators: CoordinatorOperatorHealthRecord[];
  routing: CoordinatorRoutingSnapshot;
}

export interface CoordinatorOperatorIsolationAuditIssue {
  severity: 'info' | 'warn' | 'error';
  code: string;
  lane: SponsorLane | null;
  operatorId: string | null;
  message: string;
  details: Record<string, unknown> | null;
}

export interface CoordinatorOperatorIsolationAuditSnapshot {
  generatedAt: string;
  localOperatorId: string;
  policy: CoordinatorRoutingPolicy;
  sponsorLanes: Array<{
    lane: SponsorLane;
    privateKeyConfigured: boolean;
    publicKey: string | null;
    source: string;
    envVar: string | null;
    filePath: string | null;
    usesSharedFallback: boolean;
  }>;
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
  routes: Record<SponsorLane, CoordinatorLaneRoute>;
  issues: CoordinatorOperatorIsolationAuditIssue[];
  note: string;
}

export interface CoordinatorOperatorMembershipSnapshot {
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
    record: CoordinatorOperatorMembershipRecord;
  }>;
  note: string;
}

export interface CoordinatorAuthMeResponse {
  authenticated: boolean;
  principal: null | {
    role: 'operator' | 'builder';
    id: string;
    label: string;
    authMode: 'api-key' | 'bearer' | 'shared-env';
    scopes: string[];
  };
  usage: null | {
    rateLimit: null | {
      windowMs: number;
      startedAt: string | null;
      usedRequests: number;
      usedWriteRequests: number;
      remainingRequests: number;
      remainingWriteRequests: number | null;
    };
    dailyQuota: null | {
      day: string;
      inferenceCreates: { used: number; remaining: number | null };
      agentCreates: { used: number; remaining: number | null };
      creditsSpendCount: { used: number; remaining: number | null };
      creditsSpendMina: { used: number; remaining: number | null };
    };
  };
}

export type CoordinatorInferenceLifecycleStatus = 'created' | 'submitting' | 'submitted' | 'settled' | 'failed';

export interface CoordinatorPrivateLaneConfig {
  mode: 'sealed-input';
  curve: 'x25519';
  context: string;
  publicKeyPem: string;
  fingerprint: string;
}

export interface CoordinatorPrivateInferenceEnvelopePayload {
  prompt: string;
  inputs?: Record<string, unknown>;
}

export interface CoordinatorInferenceStatusResponse {
  inferenceId: string;
  requestId: string;
  status: CoordinatorInferenceLifecycleStatus;
  statusToken: string;
  statusPath: string;
  statusUrl: string | null;
  createdAt: string;
  updatedAt: string;
  liveSettlementRequested: boolean;
  settlement: {
    layer: string;
    futureLayer: string;
    contractVersion: 'v1' | 'v2';
    mode: string;
    waitForSettlement: boolean;
    settled: boolean;
    settledAt: string | null;
    latestCheckAt: string | null;
    lastError: string | null;
    receiptHash: string;
    requestHash: string;
    outputHash: string;
    metadataHash: string;
    request: null | {
      kind: string;
      stateIndex: number;
      targetRoot: string;
      txHash: string | null;
      submittedAt: string | null;
      settled: boolean;
      settledAt: string | null;
      observedRoot: string | null;
      explorerUrl: string | null;
      note: string | null;
    };
    output: null | {
      kind: string;
      stateIndex: number;
      targetRoot: string;
      txHash: string | null;
      submittedAt: string | null;
      settled: boolean;
      settledAt: string | null;
      observedRoot: string | null;
      explorerUrl: string | null;
      note: string | null;
    };
    thresholdAttestation: null | {
      method: string;
      quorum: number;
      digest: string;
      attestersAvailable: number;
      signatureCount: number;
    };
    futureSettlement: Record<string, unknown>;
  };
  callback: {
    url: string | null;
    mode: 'terminal' | 'status-change';
    lastNotifiedStatus: CoordinatorInferenceLifecycleStatus | null;
    lastCallbackAt: string | null;
    callbackAttempts: number;
    lastCallbackError: string | null;
  };
  links: {
    inferencePath: string;
    inferenceUrl: string | null;
    compatPath: string;
    compatUrl: string | null;
  };
}

export interface CoordinatorCompatModel {
  id: string;
  object: 'model';
  created_at: string;
  name: string;
  version: string;
  description: string;
  verification_method: string;
  transport_mode: string;
  settlement_mode_default: string;
  tags: string[];
}

export interface CoordinatorCompatModelsResponse {
  object: 'list';
  data: CoordinatorCompatModel[];
}

export interface CoordinatorCompatInferenceResponse {
  id: string;
  object: 'compat.inference';
  created_at: string;
  request_id: string;
  model: {
    id: string;
    name: string;
    verification_method: string;
    transport_mode: string;
  };
  prompt: string;
  input: Record<string, unknown>;
  output: unknown;
  encrypted_output: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  status: CoordinatorInferenceLifecycleStatus;
  status_token: string;
  status_path: string;
  status_url: string | null;
  callback: CoordinatorInferenceStatusResponse['callback'];
  settlement: CoordinatorInferenceStatusResponse['settlement'];
  privacy: Record<string, unknown>;
  compatibility: {
    surface: string;
    settlement_backend: string;
  };
}

export interface CoordinatorCompatReceiptResponse {
  object: 'compat.receipt';
  inference_id: string;
  request_id: string;
  status: CoordinatorInferenceLifecycleStatus;
  status_token: string;
  status_path: string;
  status_url: string | null;
  settlement: CoordinatorInferenceStatusResponse['settlement'];
  links: CoordinatorInferenceStatusResponse['links'];
  attestations: Record<string, unknown> | null;
}

export interface CoordinatorCompatChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  request_id: string;
  status: CoordinatorInferenceLifecycleStatus;
  status_token: string;
  status_path: string;
  status_url: string | null;
  settlement: CoordinatorInferenceStatusResponse['settlement'];
  inference: CoordinatorCompatInferenceResponse;
}

export interface CoordinatorMcpResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type CoordinatorCreditsSettlementStrategy = 'direct' | 'checkpoint';
export type CoordinatorCreditsOperatorItemKind = 'credits-update' | 'credits-spend';
export type CoordinatorCreditsOperatorItemStatus =
  | 'queued'
  | 'processing'
  | 'submitted'
  | 'settled'
  | 'failed'
  | 'superseded';

export interface CoordinatorCreditsOperatorQueueItem {
  id: string;
  idempotencyKey: string;
  contractVersion: 'v2';
  kind: CoordinatorCreditsOperatorItemKind;
  settlementStrategy: CoordinatorCreditsSettlementStrategy;
  source: 'deposit-intent' | 'spend-intent' | 'manual';
  ownerPublicKey: string | null;
  requestId: string | null;
  pendingDepositKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  status: CoordinatorCreditsOperatorItemStatus;
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
}

export interface CoordinatorCreditsOperatorQueueSummary {
  queued: number;
  processing: number;
  submitted: number;
  settled: number;
  failed: number;
  superseded: number;
}

export interface CoordinatorCreditsOperatorQueueSettings {
  autoProcessMs: number;
  autoProcessingEnabled: boolean;
  maxAttempts: number;
  sponsorEnabled: boolean;
  operatorId: string;
  operatorStatus: 'active' | 'paused' | 'draining';
  leaseMs: number;
}

export interface CoordinatorCreditsOperatorQueueSnapshot {
  queue: {
    items: CoordinatorCreditsOperatorQueueItem[];
    lastProcessedAt: string | null;
    lastError: string | null;
  };
  summary: CoordinatorCreditsOperatorQueueSummary;
  settings: CoordinatorCreditsOperatorQueueSettings;
}

export interface CoordinatorCreditsOperatorEnqueueResponse {
  queued: boolean;
  deduped: boolean;
  item: CoordinatorCreditsOperatorQueueItem;
  summary: CoordinatorCreditsOperatorQueueSummary;
  settings: CoordinatorCreditsOperatorQueueSettings;
}

export interface CoordinatorCreditsOperatorProcessResponse {
  processing: boolean;
  processed: CoordinatorCreditsOperatorQueueItem[];
  summary: CoordinatorCreditsOperatorQueueSummary;
  settings: CoordinatorCreditsOperatorQueueSettings;
}

export interface CoordinatorCreditsSpendIntentResponse {
  ownerPublicKey: string;
  balanceMina: number;
  contractVersion: 'v2';
  settlementStrategy: CoordinatorCreditsSettlementStrategy;
  payload: Record<string, unknown>;
  payloadV1?: Record<string, unknown>;
  payloadV2?: Record<string, unknown>;
  operator?: CoordinatorCreditsOperatorEnqueueResponse;
}

export type CoordinatorCreditsDepositMonitorStatus = 'queued' | 'monitoring' | 'confirmed' | 'failed';

export interface CoordinatorCreditsDepositMonitorItem {
  id: string;
  idempotencyKey: string;
  contractVersion: 'v2';
  ownerPublicKey: string;
  creditsRoot: string;
  nullifierRoot: string;
  txHash: string;
  createdAt: string;
  status: CoordinatorCreditsDepositMonitorStatus;
  attemptCount: number;
  settledAt: string | null;
  confirmedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  observedCreditsRoot: string | null;
  observedNullifierRoot: string | null;
}

export interface CoordinatorCreditsDepositMonitorSummary {
  queued: number;
  monitoring: number;
  confirmed: number;
  failed: number;
}

export interface CoordinatorCreditsDepositMonitorSnapshot {
  monitors: {
    items: CoordinatorCreditsDepositMonitorItem[];
    lastProcessedAt: string | null;
    lastError: string | null;
  };
  summary: CoordinatorCreditsDepositMonitorSummary;
  settings: {
    autoProcessMs: number;
    autoProcessingEnabled: boolean;
    maxAttempts: number;
  };
}

export interface CoordinatorCreditsDepositMonitorResponse {
  queued?: boolean;
  deduped?: boolean;
  processing?: boolean;
  item?: CoordinatorCreditsDepositMonitorItem;
  processed?: CoordinatorCreditsDepositMonitorItem[];
  summary: CoordinatorCreditsDepositMonitorSummary;
  settings: CoordinatorCreditsDepositMonitorSnapshot['settings'];
}

export interface CoordinatorCreditsCheckpointBatchRecord {
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

export interface CoordinatorCreditsCheckpointBatchSummary {
  submitted: number;
  settled: number;
  failed: number;
}

export interface CoordinatorCreditsCheckpointBatchSnapshot {
  batches: {
    batches: CoordinatorCreditsCheckpointBatchRecord[];
    lastProcessedAt: string | null;
    lastError: string | null;
  };
  summary: CoordinatorCreditsCheckpointBatchSummary;
  settings: {
    maxBatchSize: number;
    operatorId: string;
    operatorStatus: 'active' | 'paused' | 'draining';
    leaseMs: number;
  };
}

export interface CoordinatorCreditsCheckpointBatchProcessResponse {
  processed: CoordinatorCreditsOperatorQueueItem[];
  batch: CoordinatorCreditsCheckpointBatchRecord | null;
  summary: CoordinatorCreditsCheckpointBatchSummary;
  settings: CoordinatorCreditsCheckpointBatchSnapshot['settings'];
}

export interface CoordinatorCreditsBalanceResponse {
  ownerPublicKey: string;
  balanceMina: number;
}

export interface CoordinatorPollOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface CoordinatorWaitForLaneRouteOptions extends CoordinatorPollOptions {
  predicate?: (route: CoordinatorLaneRoute) => boolean;
  timeoutMessage?: string;
}

export interface CoordinatorWaitForCreditsOperatorItemOptions extends CoordinatorPollOptions {
  acceptSubmitted?: boolean;
  rejectOnFailed?: boolean;
  rejectOnSuperseded?: boolean;
}

export interface CoordinatorWaitForCreditsDepositMonitorOptions extends CoordinatorPollOptions {
  acceptMonitoring?: boolean;
  rejectOnFailed?: boolean;
}

export interface CoordinatorWaitForInferenceStatusOptions extends CoordinatorPollOptions {
  acceptSubmitted?: boolean;
  terminalStatuses?: CoordinatorInferenceLifecycleStatus[];
}

export class CoordinatorHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly bodyText: string;
  readonly bodyJson: unknown | null;

  constructor(params: { status: number; method: string; path: string; bodyText: string; bodyJson: unknown | null }) {
    super(`${params.method} ${params.path} failed with ${params.status}`);
    this.name = 'CoordinatorHttpError';
    this.status = params.status;
    this.method = params.method;
    this.path = params.path;
    this.bodyText = params.bodyText;
    this.bodyJson = params.bodyJson;
  }
}

const defaultRetryPolicy: CoordinatorRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  backoffFactor: 2,
  retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
  safeMethods: ['GET', 'HEAD', 'OPTIONS']
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(signal?.reason || new Error('Aborted while waiting to retry.'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(signal.reason || new Error('Aborted while waiting to retry.'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function cryptoRandomId() {
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function normalizeRetryPolicy(input?: Partial<CoordinatorRetryPolicy>): CoordinatorRetryPolicy {
  return {
    maxAttempts: Math.max(1, Number(input?.maxAttempts ?? defaultRetryPolicy.maxAttempts)),
    initialDelayMs: Math.max(50, Number(input?.initialDelayMs ?? defaultRetryPolicy.initialDelayMs)),
    maxDelayMs: Math.max(50, Number(input?.maxDelayMs ?? defaultRetryPolicy.maxDelayMs)),
    backoffFactor: Math.max(1, Number(input?.backoffFactor ?? defaultRetryPolicy.backoffFactor)),
    retryableStatusCodes: input?.retryableStatusCodes?.length
      ? Array.from(new Set(input.retryableStatusCodes))
      : defaultRetryPolicy.retryableStatusCodes,
    safeMethods: input?.safeMethods?.length ? Array.from(new Set(input.safeMethods.map((entry) => entry.toUpperCase()))) : defaultRetryPolicy.safeMethods
  };
}

function buildAuthHeaders(auth: CoordinatorAuth | undefined) {
  if (!auth || auth.kind === 'none') return {};
  if (auth.kind === 'api-key') {
    return { [auth.headerName || 'x-api-key']: auth.apiKey };
  }
  return { authorization: `Bearer ${auth.token}` };
}

function parseJsonSafe(raw: string) {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function computeBackoffDelayMs(policy: CoordinatorRetryPolicy, attempt: number, retryAfterHeader: string | null) {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  if (retryAfterMs !== null) {
    return Math.min(policy.maxDelayMs, retryAfterMs);
  }
  const multiplier = Math.pow(policy.backoffFactor, Math.max(0, attempt - 1));
  return Math.min(policy.maxDelayMs, Math.round(policy.initialDelayMs * multiplier));
}

function isRetryableRequest(method: string, options: CoordinatorRequestOptions, policy: CoordinatorRetryPolicy) {
  if (policy.safeMethods.includes(method)) return true;
  if (options.retryUnsafe) return true;
  return typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim().length > 0;
}

function createRequestSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Coordinator request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const onAbort = () => {
    controller.abort(externalSignal?.reason || new Error('Coordinator request aborted.'));
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onAbort();
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  };
}

function describePollingTimeout(timeoutMs: number) {
  return `Polling timed out after ${timeoutMs}ms.`;
}

export class CoordinatorClient {
  readonly baseUrl: string;
  readonly auth: CoordinatorAuth;
  readonly timeoutMs: number;
  readonly retryPolicy: CoordinatorRetryPolicy;

  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: CoordinatorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.auth = options.auth || { kind: 'none' };
    this.timeoutMs = Math.max(250, Number(options.timeoutMs ?? 15_000));
    this.retryPolicy = normalizeRetryPolicy(options.retry);
    this.fetchImpl = options.fetch || fetch;
    this.defaultHeaders = options.headers || {};
  }

  private async poll<T>(params: {
    load: () => Promise<T>;
    until: (value: T) => boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    timeoutMessage?: string;
  }) {
    const timeoutMs = Math.max(250, Number(params.timeoutMs ?? 30_000));
    const pollIntervalMs = Math.max(100, Number(params.pollIntervalMs ?? 1_000));
    const startedAt = Date.now();

    while (true) {
      if (params.signal?.aborted) {
        throw params.signal.reason || new Error('Coordinator polling aborted.');
      }

      const value = await params.load();
      if (params.until(value)) {
        return value;
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(params.timeoutMessage || describePollingTimeout(timeoutMs));
      }

      const remainingMs = Math.max(0, timeoutMs - elapsedMs);
      await sleep(Math.min(pollIntervalMs, remainingMs), params.signal);
    }
  }

  async requestJson<T>(path: string, options: CoordinatorRequestOptions = {}): Promise<T> {
    const method = String(options.method || (typeof options.body === 'undefined' ? 'GET' : 'POST')).toUpperCase();
    const retryPolicy = normalizeRetryPolicy({ ...this.retryPolicy, ...options.retry });
    const retryableRequest = isRetryableRequest(method, options, retryPolicy);
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const headers = new Headers({
        ...this.defaultHeaders,
        ...buildAuthHeaders(this.auth),
        ...(options.headers || {})
      });

      if (options.idempotencyKey?.trim()) {
        headers.set('idempotency-key', options.idempotencyKey.trim());
      }

      let body: BodyInit | undefined;
      if (typeof options.body !== 'undefined') {
        if (
          typeof options.body === 'string' ||
          options.body instanceof Blob ||
          options.body instanceof URLSearchParams ||
          options.body instanceof FormData ||
          options.body instanceof ArrayBuffer
        ) {
          body = options.body as BodyInit;
        } else {
          if (!headers.has('content-type')) {
            headers.set('content-type', 'application/json');
          }
          body = JSON.stringify(options.body);
        }
      }

      const timeoutMs = Math.max(250, Number(options.timeoutMs ?? this.timeoutMs));
      const requestSignal = createRequestSignal(timeoutMs, options.signal);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: requestSignal.signal
        });
        const bodyText = await response.text();
        const bodyJson = parseJsonSafe(bodyText);

        if (!response.ok) {
          const error = new CoordinatorHttpError({
            status: response.status,
            method,
            path,
            bodyText,
            bodyJson
          });
          if (attempt < retryPolicy.maxAttempts && retryableRequest && retryPolicy.retryableStatusCodes.includes(response.status)) {
            const delayMs = computeBackoffDelayMs(retryPolicy, attempt, response.headers.get('retry-after'));
            requestSignal.cleanup();
            await sleep(delayMs, options.signal);
            continue;
          }
          throw error;
        }

        requestSignal.cleanup();
        return bodyJson as T;
      } catch (error) {
        const timedOut = requestSignal.didTimeout();
        requestSignal.cleanup();
        const aborted = options.signal?.aborted === true;
        if (aborted) {
          throw error;
        }
        const transientError =
          error instanceof TypeError ||
          timedOut ||
          (error instanceof Error && error.name === 'AbortError');
        if (attempt < retryPolicy.maxAttempts && retryableRequest && transientError) {
          const delayMs = computeBackoffDelayMs(retryPolicy, attempt, null);
          await sleep(delayMs, options.signal);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Request exhausted retry budget for ${method} ${path}.`);
  }

  async getHealth<T = Record<string, unknown>>() {
    return await this.requestJson<T>('/health', {
      method: 'GET',
      retry: {
        safeMethods: ['GET', 'HEAD', 'OPTIONS']
      }
    });
  }

  async getAuthMe() {
    return await this.requestJson<CoordinatorAuthMeResponse>('/api/auth/me', {
      method: 'GET'
    });
  }

  async getInferenceStatus(token: string) {
    return await this.requestJson<CoordinatorInferenceStatusResponse>(
      `/api/request-status/${encodeURIComponent(token)}`,
      {
        method: 'GET'
      }
    );
  }

  async waitForInferenceStatus(token: string, options: CoordinatorWaitForInferenceStatusOptions = {}) {
    const terminalStatuses = options.terminalStatuses || ['settled', 'failed'];
    return await this.poll({
      load: async () => await this.getInferenceStatus(token),
      until: (status) => {
        if (terminalStatuses.includes(status.status)) {
          return true;
        }
        if (options.acceptSubmitted === true && status.status === 'submitted') {
          return true;
        }
        return false;
      },
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      timeoutMessage: `Timed out waiting for inference status token ${token} to reach a terminal state.`
    });
  }

  async getRouting() {
    return await this.requestJson<CoordinatorRoutingSnapshot>('/api/operators/routing', {
      method: 'GET'
    });
  }

  async getRoutingPolicy() {
    return await this.requestJson<CoordinatorRoutingPolicy>('/api/operators/policy', {
      method: 'GET'
    });
  }

  async getOperatorHealth() {
    return await this.requestJson<CoordinatorOperatorHealthSnapshot>('/api/operators/health', {
      method: 'GET'
    });
  }

  async getOperatorMembership() {
    return await this.requestJson<CoordinatorOperatorMembershipSnapshot>('/api/operators/membership', {
      method: 'GET'
    });
  }

  async getOperatorIsolationAudit() {
    return await this.requestJson<CoordinatorOperatorIsolationAuditSnapshot>('/api/operators/isolation/audit', {
      method: 'GET'
    });
  }

  async getPrivateLaneConfig() {
    return await this.requestJson<CoordinatorPrivateLaneConfig>('/api/private-lane/config', {
      method: 'GET'
    });
  }

  async getLaneRoute(lane: SponsorLane) {
    return await this.requestJson<CoordinatorLaneRoute>(`/api/operators/routing/${lane}`, {
      method: 'GET'
    });
  }

  async requireLaneRoute(lane: SponsorLane) {
    const route = await this.getLaneRoute(lane);
    if (route.via === 'unavailable') {
      throw new Error(`No available ${lane} route: ${route.selection.reason}`);
    }
    return route;
  }

  async waitForLaneRoute(lane: SponsorLane, options: CoordinatorWaitForLaneRouteOptions = {}) {
    return await this.poll({
      load: async () => await this.getLaneRoute(lane),
      until: (route) => {
        if (typeof options.predicate === 'function') {
          return options.predicate(route);
        }
        return route.via !== 'unavailable';
      },
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      timeoutMessage:
        options.timeoutMessage ||
        `Timed out waiting for a usable ${lane} lane route from ${this.baseUrl}.`
    });
  }

  async createAgent<T = Record<string, unknown>>(body: Record<string, unknown>) {
    return await this.requestJson<T>('/api/agents', {
      method: 'POST',
      body,
      retryUnsafe: false
    });
  }

  async submitAgentRegistration<T = CoordinatorSubmitResponse>(
    agentId: string,
    options: { version?: 'v1' | 'v2'; body?: Record<string, unknown>; idempotencyKey?: string } = {}
  ) {
    const path =
      options.version === 'v1'
        ? `/api/agents/${encodeURIComponent(agentId)}/zeko/v1/register-submit`
        : options.version === 'v2'
          ? `/api/agents/${encodeURIComponent(agentId)}/zeko/v2/register-submit`
          : `/api/agents/${encodeURIComponent(agentId)}/zeko/register-submit`;
    return await this.requestJson<T>(path, {
      method: 'POST',
      body: options.body || {},
      idempotencyKey: options.idempotencyKey
    });
  }

  async submitAgentLive<T = Record<string, unknown>>(
    agentId: string,
    options: { version?: 'v1' | 'v2'; body?: Record<string, unknown>; idempotencyKey?: string } = {}
  ) {
    const path =
      options.version === 'v1'
        ? `/api/agents/${encodeURIComponent(agentId)}/zeko/v1/live-submit`
        : options.version === 'v2'
          ? `/api/agents/${encodeURIComponent(agentId)}/zeko/v2/live-submit`
          : `/api/agents/${encodeURIComponent(agentId)}/zeko/live-submit`;
    return await this.requestJson<T>(path, {
      method: 'POST',
      body: options.body || {},
      idempotencyKey: options.idempotencyKey
    });
  }

  async submitCredits<T = CoordinatorSubmitResponse>(
    payload: Record<string, unknown>,
    options: { version?: 'v1' | 'v2'; idempotencyKey?: string } = {}
  ) {
    const path =
      options.version === 'v1' ? '/api/credits/v1/submit' : options.version === 'v2' ? '/api/credits/v2/submit' : '/api/credits-submit';
    return await this.requestJson<T>(path, {
      method: 'POST',
      body: { payload },
      idempotencyKey: options.idempotencyKey
    });
  }

  async enqueueCreditsSpend<T = Record<string, unknown>>(body: Record<string, unknown>) {
    return await this.requestJson<T>('/api/credits/spend-intent', {
      method: 'POST',
      body,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
    });
  }

  async enqueueCreditsSpendAndWait(
    body: Record<string, unknown>,
    options: CoordinatorWaitForCreditsOperatorItemOptions = {}
  ) {
    const response = await this.enqueueCreditsSpend<CoordinatorCreditsSpendIntentResponse>(body);
    const itemId = response.operator?.item?.id;
    if (!itemId) {
      throw new Error('Coordinator did not return a credits operator item to watch.');
    }
    const item = await this.waitForCreditsOperatorItem(itemId, options);
    return { response, item };
  }

  async enqueueCreditsSpendFast<T = Record<string, unknown>>(body: Record<string, unknown>) {
    return await this.requestJson<T>('/api/credits/spend-intent/fast', {
      method: 'POST',
      body,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
    });
  }

  async enqueueCreditsSpendFastAndWait(
    body: Record<string, unknown>,
    options: CoordinatorWaitForCreditsOperatorItemOptions = {}
  ) {
    const response = await this.enqueueCreditsSpendFast<CoordinatorCreditsSpendIntentResponse & { fastPath?: boolean }>(body);
    const itemId = response.operator?.item?.id;
    if (!itemId) {
      throw new Error('Coordinator did not return a fast-path credits operator item to watch.');
    }
    const item = await this.waitForCreditsOperatorItem(itemId, options);
    return { response, item };
  }

  async getCreditsOperatorQueue() {
    return await this.requestJson<CoordinatorCreditsOperatorQueueSnapshot>('/api/credits/operator/queue', {
      method: 'GET'
    });
  }

  async getCreditsOperatorItem(id: string) {
    return await this.requestJson<{ item: CoordinatorCreditsOperatorQueueItem }>(
      `/api/credits/operator/queue/${encodeURIComponent(id)}`,
      {
        method: 'GET'
      }
    );
  }

  async enqueueCreditsOperatorItem(body: Record<string, unknown>) {
    return await this.requestJson<CoordinatorCreditsOperatorEnqueueResponse>('/api/credits/operator/enqueue', {
      method: 'POST',
      body,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
    });
  }

  async enqueueCreditsOperatorItemAndWait(
    body: Record<string, unknown>,
    options: CoordinatorWaitForCreditsOperatorItemOptions = {}
  ) {
    const response = await this.enqueueCreditsOperatorItem(body);
    const item = await this.waitForCreditsOperatorItem(response.item.id, options);
    return { response, item };
  }

  async processCreditsOperator(body: Record<string, unknown> = {}) {
    return await this.requestJson<CoordinatorCreditsOperatorProcessResponse>('/api/credits/operator/process', {
      method: 'POST',
      body
    });
  }

  async waitForCreditsOperatorItem(id: string, options: CoordinatorWaitForCreditsOperatorItemOptions = {}) {
    return await this.poll({
      load: async () => (await this.getCreditsOperatorItem(id)).item,
      until: (item) => {
        if (item.status === 'failed') {
          if (options.rejectOnFailed !== false) {
            throw new Error(`Credits operator item ${id} failed: ${item.lastError || 'Unknown error.'}`);
          }
          return true;
        }

        if (item.status === 'superseded') {
          if (options.rejectOnSuperseded !== false) {
            throw new Error(
              `Credits operator item ${id} was superseded${item.supersededBy ? ` by ${item.supersededBy}` : ''}.`
            );
          }
          return true;
        }

        if (item.status === 'settled') {
          return true;
        }

        if (item.status === 'submitted' && options.acceptSubmitted === true) {
          return true;
        }

        return false;
      },
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      timeoutMessage: `Timed out waiting for credits operator item ${id} to settle.`
    });
  }

  async getCreditsCheckpointBatches() {
    return await this.requestJson<CoordinatorCreditsCheckpointBatchSnapshot>('/api/credits/operator/checkpoint-batches', {
      method: 'GET'
    });
  }

  async processCreditsCheckpointBatches(body: Record<string, unknown> = {}) {
    return await this.requestJson<CoordinatorCreditsCheckpointBatchProcessResponse>(
      '/api/credits/operator/checkpoint-batches/process',
      {
        method: 'POST',
        body
      }
    );
  }

  async getCreditsDepositMonitors() {
    return await this.requestJson<CoordinatorCreditsDepositMonitorSnapshot>('/api/credits/deposit-monitors', {
      method: 'GET'
    });
  }

  async getCreditsDepositMonitor(id: string) {
    return await this.requestJson<{ item: CoordinatorCreditsDepositMonitorItem }>(
      `/api/credits/deposit-monitors/${encodeURIComponent(id)}`,
      {
        method: 'GET'
      }
    );
  }

  async processCreditsDepositMonitor(body: Record<string, unknown> = {}) {
    return await this.requestJson<CoordinatorCreditsDepositMonitorResponse>('/api/credits/deposit-monitor/process', {
      method: 'POST',
      body
    });
  }

  async waitForCreditsDepositMonitor(
    id: string,
    options: CoordinatorWaitForCreditsDepositMonitorOptions = {}
  ) {
    return await this.poll({
      load: async () => (await this.getCreditsDepositMonitor(id)).item,
      until: (item) => {
        if (item.status === 'failed') {
          if (options.rejectOnFailed !== false) {
            throw new Error(`Credits deposit monitor ${id} failed: ${item.lastError || 'Unknown error.'}`);
          }
          return true;
        }

        if (item.status === 'confirmed') {
          return true;
        }

        if (item.status === 'monitoring' && options.acceptMonitoring === true) {
          return true;
        }

        return false;
      },
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      timeoutMessage: `Timed out waiting for credits deposit monitor ${id} to confirm.`
    });
  }

  async getCreditsBalance(ownerPublicKey: string) {
    return await this.requestJson<CoordinatorCreditsBalanceResponse>(
      `/api/credits/balance?ownerPublicKey=${encodeURIComponent(ownerPublicKey)}`,
      {
        method: 'GET'
      }
    );
  }

  async sealPrivateInferenceRequest(
    payload: CoordinatorPrivateInferenceEnvelopePayload,
    operatorPublicKeyPem?: string
  ): Promise<X25519EncryptedEnvelope> {
    const publicKeyPem = operatorPublicKeyPem || (await this.getPrivateLaneConfig()).publicKeyPem;
    return encryptJsonEnvelope(payload, publicKeyPem, getEnvelopeContext('private-input'));
  }

  async createPrivateInference<T = Record<string, unknown>>(
    body: Record<string, unknown> & {
      modelId: string;
      privateInputEnvelope?: X25519EncryptedEnvelope;
      prompt?: string;
      inputs?: Record<string, unknown>;
      operatorPublicKeyPem?: string;
    },
    options: { idempotencyKey?: string } = {}
  ) {
    const envelope =
      body.privateInputEnvelope ||
      (await this.sealPrivateInferenceRequest(
        {
          prompt: String(body.prompt || ''),
          inputs:
            body.inputs && typeof body.inputs === 'object' && body.inputs !== null
              ? (body.inputs as Record<string, unknown>)
              : {}
        },
        typeof body.operatorPublicKeyPem === 'string' ? body.operatorPublicKeyPem : undefined
      ));
    return await this.requestJson<T>('/api/infer/private', {
      method: 'POST',
      body: {
        ...body,
        privateInputEnvelope: envelope,
        prompt: undefined,
        inputs: undefined,
        operatorPublicKeyPem: undefined
      },
      idempotencyKey: options.idempotencyKey
    });
  }

  async createPrivateLiveInference<T = Record<string, unknown>>(
    body: Record<string, unknown> & {
      modelId: string;
      privateInputEnvelope?: X25519EncryptedEnvelope;
      prompt?: string;
      inputs?: Record<string, unknown>;
      operatorPublicKeyPem?: string;
    },
    options: { idempotencyKey?: string } = {}
  ) {
    const envelope =
      body.privateInputEnvelope ||
      (await this.sealPrivateInferenceRequest(
        {
          prompt: String(body.prompt || ''),
          inputs:
            body.inputs && typeof body.inputs === 'object' && body.inputs !== null
              ? (body.inputs as Record<string, unknown>)
              : {}
        },
        typeof body.operatorPublicKeyPem === 'string' ? body.operatorPublicKeyPem : undefined
      ));
    return await this.requestJson<T>('/api/infer/private/live', {
      method: 'POST',
      body: {
        ...body,
        privateInputEnvelope: envelope,
        prompt: undefined,
        inputs: undefined,
        operatorPublicKeyPem: undefined
      },
      idempotencyKey: options.idempotencyKey
    });
  }

  async createLiveInference<T = Record<string, unknown>>(
    body: Record<string, unknown>,
    options: { version?: 'v1' | 'v2'; idempotencyKey?: string } = {}
  ) {
    const path =
      options.version === 'v1' ? '/api/infer/v1/live' : options.version === 'v2' ? '/api/infer/v2/live' : '/api/infer/live';
    return await this.requestJson<T>(path, {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey
    });
  }

  async getCompatModels() {
    return await this.requestJson<CoordinatorCompatModelsResponse>('/api/compat/reference/models', {
      method: 'GET'
    });
  }

  async createCompatInference(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}) {
    return await this.requestJson<CoordinatorCompatInferenceResponse>('/api/compat/reference/inference', {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey
    });
  }

  async getCompatInference(id: string) {
    return await this.requestJson<CoordinatorCompatInferenceResponse>(
      `/api/compat/reference/inference/${encodeURIComponent(id)}`,
      {
        method: 'GET'
      }
    );
  }

  async getCompatInferenceStatus(id: string) {
    return await this.requestJson<CoordinatorInferenceStatusResponse & { object: 'compat.inference.status' }>(
      `/api/compat/reference/inference/${encodeURIComponent(id)}/status`,
      {
        method: 'GET'
      }
    );
  }

  async getCompatInferenceReceipt(id: string) {
    return await this.requestJson<CoordinatorCompatReceiptResponse>(
      `/api/compat/reference/inference/${encodeURIComponent(id)}/receipt`,
      {
        method: 'GET'
      }
    );
  }

  async createCompatChatCompletion(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}) {
    return await this.requestJson<CoordinatorCompatChatCompletionResponse>(
      '/api/compat/reference/chat/completions',
      {
        method: 'POST',
        body,
        idempotencyKey: options.idempotencyKey
      }
    );
  }

  async mcpRequest<T = unknown>(body: Record<string, unknown>) {
    return await this.requestJson<CoordinatorMcpResponse<T>>('/api/mcp', {
      method: 'POST',
      body
    });
  }

  async mcpInitialize(clientInfo: Record<string, unknown> = {}) {
    return await this.mcpRequest({
      jsonrpc: '2.0',
      id: cryptoRandomId(),
      method: 'initialize',
      params: {
        clientInfo
      }
    });
  }

  async mcpListTools() {
    return await this.mcpRequest<{ tools: Array<Record<string, unknown>> }>({
      jsonrpc: '2.0',
      id: cryptoRandomId(),
      method: 'tools/list'
    });
  }

  async mcpCallTool<T = unknown>(name: string, args: Record<string, unknown> = {}) {
    return await this.mcpRequest<{
      content: Array<{ type: string; text: string }>;
      structuredContent: T;
      isError: boolean;
    }>({
      jsonrpc: '2.0',
      id: cryptoRandomId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });
  }
}
