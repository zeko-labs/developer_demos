import { id, sha256Hex } from "./digest.js";
import { verifyReceipt } from "./receipts.js";

export function buildRegistryAnchor(input = {}) {
  const payload = {
    registryVersion: "mba-registry-v1",
    sequence: input.sequence ?? 0,
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    statementHash: input.statementHash,
    payloadDigest: input.payloadDigest,
    receiptIdHash: input.receiptIdHash,
    nullifier: input.nullifier,
    previousRoot: input.previousRoot ?? "0",
    networkId: input.networkId ?? "zeko:testnet",
    registryAddress: input.registryAddress ?? null,
    txHash: input.txHash ?? null
  };
  const payloadDigest = input.payloadDigest ?? sha256Hex({
    missionIdHash: payload.missionIdHash,
    capabilityHash: payload.capabilityHash,
    statementHash: payload.statementHash,
    receiptIdHash: payload.receiptIdHash,
    nullifier: payload.nullifier
  });
  const body = {
    ...payload,
    payloadDigest,
    newRoot: input.newRoot ?? sha256Hex({
      previousRoot: payload.previousRoot,
      sequence: payload.sequence,
      payloadDigest,
      nullifier: payload.nullifier
    }),
    proofHash: input.proofHash ?? sha256Hex({
      networkId: payload.networkId,
      registryAddress: payload.registryAddress,
      txHash: payload.txHash,
      payloadDigest
    }),
    anchoredAt: input.anchoredAt ?? new Date().toISOString()
  };
  return {
    ...body,
    anchorId: input.anchorId ?? id("anchor", body)
  };
}

export function verifyAnchorPayload(receipt, anchor) {
  const receiptCheck = verifyReceipt(receipt, { allowAnchorPrepared: true });
  if (!receiptCheck.valid) return receiptCheck;
  if (!anchor || typeof anchor !== "object") {
    return { valid: false, reason: "Missing anchor." };
  }
  if (anchor.registryVersion !== "mba-registry-v1") {
    return { valid: false, reason: "Unsupported registry anchor version." };
  }
  const { anchorId, ...body } = anchor;
  if (anchorId !== id("anchor", body)) {
    return { valid: false, reason: "Anchor id mismatch." };
  }
  const expectedPayloadDigest = sha256Hex({
    missionIdHash: anchor.missionIdHash,
    capabilityHash: anchor.capabilityHash,
    statementHash: anchor.statementHash,
    receiptIdHash: anchor.receiptIdHash,
    nullifier: anchor.nullifier
  });
  if (anchor.payloadDigest !== expectedPayloadDigest) {
    return { valid: false, reason: "Anchor payloadDigest mismatch." };
  }
  const expectedRoot = sha256Hex({
    previousRoot: anchor.previousRoot,
    sequence: anchor.sequence,
    payloadDigest: anchor.payloadDigest,
    nullifier: anchor.nullifier
  });
  if (anchor.newRoot !== expectedRoot) {
    return { valid: false, reason: "Anchor newRoot mismatch." };
  }
  if (anchor.missionIdHash !== receipt.mission.missionIdHash) {
    return { valid: false, reason: "Anchor missionIdHash does not match receipt." };
  }
  if (anchor.capabilityHash !== receipt.mission.capabilityHash) {
    return { valid: false, reason: "Anchor capabilityHash does not match receipt." };
  }
  if (anchor.statementHash !== receipt.proof.statementHash) {
    return { valid: false, reason: "Anchor statementHash does not match receipt." };
  }
  if (anchor.receiptIdHash !== sha256Hex(receipt.receiptId)) {
    return { valid: false, reason: "Anchor receiptIdHash does not match receipt." };
  }
  if (anchor.nullifier !== receipt.nullifier) {
    return { valid: false, reason: "Anchor nullifier does not match receipt." };
  }
  if (receipt.anchor && receipt.anchor.payloadDigest !== anchor.payloadDigest) {
    return { valid: false, reason: "Receipt anchor payloadDigest does not match anchor." };
  }
  return {
    valid: true,
    anchorId,
    payloadDigest: anchor.payloadDigest,
    newRoot: anchor.newRoot,
    nullifier: anchor.nullifier
  };
}

export function verifySettlementState(receipt, settlement = {}) {
  const receiptCheck = verifyReceipt(receipt, { allowAnchorPrepared: true });
  if (!receiptCheck.valid) return { valid: false, decision: "release_denied", reason: receiptCheck.reason };
  const spentNullifiers = new Set(settlement.spentNullifiers ?? settlement.nullifiers ?? []);
  if (spentNullifiers.has(receipt.nullifier)) {
    return { valid: false, decision: "duplicate_payment", reason: "Receipt nullifier already settled." };
  }
  if (settlement.requiredAnchor !== false && !receipt.anchor) {
    return { valid: false, decision: "not_ready", reason: "Receipt anchor evidence is required before settlement." };
  }
  if (settlement.allowedRails && !settlement.allowedRails.includes(receipt.payment.rail)) {
    return { valid: false, decision: "policy_violation", reason: "Receipt payment rail is not allowed." };
  }
  if (settlement.expiresAt && Date.parse(settlement.expiresAt) <= Date.now()) {
    return { valid: false, decision: "expired_authorization", reason: "Settlement authorization expired." };
  }
  return {
    valid: true,
    decision: "release_allowed",
    nullifier: receipt.nullifier,
    receiptId: receipt.receiptId
  };
}
