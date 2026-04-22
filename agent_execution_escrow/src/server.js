import './loadEnv.js';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  getAddress as normalizeEthersAddress,
  verifyMessage as verifyEvmMessage
} from 'ethers';
import {
  createAnchorSubmission,
  createNavaTransaction,
  createSettlementRegistryEntry,
  createVerifierChallenge,
  findNavaTransactionByRequestHash,
  getPersistenceStatus,
  getSettlementRegistryEntry,
  getVerifierChallenge,
  listNavaTransactions,
  listSettlementRegistryEntries,
  updateAnchorSubmission,
  updateNavaTransaction,
  updateSettlementRegistryEntry,
  consumeVerifierChallenge
} from './store.js';
import { hashPrompt, sanitizeMetadata, sealPayload } from './privacy.js';
import { buildAnchorPayload, generateArtifactProof, verifyArtifactProof } from './zekoProof.js';
import { getAnchorConfig, submitAnchorPayload } from './zekoAnchor.js';
import {
  NAVA_AUDIT_NETWORK,
  NAVA_DEFAULT_CHAIN_ID,
  NAVA_SERVICE_VERSION,
  NAVA_SETTLEMENT_PLAN,
  buildExternalVerifierAttestation,
  buildNavaAgentMetrics,
  buildNavaAgentProfile,
  buildNavaProofArtifact,
  buildNavaRequestHash,
  buildNavaVerificationServices,
  buildNavaVerificationStatus,
  buildPlatformApproval,
  buildVerifierCommitmentHash,
  buildZekoIntentSnapshot,
  buildZekoNativeVerifierAttestation,
  computeNavaLifecycleStatus,
  computeNavaTransactionStatus,
  evaluateNavaTransaction,
  formatNavaApprovalStatus,
  formatNavaTransaction,
  formatNavaTransactionDetail,
  normalizeVerificationPolicy
} from './navaCompatibility.js';
import { buildVerifierSignPayload, hashHex } from './crypto.js';
import {
  ZEKO_NATIVE_APPROVAL_AUTHORITY,
  buildZekoApprovalDomainCommitment,
  buildZekoNativeApprovalFields,
  findRegisteredZekoNativeVerifier,
  getZekoNativeVerifierRegistry,
  verifyZekoNativeApprovalSignature
} from './zekoNativeVerifier.js';

const PORT = Number(process.env.PORT || 4520);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_API_KEYS = new Set(
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);
const VERIFIER_CHALLENGE_TTL_SEC = Math.max(60, Number(process.env.VERIFIER_CHALLENGE_TTL_SEC || 900));
let anchorQueue = Promise.resolve();

function createHttpError(code, statusCode = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeEvmAddress(value) {
  try {
    return normalizeEthersAddress(String(value || '').trim());
  } catch {
    const fallback = String(value || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(fallback)) {
      try {
        return normalizeEthersAddress(fallback.toLowerCase());
      } catch {
        return '';
      }
    }
    return '';
  }
}

function getNativeVerifierRegistryForPolicy(policy) {
  if (policy?.approvalAuthority !== ZEKO_NATIVE_APPROVAL_AUTHORITY) return null;
  const registry = getZekoNativeVerifierRegistry();
  if (!registry.active) {
    throw createHttpError('zeko_native_verifier_registry_not_configured', 503);
  }
  if (registry.verifiers.length < policy.requiredExternalApprovals) {
    throw createHttpError('insufficient_zeko_native_verifiers', 400, {
      configuredVerifiers: registry.verifiers.length,
      requiredExternalApprovals: policy.requiredExternalApprovals
    });
  }
  return {
    maxVerifiers: registry.maxVerifiers,
    verifierSetRoot: registry.verifierSetRoot,
    verifiers: registry.verifiers
  };
}

function getTransactionNativeVerifierRegistry(transaction) {
  const policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {});
  if (policy.approvalAuthority !== ZEKO_NATIVE_APPROVAL_AUTHORITY) return null;
  if (transaction?.nativeVerifierRegistry?.verifierSetRoot) return transaction.nativeVerifierRegistry;
  return getNativeVerifierRegistryForPolicy(policy);
}

function buildRequestBaseUrl(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `${HOST}:${PORT}`).split(',')[0].trim();
  return `${protocol}://${host}`;
}

function wantsJsonResponse(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  if (!accept) return true;
  if (accept.includes('text/html') && !accept.includes('application/json')) return false;
  return accept.includes('application/json') || accept.includes('*/*');
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html)
  });
  res.end(html);
}

function notFound(res) {
  return sendJson(res, 404, { error: 'not_found' });
}

async function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createHttpError('body_too_large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(createHttpError('invalid_json', 400));
      }
    });
    req.on('error', reject);
  });
}

function assertPublicApiKey(req) {
  if (!PUBLIC_API_KEYS.size) return;
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !PUBLIC_API_KEYS.has(token)) {
    throw createHttpError('unauthorized', 401);
  }
}

function buildServiceInfo(req) {
  const baseUrl = buildRequestBaseUrl(req);
  const anchorConfig = getAnchorConfig();
  const nativeVerifierRegistry = getZekoNativeVerifierRegistry();
  return {
    service: 'agent-execution-escrow',
    version: NAVA_SERVICE_VERSION,
    status: 'ok',
    auditNetwork: NAVA_AUDIT_NETWORK,
    settlementPlan: NAVA_SETTLEMENT_PLAN,
    trustModel: {
      limitationIdentified: 'Current AI agent protocols are control-plane native rather than state-layer native.',
      rebuiltFor: 'Zeko-native execution escrow',
      unlocks: 'permissionless private execution escrow',
      controlPlane: 'optional_mcp_or_sdk',
      verification: nativeVerifierRegistry.active
        ? 'platform_arbiter_plus_configurable_quorum_with_zeko_native_registry'
        : 'platform_arbiter_plus_wallet_signed_external_quorum',
      lifecycleAuthority: anchorConfig.mode === 'zkapp' ? 'zkapp_proof_rules' : 'server_record_only',
      settlement: 'ethereum_planned'
    },
    compatibility: {
      navaStyleApi: true,
      mcp: 'optional',
      sdk: 'optional'
    },
    nativeVerifierRegistry: nativeVerifierRegistry.active
      ? {
          active: true,
          verifierSetRoot: nativeVerifierRegistry.verifierSetRoot,
          verifiers: nativeVerifierRegistry.verifiers
        }
      : {
          active: false,
          verifiers: []
        },
    endpoints: {
      verificationServices: `${baseUrl}/verification-services`,
      transactions: `${baseUrl}/transactions`,
      zekoVerifierRegistry: `${baseUrl}/zeko/verifier-registry`
    },
    persistence: getPersistenceStatus(),
    anchorConfig,
    now: new Date().toISOString()
  };
}

function buildProtectedResourceMetadata(req) {
  const baseUrl = buildRequestBaseUrl(req);
  return {
    resource: `${baseUrl}/`,
    bearer_methods_supported: ['header'],
    scopes_supported: ['transactions.read', 'transactions.write', 'verifier.attest'],
    permissionless: true,
    note: 'Standalone Agent Execution Escrow runs without mandatory centralized OAuth.'
  };
}

function buildAuthorizationMetadata(req) {
  const baseUrl = buildRequestBaseUrl(req);
  return {
    issuer: baseUrl,
    token_endpoint_auth_methods_supported: [],
    response_types_supported: [],
    grant_types_supported: [],
    scopes_supported: ['transactions.read', 'transactions.write', 'verifier.attest'],
    permissionless: true,
    note: 'This standalone build favors permissionless public APIs and wallet-signed attestations over hosted OAuth.'
  };
}

function normalizeTransactionBody(body = {}) {
  const escrowAddress = normalizeEvmAddress(body.escrowAddress);
  const to = normalizeEvmAddress(body.tx?.to);
  const value = String(body.tx?.value ?? '');
  const data = typeof body.tx?.data === 'string' ? body.tx.data : '0x';
  const chainId = Math.max(1, Math.trunc(Number(body.chainId || NAVA_DEFAULT_CHAIN_ID) || NAVA_DEFAULT_CHAIN_ID));
  const userPrompt = String(body.userPrompt || '').trim();
  const privacyMode = ['plain', 'private', 'confidential'].includes(String(body.privacyMode || '').trim())
    ? String(body.privacyMode).trim()
    : 'private';
  const verificationPolicy = normalizeVerificationPolicy(body.verificationPolicy || {});
  if (!escrowAddress) throw createHttpError('invalid_escrow_address', 400);
  if (!userPrompt) throw createHttpError('missing_user_prompt', 400);
  if (!to) throw createHttpError('invalid_transaction_destination', 400);
  if (!/^\d+$/.test(value)) throw createHttpError('invalid_transaction_value', 400);
  if (!/^0x[0-9a-fA-F]*$/.test(data)) throw createHttpError('invalid_transaction_data', 400);
  return {
    escrowAddress,
    userPrompt,
    tx: {
      to,
      value,
      data
    },
    chainId,
    privacyMode,
    verificationPolicy,
    contextLogs: Array.isArray(body.contextLogs) ? body.contextLogs : null,
    storePlaintext: body.storePlaintext === true
  };
}

function listTransactionsForEscrow(escrowAddress) {
  return listNavaTransactions({ escrowAddress, limit: 200 });
}

function findNavaSettlementRegistryEntry(transaction) {
  if (transaction?.settlementRegistryEntryId) {
    return getSettlementRegistryEntry(transaction.settlementRegistryEntryId);
  }
  return listSettlementRegistryEntries(500).find(
    (entry) => entry?.sourceKind === 'nava_transaction' && entry?.sourceId === transaction?.id && entry?.scope === 'nava_transaction'
  ) ?? null;
}

function upsertNavaSettlementRegistryEntry(transaction, anchorSubmission = null) {
  const latestAnchor = anchorSubmission || transaction.anchorSubmission || null;
  const verification = buildNavaVerificationStatus(transaction);
  const lifecycleStatus = computeNavaLifecycleStatus(transaction);
  const entryPatch = {
    settlementId: transaction.id,
    sessionId: transaction.id,
    intentId: transaction.id,
    sourceKind: 'nava_transaction',
    sourceId: transaction.id,
    scope: 'nava_transaction',
    registryMode: 'anchor_commitment',
    statementKind: `nava_transaction:${String(verification.status).toLowerCase()}`,
    statementHash: transaction.statementHash ?? latestAnchor?.anchorPayload?.statementHash ?? null,
    commitmentHash: latestAnchor?.payloadHash ?? hashHex({
      requestHash: transaction.requestHash,
      verification,
      promptHash: transaction.promptHash
    }),
    memo: `nava:${String(transaction.requestHash || '').slice(2, 26)}`,
    signer: 'agent-execution-escrow',
    signerType: 'platform_plus_quorum',
    signatureScheme: null,
    signatureHash: null,
    signatureVerified: null,
    walletAddress: transaction.escrowAddress,
    walletLinked: null,
    chainId: transaction.chainId,
    anchorSubmissionId: latestAnchor?.id ?? transaction.anchorSubmissionId ?? null,
    anchorStatus: latestAnchor?.status ?? transaction.anchorStatus ?? 'planned',
    submitMode: latestAnchor?.submitMode ?? null,
    payloadHash: latestAnchor?.payloadHash ?? null,
    txHash: latestAnchor?.txHash ?? null,
    network: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
    settlementStatus: lifecycleStatus,
    settlementRail: NAVA_SETTLEMENT_PLAN,
    fundingMode: 'private_execution_escrow',
    generatedAt: new Date().toISOString(),
    metadata: sanitizeMetadata({
      requestHash: transaction.requestHash,
      promptHash: transaction.promptHash,
      privacyMode: transaction.privacyMode,
      trustModel: transaction.trustModel,
      lifecycleStatus,
      externalVerifierApproved: verification.trustModel.externalVerifierQuorum.externalApproved,
      requiredExternalApprovals: verification.trustModel.externalVerifierQuorum.requiredExternalApprovals,
      proofVerified: verification.proofVerified
    })
  };
  const existing = findNavaSettlementRegistryEntry(transaction);
  if (!existing) return createSettlementRegistryEntry(entryPatch);
  return updateSettlementRegistryEntry(existing.id, entryPatch);
}

function buildVerifierAttestationMessage({
  baseUrl,
  address,
  chainId,
  nonce,
  requestHash,
  statementHash,
  commitmentHash,
  verifierId,
  role,
  issuedAt,
  expiresAt
}) {
  const domain = new URL(baseUrl).host;
  return `${domain} wants you to sign a verifier attestation:\n${address}\n\nSign to attest to an Agent Execution Escrow verification commitment.\n\nURI: ${baseUrl}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}\nResources:\n- requestHash:${requestHash}\n- statementHash:${statementHash}\n- commitmentHash:${commitmentHash}\n- verifierId:${verifierId}\n- role:${role}\n- auditNetwork:${NAVA_AUDIT_NETWORK}`;
}

function verifyVerifierChallengeSignature({ challenge, signature, signedMessage = null }) {
  if (!challenge) throw createHttpError('verifier_challenge_not_found', 404);
  if (challenge.consumedAt) throw createHttpError('verifier_challenge_consumed', 409);
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) throw createHttpError('verifier_challenge_expired', 409);
  const expectedMessage = String(challenge.message || '');
  const presentedMessage = signedMessage ? String(signedMessage) : expectedMessage;
  if (presentedMessage !== expectedMessage) {
    throw createHttpError('verifier_challenge_message_mismatch', 409);
  }
  let recoveredAddress = '';
  try {
    recoveredAddress = normalizeEvmAddress(verifyEvmMessage(presentedMessage, String(signature || '')));
  } catch {
    throw createHttpError('evm_signature_invalid', 400);
  }
  if (!recoveredAddress) throw createHttpError('evm_signature_invalid', 400);
  if (recoveredAddress !== normalizeEvmAddress(challenge.address || '')) {
    throw createHttpError('evm_signer_mismatch', 409);
  }
  return {
    address: recoveredAddress,
    chainId: Number(challenge.chainId || NAVA_DEFAULT_CHAIN_ID),
    message: expectedMessage
  };
}

function buildZekoNativeApprovalPayload(transaction) {
  const policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {});
  if (policy.approvalAuthority !== ZEKO_NATIVE_APPROVAL_AUTHORITY) {
    throw createHttpError('zeko_native_verifier_flow_not_enabled', 409);
  }
  const registry = getTransactionNativeVerifierRegistry(transaction);
  const lifecycleStatus = computeNavaLifecycleStatus(transaction);
  if (lifecycleStatus === 'APPROVED' || lifecycleStatus === 'EXECUTED' || lifecycleStatus === 'SETTLED') {
    throw createHttpError('transaction_already_past_native_approval_window', 409, { lifecycleStatus });
  }
  const snapshot = buildZekoIntentSnapshot(transaction);
  const approvalDomainCommitment = buildZekoApprovalDomainCommitment({
    verifierSetRoot: registry.verifierSetRoot
  });
  const signingFields = buildZekoNativeApprovalFields({
    intentHash: snapshot.intentHash,
    quorumThreshold: snapshot.requiredVerifierApprovals,
    approvalDomainCommitment
  });
  return {
    registry,
    signingFields,
    payload: {
      requestHash: transaction.requestHash,
      intentHash: snapshot.intentHash,
      lifecycleTarget: 'APPROVED',
      statusCode: 1,
      quorumThreshold: snapshot.requiredVerifierApprovals,
      settlementTarget: snapshot.settlementTarget,
      settlementTargetHash: snapshot.settlementTargetHash,
      verifierSetRoot: registry.verifierSetRoot,
      approvalDomainCommitment
    }
  };
}

async function anchorNavaTransaction(transaction) {
  const run = async () => {
    const proofArtifact = buildNavaProofArtifact(transaction);
    let submission = createAnchorSubmission({
      kind: 'settlement',
      sourceId: transaction.id,
      sourceKind: 'nava_transaction',
      statementKind: proofArtifact.statementKind,
      intentId: transaction.id,
      settlementId: transaction.id,
      network: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
      status: 'preparing',
      sponsor: 'agent-execution-escrow',
      queueType: 'inline',
      anchorPayload: null,
      proofArtifact,
      zkProofSummary: null
    });

    try {
      const zkProof = await generateArtifactProof(proofArtifact);
      const proofVerification = await verifyArtifactProof(zkProof);
      if (!proofVerification?.verified) throw createHttpError('proof_precheck_failed', 500);
      const anchorPayload = await buildAnchorPayload({
        proofArtifact,
        zkProof,
        network: transaction.auditNetwork || NAVA_AUDIT_NETWORK
      });
      submission = updateAnchorSubmission(submission.id, {
        status: 'prepared',
        proofArtifact,
        anchorPayload,
        zkProofSummary: {
          schema: zkProof.schema,
          statementHash: zkProof.publicInput?.statementHash ?? null,
          program: zkProof.program,
          provingSystem: zkProof.provingSystem,
          proofVerified: true
        }
      }) || submission;

      const submitResult = await submitAnchorPayload(anchorPayload, { transaction });
      submission = updateAnchorSubmission(submission.id, {
        status: submitResult.status,
        txHash: submitResult.txHash,
        payloadHash: submitResult.payloadHash,
        submitMode: submitResult.mode,
        relay: submitResult.relay ?? null,
        networkId: submitResult.networkId,
        zkapp: submitResult.zkapp ?? null,
        anchorPayload
      }) || submission;

      let current = updateNavaTransaction(transaction.id, {
        statementHash: anchorPayload.statementHash,
        proofArtifact,
        zkProofSummary: submission.zkProofSummary,
        anchorSubmissionId: submission.id,
        anchorStatus: submission.status,
        anchorSubmission: submission,
        zekoIntent: submitResult.zkapp ?? transaction.zekoIntent ?? null
      }) || transaction;
      const registryEntry = upsertNavaSettlementRegistryEntry(current, submission);
      current = updateNavaTransaction(current.id, {
        settlementRegistryEntryId: registryEntry?.id ?? null
      }) || current;
      return current;
    } catch (error) {
      submission = updateAnchorSubmission(submission.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        proofArtifact
      }) || submission;
      const current = updateNavaTransaction(transaction.id, {
        proofArtifact,
        anchorSubmissionId: submission.id,
        anchorStatus: submission.status,
        anchorSubmission: submission
      }) || transaction;
      upsertNavaSettlementRegistryEntry(current, submission);
      throw error;
    }
  };

  const queued = anchorQueue.then(run, run);
  anchorQueue = queued.catch(() => {});
  return queued;
}

function buildTransactionRecord(input) {
  const requestHash = buildNavaRequestHash({
    escrowAddress: input.escrowAddress,
    userPrompt: input.userPrompt,
    tx: input.tx,
    chainId: input.chainId,
    contextLogs: input.contextLogs
  });
  const promptHash = hashPrompt(input.userPrompt);
  const encryptedPayload =
    input.privacyMode === 'plain' && !input.storePlaintext
      ? null
      : sealPayload({
          userPrompt: input.userPrompt,
          contextLogs: input.contextLogs
        });

  const nativeVerifierRegistry = getNativeVerifierRegistryForPolicy(input.verificationPolicy);
  const transaction = createNavaTransaction({
    requestHash,
    description: input.userPrompt,
    userPrompt: input.privacyMode === 'plain' || input.storePlaintext ? input.userPrompt : null,
    promptHash,
    encryptedPayload,
    privacyMode: input.privacyMode,
    escrowAddress: input.escrowAddress,
    chainId: input.chainId,
    tx: input.tx,
    contextLogs: input.privacyMode === 'plain' || input.storePlaintext ? input.contextLogs : null,
    verificationPolicy: input.verificationPolicy,
    nativeVerifierRegistry,
    trustModel: {
      controlPlane: 'optional_mcp',
      verification:
        input.verificationPolicy.approvalAuthority === ZEKO_NATIVE_APPROVAL_AUTHORITY
          ? 'platform_arbiter_plus_zeko_native_signature_quorum'
          : 'platform_arbiter_plus_wallet_signed_external_quorum',
      privacy: input.privacyMode,
      settlement: NAVA_SETTLEMENT_PLAN
    },
    auditNetwork: NAVA_AUDIT_NETWORK,
    execution: 0,
    lifecycle: {
      settlementPlan: NAVA_SETTLEMENT_PLAN,
      executedAt: null,
      settledAt: null
    },
    approvals: {
      platform: [],
      user: [],
      external: []
    }
  });

  const evaluation = evaluateNavaTransaction({
    escrowAddress: transaction.escrowAddress,
    userPrompt: input.userPrompt,
    tx: transaction.tx,
    chainId: transaction.chainId
  });
  const platformApproval = buildPlatformApproval(transaction, evaluation);
  return updateNavaTransaction(transaction.id, {
    approvals: {
      ...transaction.approvals,
      platform: [...transaction.approvals.platform, platformApproval]
    }
  }) || transaction;
}

async function transitionTransactionLifecycle(transaction, nextStatus, body = {}) {
  const currentStatus = computeNavaLifecycleStatus(transaction);
  if (nextStatus === 'EXECUTED' && (currentStatus === 'EXECUTED' || currentStatus === 'SETTLED')) {
    return transaction;
  }
  if (nextStatus === 'SETTLED' && currentStatus === 'SETTLED') {
    return transaction;
  }
  if (nextStatus === 'EXECUTED' && currentStatus !== 'APPROVED') {
    throw createHttpError('transaction_not_ready_for_execution', 409, { currentStatus });
  }
  if (nextStatus === 'SETTLED' && currentStatus !== 'EXECUTED') {
    throw createHttpError('transaction_not_ready_for_settlement', 409, { currentStatus });
  }

  const now = new Date().toISOString();
  const lifecycle = {
    ...(transaction.lifecycle || {}),
    settlementPlan: NAVA_SETTLEMENT_PLAN
  };
  let execution = Number(transaction.execution || 0);

  if (nextStatus === 'EXECUTED') {
    lifecycle.executedAt = lifecycle.executedAt || now;
    lifecycle.executionRef = typeof body.executionRef === 'string' ? body.executionRef : transaction.lifecycle?.executionRef || null;
    execution = Math.max(1, execution);
  }

  if (nextStatus === 'SETTLED') {
    lifecycle.settledAt = lifecycle.settledAt || now;
    lifecycle.settlementRef =
      typeof body.settlementRef === 'string'
        ? body.settlementRef
        : transaction.lifecycle?.settlementRef || `ethereum:${transaction.requestHash}`;
    lifecycle.settlementRail = NAVA_SETTLEMENT_PLAN;
  }

  const updated = updateNavaTransaction(transaction.id, {
    execution,
    lifecycle
  }) || transaction;
  return anchorNavaTransaction(updated);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const urlPath = url.pathname;

  if (req.method === 'GET' && urlPath === '/') {
    if (wantsJsonResponse(req)) {
      return sendJson(res, 200, buildServiceInfo(req));
    }
    return sendHtml(
      res,
      200,
      `<!doctype html><html><body><h1>Agent Execution Escrow</h1><p>Zeko-native execution escrow with Ethereum settlement intent.</p><p>Use <code>GET /</code> with <code>accept: application/json</code> for the service metadata.</p></body></html>`
    );
  }

  if (req.method === 'GET' && urlPath === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'agent-execution-escrow',
      auditNetwork: NAVA_AUDIT_NETWORK,
      now: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && urlPath === '/zeko/verifier-registry') {
    return sendJson(res, 200, getZekoNativeVerifierRegistry());
  }

  if (req.method === 'GET' && urlPath === '/.well-known/oauth-protected-resource') {
    return sendJson(res, 200, buildProtectedResourceMetadata(req));
  }

  if (req.method === 'GET' && urlPath === '/.well-known/oauth-authorization-server') {
    return sendJson(res, 200, buildAuthorizationMetadata(req));
  }

  if (req.method === 'GET' && urlPath === '/verification-services') {
    return sendJson(res, 200, buildNavaVerificationServices(buildRequestBaseUrl(req)));
  }

  if (req.method === 'GET' && urlPath === '/verification-services/active') {
    return sendJson(res, 200, buildNavaVerificationServices(buildRequestBaseUrl(req)).filter((item) => item.active));
  }

  if (req.method === 'GET' && /^\/verification-services\/inbox\/[^/]+$/.test(urlPath)) {
    const inbox = decodeURIComponent(urlPath.split('/').pop() || '');
    return sendJson(res, 200, buildNavaVerificationServices(buildRequestBaseUrl(req)).filter((item) => item.inbox === inbox));
  }

  if (req.method === 'GET' && /^\/verification-services\/[^/]+$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/').pop() || '');
    const service = buildNavaVerificationServices(buildRequestBaseUrl(req)).find((item) => item.id === id);
    if (!service) return notFound(res);
    return sendJson(res, 200, service);
  }

  if (req.method === 'POST' && urlPath === '/transactions') {
    assertPublicApiKey(req);
    const body = await readBody(req);
    const normalized = normalizeTransactionBody(body);
    const existingHash = buildNavaRequestHash({
      escrowAddress: normalized.escrowAddress,
      userPrompt: normalized.userPrompt,
      tx: normalized.tx,
      chainId: normalized.chainId,
      contextLogs: normalized.contextLogs
    });
    const existing = findNavaTransactionByRequestHash(existingHash);
    if (existing) {
      return sendJson(res, 200, formatNavaTransaction(existing));
    }
    const created = buildTransactionRecord(normalized);
    const anchored = await anchorNavaTransaction(created);
    return sendJson(res, 201, formatNavaTransaction(anchored));
  }

  if (req.method === 'GET' && /^\/transactions\/users\/0x[a-fA-F0-9]{40}$/.test(urlPath)) {
    const address = normalizeEvmAddress(decodeURIComponent(urlPath.split('/').pop() || ''));
    if (!address) return sendJson(res, 400, { error: 'invalid_ethereum_address' });
    return sendJson(res, 200, listTransactionsForEscrow(address).map((row) => formatNavaTransaction(row)));
  }

  if (req.method === 'GET' && /^\/transactions\/0x[a-fA-F0-9]{64}$/.test(urlPath)) {
    const requestHash = decodeURIComponent(urlPath.split('/').pop() || '');
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    return sendJson(res, 200, formatNavaTransactionDetail(transaction));
  }

  if (req.method === 'POST' && /^\/transactions\/0x[a-fA-F0-9]{64}\/approvals$/.test(urlPath)) {
    assertPublicApiKey(req);
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const body = await readBody(req);
    const decision = body.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    const approval = {
      id: `user-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      decision,
      type: 'user',
      analysis: typeof body.analysis === 'string' ? body.analysis : null,
      createdAt: new Date().toISOString()
    };
    const updated = updateNavaTransaction(transaction.id, {
      approvals: {
        ...transaction.approvals,
        user: [...(transaction.approvals.user || []), approval]
      }
    }) || transaction;
    const anchored = await anchorNavaTransaction(updated);
    return sendJson(res, 200, formatNavaApprovalStatus(anchored));
  }

  if (req.method === 'GET' && /^\/transactions\/0x[a-fA-F0-9]{64}\/approval-status$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    return sendJson(res, 200, formatNavaApprovalStatus(transaction));
  }

  if (req.method === 'GET' && /^\/transactions\/0x[a-fA-F0-9]{64}\/verification-status$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    return sendJson(res, 200, buildNavaVerificationStatus(transaction));
  }

  if (req.method === 'GET' && /^\/transactions\/0x[a-fA-F0-9]{64}\/zeko-verifier-payload$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const approvalPayload = buildZekoNativeApprovalPayload(transaction);
    return sendJson(res, 200, {
      registry: approvalPayload.registry,
      payload: approvalPayload.payload,
      signingFields: approvalPayload.signingFields.map((field) => field.toString())
    });
  }

  if (req.method === 'POST' && /^\/transactions\/0x[a-fA-F0-9]{64}\/zeko-verifier-attestations$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const body = await readBody(req);
    const approvalPayload = buildZekoNativeApprovalPayload(transaction);
    const verifierPublicKey = String(body.verifierPublicKey || body.publicKey || '').trim();
    if (!verifierPublicKey) return sendJson(res, 400, { error: 'missing_verifier_public_key' });
    const registeredVerifier =
      approvalPayload.registry.verifiers.find((item) => item.zekoPublicKey === verifierPublicKey) ||
      findRegisteredZekoNativeVerifier(verifierPublicKey, approvalPayload.registry);
    if (!registeredVerifier) return sendJson(res, 403, { error: 'zeko_verifier_not_registered' });
    if (
      (Array.isArray(transaction.approvals?.external) ? transaction.approvals.external : []).some(
        (item) => item?.signatureScheme === 'mina_poseidon' && item?.zekoPublicKey === registeredVerifier.zekoPublicKey
      )
    ) {
      return sendJson(res, 409, { error: 'zeko_verifier_already_attested' });
    }
    const signature = String(body.signature || '').trim();
    if (!signature) return sendJson(res, 400, { error: 'missing_signature' });
    const signatureVerified = verifyZekoNativeApprovalSignature({
      verifierPublicKey: registeredVerifier.zekoPublicKey,
      signature,
      fields: approvalPayload.signingFields
    });
    if (!signatureVerified) return sendJson(res, 400, { error: 'invalid_zeko_verifier_signature' });
    const attestation = buildZekoNativeVerifierAttestation({
      verifierPublicKey: registeredVerifier.zekoPublicKey,
      signature,
      decision: 'APPROVED',
      verifierId: registeredVerifier.verifierId,
      role: registeredVerifier.role,
      registryVerified: true,
      ethereumAddress: registeredVerifier.ethereumAddress,
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
      analysis: typeof body.analysis === 'string' ? body.analysis : null
    });
    createSettlementRegistryEntry({
      settlementId: transaction.id,
      sessionId: transaction.id,
      intentId: transaction.id,
      sourceKind: 'nava_zeko_verifier_attestation',
      sourceId: attestation.id,
      scope: 'external_verifier',
      registryMode: 'zeko_signature_quorum',
      statementKind: 'nava_transaction:zeko_native_verifier_attestation',
      statementHash: null,
      commitmentHash: attestation.signatureHash,
      memo: `zeko-verifier:${transaction.requestHash.slice(2, 22)}`,
      signer: attestation.zekoPublicKey,
      signerType: 'registered_zeko_verifier',
      signatureScheme: attestation.signatureScheme,
      signatureHash: attestation.signatureHash,
      signatureVerified: true,
      walletAddress: attestation.walletAddress,
      chainId: null,
      anchorStatus: transaction.anchorStatus ?? null,
      payloadHash: transaction.anchorSubmission?.payloadHash ?? null,
      txHash: transaction.anchorSubmission?.txHash ?? null,
      network: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
      settlementStatus: computeNavaLifecycleStatus(transaction),
      settlementRail: NAVA_SETTLEMENT_PLAN,
      fundingMode: 'private_execution_escrow',
      generatedAt: new Date().toISOString(),
      metadata: sanitizeMetadata({
        verifierId: attestation.verifierId,
        role: attestation.role,
        zekoPublicKey: attestation.zekoPublicKey,
        approvalPayload: approvalPayload.payload
      })
    });
    const updated = updateNavaTransaction(transaction.id, {
      approvals: {
        ...transaction.approvals,
        external: [...(transaction.approvals.external || []), attestation]
      }
    }) || transaction;
    const anchored = await anchorNavaTransaction(updated);
    return sendJson(res, 200, formatNavaApprovalStatus(anchored));
  }

  if (req.method === 'POST' && /^\/transactions\/0x[a-fA-F0-9]{64}\/verifier-challenge$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const body = await readBody(req);
    const address = normalizeEvmAddress(body.verifierAddress || body.address || '');
    if (!address) return sendJson(res, 400, { error: 'invalid_verifier_address' });
    const chainId = Math.max(1, Math.trunc(Number(body.chainId || NAVA_DEFAULT_CHAIN_ID) || NAVA_DEFAULT_CHAIN_ID));
    const verifierId = String(body.verifierId || address).trim();
    const role = String(body.role || 'independent_verifier').trim();
    const decision = body.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + VERIFIER_CHALLENGE_TTL_SEC * 1000).toISOString();
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const statementHash = transaction.statementHash || hashHex({ requestHash: transaction.requestHash, promptHash: transaction.promptHash });
    const commitmentHash = buildVerifierCommitmentHash({
      requestHash: transaction.requestHash,
      statementHash,
      decision,
      verifierId,
      role,
      walletAddress: address,
      chainId
    });
    const baseUrl = buildRequestBaseUrl(req);
    const message = buildVerifierAttestationMessage({
      baseUrl,
      address,
      chainId,
      nonce,
      requestHash: transaction.requestHash,
      statementHash,
      commitmentHash,
      verifierId,
      role,
      issuedAt,
      expiresAt
    });
    const payload = buildVerifierSignPayload({
      requestHash: transaction.requestHash,
      statementHash,
      commitmentHash,
      decision,
      verifierId,
      role,
      auditNetwork: NAVA_AUDIT_NETWORK,
      chainId,
      expiresAt
    });
    const challenge = createVerifierChallenge({
      requestHash: transaction.requestHash,
      transactionId: transaction.id,
      address,
      verifierId,
      role,
      chainId,
      decision,
      statementHash,
      commitmentHash,
      nonce,
      issuedAt,
      expiresAt,
      message,
      payload
    });
    return sendJson(res, 200, {
      challenge: {
        id: challenge.id,
        requestHash: challenge.requestHash,
        verifierId: challenge.verifierId,
        role: challenge.role,
        address: challenge.address,
        chainId: challenge.chainId,
        decision: challenge.decision,
        statementHash: challenge.statementHash,
        commitmentHash: challenge.commitmentHash,
        message: challenge.message,
        payload: challenge.payload,
        expiresAt: challenge.expiresAt
      }
    });
  }

  if (req.method === 'POST' && /^\/transactions\/0x[a-fA-F0-9]{64}\/verifier-attestations$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const body = await readBody(req);
    const challengeId = String(body.walletChallengeId || body.challengeId || '').trim();
    if (!challengeId) return sendJson(res, 400, { error: 'missing_wallet_challenge_id' });
    const challenge = getVerifierChallenge(challengeId);
    if (!challenge || challenge.requestHash !== transaction.requestHash) return sendJson(res, 404, { error: 'verifier_challenge_not_found' });
    const verified = verifyVerifierChallengeSignature({
      challenge,
      signature: body.signature,
      signedMessage: body.signedMessage
    });
    const attestation = buildExternalVerifierAttestation({
      challenge,
      walletAddress: verified.address,
      signature: String(body.signature || ''),
      decision: challenge.decision,
      verifierId: challenge.verifierId,
      role: challenge.role,
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
      analysis: typeof body.analysis === 'string' ? body.analysis : null
    });
    consumeVerifierChallenge(challenge.id, {
      signerAddress: verified.address
    });
    createSettlementRegistryEntry({
      settlementId: transaction.id,
      sessionId: transaction.id,
      intentId: transaction.id,
      sourceKind: 'nava_verifier_attestation',
      sourceId: attestation.id,
      scope: 'external_verifier',
      registryMode: 'signature_commitment',
      statementKind: 'nava_transaction:verifier_attestation',
      statementHash: challenge.statementHash,
      commitmentHash: challenge.commitmentHash,
      memo: `verifier:${transaction.requestHash.slice(2, 26)}`,
      signer: attestation.walletAddress,
      signerType: 'verified_evm_wallet',
      signatureScheme: attestation.signatureScheme,
      signatureHash: attestation.signatureHash,
      signatureVerified: true,
      walletAddress: attestation.walletAddress,
      chainId: attestation.chainId,
      anchorStatus: transaction.anchorStatus ?? null,
      payloadHash: transaction.anchorSubmission?.payloadHash ?? null,
      txHash: transaction.anchorSubmission?.txHash ?? null,
      network: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
      settlementStatus: computeNavaLifecycleStatus(transaction),
      settlementRail: NAVA_SETTLEMENT_PLAN,
      fundingMode: 'private_execution_escrow',
      generatedAt: new Date().toISOString(),
      metadata: sanitizeMetadata({
        verifierId: attestation.verifierId,
        role: attestation.role,
        decision: attestation.decision
      })
    });
    const updated = updateNavaTransaction(transaction.id, {
      approvals: {
        ...transaction.approvals,
        external: [...(transaction.approvals.external || []), attestation]
      }
    }) || transaction;
    const anchored = await anchorNavaTransaction(updated);
    return sendJson(res, 200, formatNavaApprovalStatus(anchored));
  }

  if (req.method === 'POST' && /^\/transactions\/0x[a-fA-F0-9]{64}\/execute$/.test(urlPath)) {
    assertPublicApiKey(req);
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const body = await readBody(req);
    const updated = await transitionTransactionLifecycle(transaction, 'EXECUTED', body);
    return sendJson(res, 200, formatNavaTransactionDetail(updated));
  }

  if (req.method === 'POST' && /^\/transactions\/0x[a-fA-F0-9]{64}\/settle$/.test(urlPath)) {
    assertPublicApiKey(req);
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    const body = await readBody(req);
    const updated = await transitionTransactionLifecycle(transaction, 'SETTLED', body);
    return sendJson(res, 200, formatNavaTransactionDetail(updated));
  }

  if (req.method === 'GET' && /^\/transactions\/0x[a-fA-F0-9]{64}\/verifier-attestations$/.test(urlPath)) {
    const requestHash = urlPath.split('/')[2];
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction) return notFound(res);
    return sendJson(res, 200, Array.isArray(transaction.approvals?.external) ? transaction.approvals.external : []);
  }

  if (req.method === 'GET' && /^\/public\/agents\/0x[a-fA-F0-9]{40}$/.test(urlPath)) {
    const address = normalizeEvmAddress(urlPath.split('/').pop() || '');
    if (!address) return sendJson(res, 400, { error: 'invalid_ethereum_address' });
    return sendJson(res, 200, buildNavaAgentProfile({
      ethereumAddress: address,
      transactions: listTransactionsForEscrow(address)
    }));
  }

  if (req.method === 'GET' && /^\/public\/agents\/0x[a-fA-F0-9]{40}\/transactions$/.test(urlPath)) {
    const address = normalizeEvmAddress(urlPath.split('/')[3] || '');
    if (!address) return sendJson(res, 400, { error: 'invalid_ethereum_address' });
    return sendJson(res, 200, listTransactionsForEscrow(address).map((row) => formatNavaTransaction(row)));
  }

  if (req.method === 'GET' && /^\/public\/agents\/0x[a-fA-F0-9]{40}\/transactions\/0x[a-fA-F0-9]{64}$/.test(urlPath)) {
    const address = normalizeEvmAddress(urlPath.split('/')[3] || '');
    const requestHash = urlPath.split('/')[5];
    if (!address) return sendJson(res, 400, { error: 'invalid_ethereum_address' });
    const transaction = findNavaTransactionByRequestHash(requestHash);
    if (!transaction || transaction.escrowAddress !== address) return notFound(res);
    return sendJson(res, 200, formatNavaTransactionDetail(transaction));
  }

  if (req.method === 'GET' && /^\/public\/agents\/0x[a-fA-F0-9]{40}\/metrics$/.test(urlPath)) {
    const address = normalizeEvmAddress(urlPath.split('/')[3] || '');
    if (!address) return sendJson(res, 400, { error: 'invalid_ethereum_address' });
    const period = String(url.searchParams.get('period') || 'all');
    return sendJson(res, 200, buildNavaAgentMetrics({
      ethereumAddress: address,
      transactions: listTransactionsForEscrow(address),
      period
    }));
  }

  return notFound(res);
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    const code = error?.code || error?.message || 'internal_error';
    sendJson(res, statusCode, {
      error: code,
      details: error?.details || null
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-execution-escrow] listening on http://${HOST}:${PORT}`);
});
