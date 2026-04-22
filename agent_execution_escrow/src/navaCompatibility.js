import { canonicalize, hashHex, sha256Hex } from './crypto.js';
import {
  EXTERNAL_WALLET_APPROVAL_AUTHORITY,
  ZEKO_NATIVE_APPROVAL_AUTHORITY,
  buildZekoApprovalDomainCommitment,
  getZekoNativeVerifierRegistry
} from './zekoNativeVerifier.js';

export const NAVA_DEFAULT_CHAIN_ID = 11155111;
export const NAVA_AUDIT_NETWORK = 'zeko:testnet';
export const NAVA_SERVICE_VERSION = 'agent-execution-escrow-v1';
export const NAVA_SETTLEMENT_PLAN = 'ethereum';
export const NAVA_ZEKO_STATUS_CODES = Object.freeze({
  PENDING: 0,
  APPROVED: 1,
  EXECUTED: 2,
  SETTLED: 3,
  REJECTED: 4,
  UNDECIDED: 5
});

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const SELECTOR_LABELS = {
  '0x': 'native-transfer',
  '0xa9059cbb': 'erc20-transfer',
  '0x095ea7b3': 'erc20-approve',
  '0x23b872dd': 'erc20-transferFrom',
  '0x3593564c': 'uniswap-universal-router'
};

function latest(items = []) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}

function extractPromptAmount(prompt = '') {
  const match = String(prompt).match(/(\d+(?:\.\d+)?)\s*(eth|usdc|usd|weth|mina)?/i);
  if (!match) return null;
  return {
    value: Number(match[1]),
    unit: String(match[2] || '').toUpperCase() || null
  };
}

function formatWeiToEthString(value) {
  try {
    const wei = BigInt(String(value || '0'));
    const whole = wei / 1000000000000000000n;
    const fraction = String(wei % 1000000000000000000n).padStart(18, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return '0';
  }
}

function classifyCalldata(data = '0x') {
  const normalized = String(data || '0x').trim().toLowerCase();
  if (normalized === '0x') {
    return {
      selector: '0x',
      label: SELECTOR_LABELS['0x'],
      recognized: true
    };
  }
  const selector = normalized.slice(0, 10);
  return {
    selector,
    label: SELECTOR_LABELS[selector] || 'unknown-contract-call',
    recognized: Boolean(SELECTOR_LABELS[selector])
  };
}

function buildCheck({
  id,
  label,
  passed,
  severity = passed ? 'info' : 'high',
  detail,
  evidence = null
}) {
  return {
    id,
    label,
    passed: Boolean(passed),
    severity,
    detail,
    evidence
  };
}

function externalApprovedCount(transaction) {
  return (Array.isArray(transaction?.approvals?.external) ? transaction.approvals.external : []).filter(
    (row) => row?.decision === 'APPROVED' && row?.signatureVerified
  ).length;
}

function zekoNativeApprovedCount(transaction) {
  return (Array.isArray(transaction?.approvals?.external) ? transaction.approvals.external : []).filter(
    (row) =>
      row?.decision === 'APPROVED' &&
      row?.signatureVerified &&
      row?.signatureScheme === 'mina_poseidon' &&
      row?.registryVerified
  ).length;
}

function approvedVerifierCount(transaction, policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {})) {
  return policy.approvalAuthority === ZEKO_NATIVE_APPROVAL_AUTHORITY
    ? zekoNativeApprovedCount(transaction)
    : externalApprovedCount(transaction);
}

export function normalizeVerificationPolicy(input = {}) {
  const defaultRequired = Number(process.env.NAVA_REQUIRED_EXTERNAL_APPROVALS || 1);
  const requiredExternalApprovals = Math.max(
    0,
    Math.min(5, Math.trunc(Number(input.requiredExternalApprovals ?? defaultRequired) || 0))
  );
  const requireUserApproval = input.requireUserApproval === true || process.env.NAVA_REQUIRE_USER_APPROVAL === 'true';
  const approvalAuthority =
    String(input.approvalAuthority || process.env.NAVA_DEFAULT_APPROVAL_AUTHORITY || '').trim() === ZEKO_NATIVE_APPROVAL_AUTHORITY
      ? ZEKO_NATIVE_APPROVAL_AUTHORITY
      : EXTERNAL_WALLET_APPROVAL_AUTHORITY;
  return {
    requiredExternalApprovals,
    requireUserApproval,
    approvalAuthority,
    allowPlatformOnly: requiredExternalApprovals === 0 && !requireUserApproval
  };
}

function buildDecisionSummary({ decision, selectorInfo, failedChecks, warnings, promptAmount }) {
  if (decision === 'REJECTED') {
    return `Rejected because ${failedChecks.map((check) => check.detail).join('; ')}.`;
  }
  if (decision === 'UNDECIDED') {
    return `Undecided: deterministic checks passed, but the ${selectorInfo.label} call needs protocol-specific review before escrow can execute.`;
  }
  if (promptAmount?.value != null) {
    return `Approved by the platform arbiter: the transaction looks consistent with a ${promptAmount.value} ${promptAmount.unit || 'asset'} request and passed the current checks.`;
  }
  if (warnings.length) {
    return `Approved with warnings: ${warnings[0].detail}`;
  }
  return `Approved by the platform arbiter: the transaction passed deterministic checks and the current semantic heuristics for ${selectorInfo.label}.`;
}

export function buildNavaRequestHash({
  escrowAddress,
  userPrompt,
  tx,
  chainId = NAVA_DEFAULT_CHAIN_ID,
  contextLogs = null
}) {
  return hashHex({
    escrowAddress,
    userPrompt,
    tx,
    chainId,
    contextLogs
  });
}

export function evaluateNavaTransaction({
  escrowAddress,
  userPrompt,
  tx,
  chainId = NAVA_DEFAULT_CHAIN_ID
}) {
  const selectorInfo = classifyCalldata(tx?.data || '0x');
  const txValueEth = formatWeiToEthString(tx?.value || '0');
  const promptAmount = extractPromptAmount(userPrompt);
  const checks = [];

  checks.push(
    buildCheck({
      id: 'escrow-address-present',
      label: 'Escrow address bound',
      passed: Boolean(escrowAddress),
      detail: escrowAddress ? `Escrow address ${escrowAddress} is present.` : 'Escrow address is missing.'
    })
  );
  checks.push(
    buildCheck({
      id: 'destination-not-zero',
      label: 'Destination address safety',
      passed: Boolean(tx?.to) && String(tx.to).toLowerCase() !== ZERO_ADDRESS,
      severity: 'critical',
      detail:
        tx?.to && String(tx.to).toLowerCase() !== ZERO_ADDRESS
          ? `Destination ${tx.to} is not the zero address.`
          : 'Transaction destination is the zero address.'
    })
  );
  checks.push(
    buildCheck({
      id: 'value-decimal-string',
      label: 'Value encoding',
      passed: /^\d+$/.test(String(tx?.value || '')),
      severity: 'high',
      detail: /^\d+$/.test(String(tx?.value || ''))
        ? `Transaction value ${tx?.value} is encoded as a base-10 integer string.`
        : 'Transaction value must be a base-10 string.'
    })
  );
  checks.push(
    buildCheck({
      id: 'calldata-shape',
      label: 'Calldata encoding',
      passed: /^0x[0-9a-fA-F]*$/.test(String(tx?.data || '')),
      severity: 'high',
      detail: /^0x[0-9a-fA-F]*$/.test(String(tx?.data || ''))
        ? `Calldata shape is valid for ${selectorInfo.label}.`
        : 'Calldata must be a hex string prefixed with 0x.'
    })
  );
  checks.push(
    buildCheck({
      id: 'chain-id-sanity',
      label: 'Chain identifier sanity',
      passed: Number.isFinite(Number(chainId)) && Number(chainId) > 0,
      severity: 'high',
      detail:
        Number.isFinite(Number(chainId)) && Number(chainId) > 0
          ? `Chain id ${chainId} is structurally valid.`
          : 'Chain id must be a positive integer.'
    })
  );

  const warnings = [];
  if (promptAmount?.unit === 'ETH') {
    const promptValue = promptAmount.value;
    const txValue = Number(txValueEth);
    if (Number.isFinite(promptValue) && Number.isFinite(txValue) && Math.abs(promptValue - txValue) > 0.000001) {
      warnings.push(
        buildCheck({
          id: 'prompt-amount-mismatch',
          label: 'Intent amount alignment',
          passed: false,
          severity: 'medium',
          detail: `Prompt mentions ${promptValue} ETH but calldata value is ${txValueEth} ETH.`,
          evidence: {
            promptValue,
            txValueEth
          }
        })
      );
    }
  }

  if (selectorInfo.label === 'unknown-contract-call') {
    warnings.push(
      buildCheck({
        id: 'unknown-selector',
        label: 'Protocol parsing coverage',
        passed: false,
        severity: 'medium',
        detail: `Selector ${selectorInfo.selector} is not covered by the current lightweight parser.`,
        evidence: {
          selector: selectorInfo.selector
        }
      })
    );
  }

  if (selectorInfo.label === 'erc20-approve') {
    warnings.push(
      buildCheck({
        id: 'approval-surface',
        label: 'Approval risk',
        passed: false,
        severity: 'medium',
        detail: 'ERC-20 approvals can expand spending authority and should be reviewed carefully.'
      })
    );
  }

  const failedChecks = checks.filter((check) => !check.passed);
  let decision = 'APPROVED';
  if (failedChecks.length > 0) {
    decision = 'REJECTED';
  } else if (selectorInfo.label === 'unknown-contract-call' || selectorInfo.label === 'erc20-approve') {
    decision = 'UNDECIDED';
  }

  const confidence =
    decision === 'REJECTED'
      ? 0.05
      : decision === 'UNDECIDED'
        ? 0.58
        : warnings.length
          ? 0.83
          : 0.96;

  const reasoningNodes = [
    {
      id: 'deterministic-triggers',
      category: 'deterministic',
      result: failedChecks.length ? 'failed' : 'passed',
      checks
    },
    {
      id: 'intent-alignment',
      category: 'semantic',
      result: warnings.some((item) => item.id === 'prompt-amount-mismatch') ? 'warning' : 'passed',
      checks: promptAmount
        ? [
            buildCheck({
              id: 'prompt-amount-detected',
              label: 'Prompt amount parse',
              passed: true,
              detail: `Parsed prompt amount ${promptAmount.value}${promptAmount.unit ? ` ${promptAmount.unit}` : ''}.`
            }),
            ...warnings.filter((item) => item.id === 'prompt-amount-mismatch')
          ]
        : [
            buildCheck({
              id: 'prompt-amount-not-explicit',
              label: 'Prompt amount parse',
              passed: true,
              detail: 'No explicit numeric amount was found in the prompt; amount alignment remains qualitative.'
            })
          ]
    },
    {
      id: 'protocol-surface',
      category: 'semantic',
      result: selectorInfo.recognized ? 'passed' : 'warning',
      checks: [
        buildCheck({
          id: 'selector-classification',
          label: 'Selector classification',
          passed: selectorInfo.recognized,
          severity: selectorInfo.recognized ? 'info' : 'medium',
          detail: selectorInfo.recognized
            ? `Selector ${selectorInfo.selector} maps to ${selectorInfo.label}.`
            : `Selector ${selectorInfo.selector} is currently unknown.`
        }),
        ...warnings.filter((item) => item.id !== 'prompt-amount-mismatch')
      ]
    }
  ];

  return {
    decision,
    confidence,
    analysis: buildDecisionSummary({
      decision,
      selectorInfo,
      failedChecks,
      warnings,
      promptAmount
    }),
    selector: selectorInfo.selector,
    selectorLabel: selectorInfo.label,
    txValueEth,
    deterministicChecks: checks,
    warnings,
    reasoningNodes
  };
}

export function buildPlatformApproval(transaction, evaluation) {
  return {
    id: `platform-${transaction.id}`,
    decision: evaluation.decision,
    type: 'platform',
    verifierId: 'orion-zeko-arbiter',
    confidence: evaluation.confidence,
    analysis: evaluation.analysis,
    createdAt: new Date().toISOString(),
    reasoning: {
      selector: evaluation.selector,
      selectorLabel: evaluation.selectorLabel,
      deterministicChecks: evaluation.deterministicChecks,
      warnings: evaluation.warnings,
      nodes: evaluation.reasoningNodes
    }
  };
}

export function buildVerifierQuorumSummary(transaction) {
  const policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {});
  return {
    requiredExternalApprovals: policy.requiredExternalApprovals,
    externalApproved: approvedVerifierCount(transaction, policy),
    requireUserApproval: policy.requireUserApproval,
    approvalAuthority: policy.approvalAuthority
  };
}

export function computeNavaTransactionStatus(transaction) {
  const platform = latest(transaction?.approvals?.platform);
  const user = latest(transaction?.approvals?.user);
  const external = Array.isArray(transaction?.approvals?.external) ? transaction.approvals.external : [];
  const policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {});

  if (platform?.decision === 'REJECTED' || user?.decision === 'REJECTED' || external.some((row) => row?.decision === 'REJECTED')) {
    return 'REJECTED';
  }
  if (platform?.decision === 'UNDECIDED') return 'UNDECIDED';
  if (platform?.decision !== 'APPROVED') return 'PENDING';
  if (policy.requireUserApproval && user?.decision !== 'APPROVED') return 'PENDING';
  if (approvedVerifierCount(transaction, policy) < policy.requiredExternalApprovals) return 'PENDING';
  return 'APPROVED';
}

export function computeNavaLifecycleStatus(transaction) {
  const approvalStatus = computeNavaTransactionStatus(transaction);
  if (transaction?.lifecycle?.settledAt) return 'SETTLED';
  if (transaction?.lifecycle?.executedAt) return 'EXECUTED';
  if (approvalStatus === 'APPROVED' || approvalStatus === 'PENDING' || approvalStatus === 'REJECTED' || approvalStatus === 'UNDECIDED') {
    return approvalStatus;
  }
  return 'PENDING';
}

export function buildNavaVerificationStatus(transaction) {
  const platform = latest(transaction?.approvals?.platform);
  const user = latest(transaction?.approvals?.user);
  const quorum = buildVerifierQuorumSummary(transaction);
  const pendingReasons = [];
  if (!platform || platform.decision === 'PENDING') pendingReasons.push('platform_verification');
  if (platform?.decision === 'UNDECIDED') pendingReasons.push('deeper_protocol_review');
  if (quorum.requireUserApproval && user?.decision !== 'APPROVED') pendingReasons.push('user_approval');
  if (quorum.externalApproved < quorum.requiredExternalApprovals) pendingReasons.push('external_verifier_quorum');

  return {
    requestHash: transaction?.requestHash || null,
    status: computeNavaTransactionStatus(transaction),
    confidence: platform?.confidence ?? null,
    analysis: platform?.analysis || null,
    auditNetwork: transaction?.auditNetwork || NAVA_AUDIT_NETWORK,
    settlementPlan: NAVA_SETTLEMENT_PLAN,
    anchored: Boolean(transaction?.anchorSubmission?.payloadHash || transaction?.anchorSubmissionId),
    anchorStatus: transaction?.anchorSubmission?.status || transaction?.anchorStatus || 'planned',
    proofVerified: Boolean(transaction?.zkProofSummary?.proofVerified),
    pendingReasons,
    trustModel: {
      platformApproval: platform?.decision || 'PENDING',
      externalVerifierQuorum: quorum,
      userApproval: user?.decision || 'NOT_REQUIRED'
    }
  };
}

export function buildNavaProofArtifact(transaction) {
  const verification = buildNavaVerificationStatus(transaction);
  const lifecycleStatus = computeNavaLifecycleStatus(transaction);
  const platform = latest(transaction?.approvals?.platform);
  const externalApprovals = Array.isArray(transaction?.approvals?.external) ? transaction.approvals.external : [];
  const requestCommitment = hashHex({
    requestHash: transaction.requestHash,
    escrowAddress: transaction.escrowAddress,
    chainId: transaction.chainId,
    tx: transaction.tx,
    promptHash: transaction.promptHash
  });
  const batchRoot = hashHex({
    requestHash: transaction.requestHash,
    status: lifecycleStatus,
    externalApproved: approvedVerifierCount(transaction, normalizeVerificationPolicy(transaction.verificationPolicy || {})),
    policy: normalizeVerificationPolicy(transaction.verificationPolicy || {}),
    executedAt: transaction?.lifecycle?.executedAt || null,
    settledAt: transaction?.lifecycle?.settledAt || null
  });
  const attestationHash = hashHex({
    platformDecision: platform?.decision || null,
    platformConfidence: platform?.confidence || null,
    externalApprovals: externalApprovals.map((item) => ({
      id: item.id,
      decision: item.decision,
      verifierId: item.verifierId,
      walletAddress: item.walletAddress,
      signatureHash: item.signatureHash
    }))
  });

  return {
    schema: 'nava-on-zeko-proof-artifact-v1',
    statementKind: `nava_transaction:${String(verification.status).toLowerCase()}`,
    sourceKind: 'nava_transaction',
    sourceId: transaction.id,
    publicInputs: {
      intentId: transaction.id,
      sourceId: transaction.id,
      sourceKind: 'nava_transaction',
      requestCommitment,
      batchRoot,
      batchWindowId: 'nava-single',
      proofType: 'arbiter_verdict_with_quorum',
      proofHash: attestationHash
    },
    actor: {
      escrowAddress: transaction.escrowAddress,
      privacyMode: transaction.privacyMode,
      trustModel: transaction.trustModel
    },
    attestation: {
      attestationHash,
      platformDecision: platform?.decision || null,
      externalApprovals: externalApprovals.length
    },
    settlement: {
      auditNetwork: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
      settlementPlan: NAVA_SETTLEMENT_PLAN,
      lifecycleStatus,
      lifecycle: transaction.lifecycle || null,
      tx: transaction.tx
    },
    treasury: {
      executionMode: 'escrow_gated',
      finalSettlementRail: NAVA_SETTLEMENT_PLAN
    },
    settlementRef: `nava:${transaction.requestHash}`
  };
}

export function formatNavaTransaction(transaction) {
  return {
    id: transaction.id,
    requestHash: transaction.requestHash,
    description: transaction.userPrompt || transaction.description || transaction.promptHash,
    status: computeNavaTransactionStatus(transaction),
    lifecycleStatus: computeNavaLifecycleStatus(transaction),
    execution: Number(transaction.execution || 0),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt
  };
}

function sanitizeApprovalOutput(item) {
  if (!item || typeof item !== 'object') return item;
  const output = { ...item };
  delete output.signature;
  return output;
}

export function formatNavaApprovalStatus(transaction) {
  return {
    platform: Array.isArray(transaction?.approvals?.platform)
      ? transaction.approvals.platform.map(sanitizeApprovalOutput)
      : [],
    user: Array.isArray(transaction?.approvals?.user) ? transaction.approvals.user.map(sanitizeApprovalOutput) : [],
    external: Array.isArray(transaction?.approvals?.external)
      ? transaction.approvals.external.map(sanitizeApprovalOutput)
      : [],
    summary: buildNavaVerificationStatus(transaction)
  };
}

export function formatNavaTransactionDetail(transaction) {
  return {
    ...formatNavaTransaction(transaction),
    escrowAddress: transaction.escrowAddress,
    chainId: transaction.chainId,
    tx: transaction.tx,
    contextLogs: transaction.contextLogs || null,
    promptHash: transaction.promptHash,
    encryptedPayloadPresent: Boolean(transaction.encryptedPayload),
    privacyMode: transaction.privacyMode,
    verificationPolicy: normalizeVerificationPolicy(transaction.verificationPolicy || {}),
    nativeVerifierRegistry: transaction.nativeVerifierRegistry || null,
    trustModel: transaction.trustModel,
    auditNetwork: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
    lifecycle: transaction.lifecycle || null,
    verification: buildNavaVerificationStatus(transaction),
    approvals: {
      platform: Array.isArray(transaction.approvals?.platform)
        ? transaction.approvals.platform.map(sanitizeApprovalOutput)
        : [],
      user: Array.isArray(transaction.approvals?.user) ? transaction.approvals.user.map(sanitizeApprovalOutput) : [],
      external: Array.isArray(transaction.approvals?.external)
        ? transaction.approvals.external.map(sanitizeApprovalOutput)
        : []
    },
    proofArtifact: transaction.proofArtifact || null,
    zkProofSummary: transaction.zkProofSummary || null,
    zekoIntent: transaction.zekoIntent || null,
    anchorSubmission: transaction.anchorSubmission || null,
    settlementRegistryEntryId: transaction.settlementRegistryEntryId || null
  };
}

export function buildZekoApprovalCommitment(transaction) {
  const policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {});
  return hashHex({
    requestHash: transaction?.requestHash || null,
    lifecycleStatus: computeNavaLifecycleStatus(transaction),
    platform: latest(transaction?.approvals?.platform)?.decision || null,
    user: latest(transaction?.approvals?.user)?.decision || null,
    external: (Array.isArray(transaction?.approvals?.external) ? transaction.approvals.external : []).map((item) => ({
      id: item?.id || null,
      decision: item?.decision || null,
      verifierId: item?.verifierId || null,
      role: item?.role || null,
      walletAddress: item?.walletAddress || null,
      zekoPublicKey: item?.zekoPublicKey || null,
      signatureScheme: item?.signatureScheme || null,
      registryVerified: item?.registryVerified || false,
      signatureHash: item?.signatureHash || null
    })),
    requiredExternalApprovals: policy.requiredExternalApprovals,
    requireUserApproval: policy.requireUserApproval,
    approvalAuthority: policy.approvalAuthority
  });
}

export function buildZekoIntentSnapshot(transaction, overrides = {}) {
  const proofArtifact = transaction?.proofArtifact || buildNavaProofArtifact(transaction);
  const policy = normalizeVerificationPolicy(transaction?.verificationPolicy || {});
  const lifecycleStatus = computeNavaLifecycleStatus(transaction);
  const verifierSetRoot = transaction?.nativeVerifierRegistry?.verifierSetRoot || '0';
  return {
    requestHash: transaction?.requestHash || null,
    intentHash: proofArtifact?.publicInputs?.requestCommitment ?? hashHex({ requestHash: transaction?.requestHash || null }),
    statementHash:
      overrides.statementHash ||
      transaction?.statementHash ||
      proofArtifact?.publicInputs?.proofHash ||
      hashHex({ requestHash: transaction?.requestHash || null, lifecycleStatus }),
    approvalCommitment: buildZekoApprovalCommitment(transaction),
    status: lifecycleStatus,
    statusCode: NAVA_ZEKO_STATUS_CODES[lifecycleStatus] ?? NAVA_ZEKO_STATUS_CODES.PENDING,
    requiredVerifierApprovals: policy.requiredExternalApprovals,
    observedVerifierApprovals: approvedVerifierCount(transaction, policy),
    settlementTarget: NAVA_SETTLEMENT_PLAN,
    settlementTargetHash: hashHex({
      settlementPlan: NAVA_SETTLEMENT_PLAN,
      settlementRail: 'ethereum',
      auditNetwork: transaction?.auditNetwork || NAVA_AUDIT_NETWORK
    }),
    verifierSetRoot,
    approvalDomainCommitment: buildZekoApprovalDomainCommitment({
      verifierSetRoot
    }),
    lastUpdatedAt: Math.max(1, Math.floor(Date.parse(transaction?.updatedAt || new Date().toISOString()) / 1000))
  };
}

export function buildNavaVerificationServices(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const zekoRegistry = getZekoNativeVerifierRegistry();
  return [
    {
      id: 'orion-zeko-arbiter',
      name: 'Orion Zeko Arbiter',
      active: true,
      inbox: 'orion-zeko-inbox',
      type: 'platform-arbiter',
      auditNetwork: NAVA_AUDIT_NETWORK,
      executionNetwork: 'ethereum:settlement-planned',
      capabilities: ['intent_alignment', 'calldata_validation', 'semantic_policy_checks', 'proof_artifact_generation'],
      endpoint: `${normalizedBaseUrl}/verification-services/orion-zeko-arbiter`,
      description: 'Primary platform arbiter that creates the first proof artifact for a transaction.'
    },
    {
      id: 'external-verifier-quorum',
      name: 'External Verifier Quorum',
      active: true,
      inbox: 'external-verifier-inbox',
      type: 'permissionless-verifier',
      auditNetwork: NAVA_AUDIT_NETWORK,
      executionNetwork: 'ethereum:settlement-planned',
      capabilities: ['signed_attestation', 'wallet_native_verification', 'quorum_gating'],
      endpoint: `${normalizedBaseUrl}/verification-services/external-verifier-quorum`,
      description: 'Permissionless verifier lane that accepts signed wallet attestations instead of trusting a single hosted verifier.'
    },
    {
      id: 'zeko-native-verifier-registry',
      name: 'Zeko Native Verifier Registry',
      active: zekoRegistry.active,
      inbox: 'zeko-native-verifier-inbox',
      type: 'permissionless-verifier-registry',
      auditNetwork: NAVA_AUDIT_NETWORK,
      executionNetwork: 'zeko:testnet',
      capabilities: ['registered_zeko_verifier_keys', 'in_circuit_signature_quorum', 'proof_checked_approval'],
      endpoint: `${normalizedBaseUrl}/zeko/verifier-registry`,
      description: 'Registered Zeko-native verifier keys that can satisfy approval quorum directly inside the intent zkApp.'
    },
    {
      id: 'user-wallet-approval',
      name: 'User Wallet Approval',
      active: true,
      inbox: 'user-wallet-approval',
      type: 'manual-review',
      auditNetwork: NAVA_AUDIT_NETWORK,
      executionNetwork: 'ethereum:settlement-planned',
      capabilities: ['manual_override', 'user_confirmation', 'exception_review'],
      endpoint: `${normalizedBaseUrl}/verification-services/user-wallet-approval`,
      description: 'Optional user approval lane for higher-risk execution policies.'
    }
  ];
}

export function buildNavaAgentProfile({ ethereumAddress, transactions = [] }) {
  const verificationRows = transactions.map((row) => buildNavaVerificationStatus(row));
  const avgConfidence =
    verificationRows.filter((row) => typeof row.confidence === 'number').length > 0
      ? verificationRows
          .filter((row) => typeof row.confidence === 'number')
          .reduce((sum, row) => sum + Number(row.confidence || 0), 0) /
        verificationRows.filter((row) => typeof row.confidence === 'number').length
      : null;

  return {
    ethereumAddress,
    auditNetwork: NAVA_AUDIT_NETWORK,
    settlementPlan: NAVA_SETTLEMENT_PLAN,
    transactions: transactions.length,
    approvals: {
      approved: verificationRows.filter((row) => row.status === 'APPROVED').length,
      rejected: verificationRows.filter((row) => row.status === 'REJECTED').length,
      undecided: verificationRows.filter((row) => row.status === 'UNDECIDED').length,
      pending: verificationRows.filter((row) => row.status === 'PENDING').length
    },
    averageConfidence: avgConfidence,
    anchoredTransactions: transactions.filter((row) => row.anchorSubmission?.payloadHash || row.anchorSubmissionId).length,
    externalVerifierApprovals: transactions.reduce(
      (sum, row) => sum + approvedVerifierCount(row, normalizeVerificationPolicy(row.verificationPolicy || {})),
      0
    ),
    lastActivityAt: transactions[0]?.updatedAt || null,
    trustModel: {
      controlPlane: 'optional_mcp',
      execution: 'zeko_native',
      settlement: 'ethereum',
      verifierQuorum: 'wallet_signed_attestations'
    }
  };
}

export function buildNavaAgentMetrics({ ethereumAddress, transactions = [], period = 'all' }) {
  const normalizedPeriod = ['24h', '7d', '30d', 'all'].includes(period) ? period : 'all';
  const now = Date.now();
  const filtered = transactions.filter((row) => {
    if (normalizedPeriod === 'all') return true;
    const createdAtMs = Date.parse(row.createdAt || 0);
    if (!Number.isFinite(createdAtMs)) return false;
    const ageMs = now - createdAtMs;
    if (normalizedPeriod === '24h') return ageMs <= 24 * 60 * 60 * 1000;
    if (normalizedPeriod === '7d') return ageMs <= 7 * 24 * 60 * 60 * 1000;
    if (normalizedPeriod === '30d') return ageMs <= 30 * 24 * 60 * 60 * 1000;
    return true;
  });
  const profile = buildNavaAgentProfile({ ethereumAddress, transactions: filtered });
  return {
    period: normalizedPeriod,
    ethereumAddress,
    transactions: profile.transactions,
    approvals: profile.approvals,
    averageConfidence: profile.averageConfidence,
    anchoredTransactions: profile.anchoredTransactions,
    externalVerifierApprovals: profile.externalVerifierApprovals,
    auditNetwork: profile.auditNetwork,
    settlementPlan: profile.settlementPlan
  };
}

export function buildVerifierCommitmentHash({
  requestHash,
  statementHash,
  decision,
  verifierId,
  role,
  walletAddress,
  chainId
}) {
  return hashHex({
    requestHash,
    statementHash,
    decision,
    verifierId,
    role,
    walletAddress,
    chainId
  });
}

export function buildExternalVerifierAttestation({
  challenge,
  walletAddress,
  signature,
  decision,
  verifierId,
  role,
  confidence = null,
  analysis = null
}) {
  return {
    id: `ext-${sha256Hex(canonicalize({ walletAddress, signature, decision, verifierId, role })).slice(0, 16)}`,
    type: 'external',
    decision,
    verifierId,
    role,
    walletAddress,
    chainId: challenge.chainId,
    signature,
    signatureScheme: 'siwe_eip191',
    signatureHash: hashHex(signature),
    signatureVerified: true,
    confidence,
    analysis,
    commitmentHash: challenge.commitmentHash,
    statementHash: challenge.statementHash,
    createdAt: new Date().toISOString()
  };
}

export function buildZekoNativeVerifierAttestation({
  verifierPublicKey,
  signature,
  decision,
  verifierId,
  role,
  registryVerified = true,
  ethereumAddress = null,
  confidence = null,
  analysis = null
}) {
  return {
    id: `ext-${sha256Hex(canonicalize({ verifierPublicKey, signature, decision, verifierId, role })).slice(0, 16)}`,
    type: 'external',
    decision,
    verifierId,
    role,
    walletAddress: ethereumAddress,
    zekoPublicKey: verifierPublicKey,
    chainId: null,
    signature,
    signatureScheme: 'mina_poseidon',
    signatureHash: hashHex(signature),
    signatureVerified: true,
    registryVerified,
    confidence,
    analysis,
    createdAt: new Date().toISOString()
  };
}
