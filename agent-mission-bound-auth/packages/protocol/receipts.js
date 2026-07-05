import { id, sha256Hex } from "./digest.js";
import { verifyTraceChain } from "./boundary-events.js";

export const PRODUCTION_FINAL_SETTLEMENT_STATES = new Set([
  "settlement_release_allowed",
  "settled"
]);

function receiptIdentityBody(body) {
  const {
    anchor: _anchor,
    exportedAt: _exportedAt,
    registryRoot: _registryRoot,
    settlementState: _settlementState,
    ...identityBody
  } = body;
  return identityBody;
}

export function buildMissionReceiptExport(input = {}) {
  const trace = input.traceEvents
    ? verifyTraceChain(input.traceEvents, { allowExpired: true })
    : input.trace;
  if (!trace?.valid && input.traceEvents) {
    throw new Error(trace.reason);
  }

  const body = {
    schema: "mission-bound-auth-receipt-v1",
    mission: {
      missionIdHash: input.missionIdHash,
      capabilityHash: input.capabilityHash,
      issuer: input.issuer,
      audience: input.audience
    },
    policy: {
      policyHash: input.policyHash,
      allowedDomainsHash: input.allowedDomainsHash,
      allowedActionsHash: input.allowedActionsHash,
      maxSpendCommitment: input.maxSpendCommitment,
      paymentRailsHash: input.paymentRailsHash
    },
    holder: {
      keyThumbprint: input.holderKeyThumbprint,
      proofScheme: input.proofScheme ?? "digest-holder-proof-v1"
    },
    trace: {
      eventCount: trace.eventCount,
      traceHash: trace.traceHash,
      latestEventHash: trace.latestEventHash
    },
    payment: {
      paymentCommitment: input.paymentCommitment,
      rail: input.rail,
      amountCommitment: input.amountCommitment,
      paymentContextDigest: input.paymentContextDigest
    },
    proof: {
      statementKind: input.statementKind ?? "mission-bound-trace-compliance-v1",
      statementHash: input.statementHash,
      proofSystem: input.proofSystem ?? "signed-commitment-transition",
      verificationKeyHash: input.verificationKeyHash ?? null
    },
    nullifier: input.nullifier,
    registryRoot: input.registryRoot ?? null,
    settlementState: input.settlementState ?? "receipt_created",
    anchor: input.anchor ?? null,
    exportedAt: input.exportedAt ?? new Date().toISOString()
  };
  const receiptId = input.receiptId ?? id("receipt", receiptIdentityBody(body));
  return {
    ...body,
    receiptId,
    receiptHash: sha256Hex(body)
  };
}

export function verifyReceipt(receipt, options = {}) {
  if (!receipt || typeof receipt !== "object") {
    return { valid: false, reason: "Missing receipt." };
  }
  if (receipt.schema !== "mission-bound-auth-receipt-v1") {
    return { valid: false, reason: "Unsupported receipt schema." };
  }
  const { receiptId, receiptHash, ...body } = receipt;
  if (receiptId !== id("receipt", receiptIdentityBody(body))) {
    return { valid: false, reason: "Receipt id mismatch." };
  }
  if (receiptHash !== sha256Hex(body)) {
    return { valid: false, reason: "Receipt hash mismatch." };
  }
  if (!receipt.mission?.capabilityHash) {
    return { valid: false, reason: "Receipt missing capabilityHash." };
  }
  if (!receipt.policy?.policyHash) {
    return { valid: false, reason: "Receipt missing policyHash." };
  }
  if (!receipt.trace?.traceHash || !receipt.trace?.latestEventHash) {
    return { valid: false, reason: "Receipt missing trace commitment." };
  }
  if (!receipt.payment?.paymentContextDigest) {
    return { valid: false, reason: "Receipt missing paymentContextDigest." };
  }
  if (!receipt.nullifier) {
    return { valid: false, reason: "Receipt missing nullifier." };
  }
  if (
    !options.allowAnchorPrepared &&
    PRODUCTION_FINAL_SETTLEMENT_STATES.has(receipt.settlementState) &&
    !receipt.anchor
  ) {
    return { valid: false, reason: "Production-final receipts require anchor evidence." };
  }
  return {
    valid: true,
    receiptId,
    receiptHash,
    nullifier: receipt.nullifier,
    settlementState: receipt.settlementState
  };
}
