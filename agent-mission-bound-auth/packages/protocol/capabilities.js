import { id, randomSalt, sha256Hex } from "./digest.js";

export const BOUNDARY_EVENT_VOCABULARY = Object.freeze({
  version: "mission-bound-action-vocabulary-v1",
  actions: [
    "browser.open",
    "page.read",
    "form.fill",
    "vault.read",
    "cart.prepare",
    "payment.prepare",
    "payment.authorize",
    "private_compute.run",
    "email.draft",
    "email.send",
    "external_agent.hire",
    "external_app.side_effect",
    "final_submit",
    "x402.payment_offer",
    "x402.pay",
    "x402.settle",
    "zeko.receipt.anchor"
  ]
});

export const MISSION_PROOF_STATES = Object.freeze([
  "capability_issued",
  "holder_bound",
  "funds_reserved",
  "mission_started",
  "boundary_events_recorded",
  "receipt_created",
  "proof_prepared",
  "proof_verified",
  "anchor_prepared",
  "anchored",
  "settlement_release_allowed",
  "settled",
  "disputed",
  "expired",
  "failed"
]);

export const SETTLEMENT_DECISIONS = Object.freeze([
  "not_ready",
  "release_allowed",
  "release_denied",
  "manual_review",
  "duplicate_payment",
  "expired_authorization",
  "policy_violation"
]);

export function buildMissionPolicy(input = {}) {
  const policy = {
    version: "mission-bound-policy-v1",
    missionId: input.missionId,
    task: input.task,
    allowedDomains: input.allowedDomains ?? [],
    allowedActions: input.allowedActions ?? input.allowedTools ?? [],
    dataScopes: input.dataScopes ?? input.datasetScopes ?? [],
    paymentRails: input.paymentRails ?? input.allowedRails ?? [],
    maxSpendUsd: input.maxSpendUsd ?? "0.00",
    expiresAt: input.expiresAt,
    checkpoints: input.checkpoints ?? [],
    constraints: input.constraints ?? {},
    receiptRequirements: input.receiptRequirements ?? [
      "capabilityHash",
      "policyHash",
      "traceHash",
      "paymentContextDigest",
      "nullifier",
      "anchorReference"
    ]
  };

  return {
    ...policy,
    policyHash: sha256Hex(policy)
  };
}

export function buildMissionCapability(input = {}) {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const nullifierSeed = input.nullifierSeed ?? randomSalt(24);
  const body = {
    version: "mission-bound-capability-v1",
    issuer: input.issuer ?? "agent-mission-bound-auth",
    audience: input.audience ?? "mission-verifier",
    principalHash: input.principalHash ?? sha256Hex(input.principal ?? "unknown-principal"),
    agentId: input.agentId,
    runtimeId: input.runtimeId ?? input.agentId,
    holderKeyCommitment: input.holderKeyCommitment ?? sha256Hex(input.holderPublicKey ?? input.agentId ?? "unknown-holder"),
    missionId: input.missionId,
    missionIdHash: input.missionIdHash ?? sha256Hex(input.missionId ?? "unknown-mission"),
    allowedDomains: input.allowedDomains ?? [],
    allowedActions: input.allowedActions ?? input.allowedTools ?? [],
    dataScopes: input.dataScopes ?? input.datasetScopes ?? [],
    paymentRails: input.paymentRails ?? input.allowedRails ?? [],
    maxSpendUsd: input.maxSpendUsd ?? "0.00",
    expiresAt,
    jti: input.jti ?? id("jti", { missionId: input.missionId, agentId: input.agentId, nullifierSeed }),
    nullifierSeed,
    settlementReleaseCondition: input.settlementReleaseCondition ?? "valid_receipt_root_and_payment_context"
  };

  const capabilityId = input.capabilityId ?? id("capability", body);
  const capabilityHash = sha256Hex(body);
  return {
    ...body,
    capabilityId,
    capabilityHash,
    nullifier: sha256Hex({
      capabilityId,
      capabilityHash,
      missionIdHash: body.missionIdHash,
      nullifierSeed,
      settlementReleaseCondition: body.settlementReleaseCondition
    })
  };
}

export function verifyCapability(capability, options = {}) {
  if (!capability || typeof capability !== "object") {
    return { valid: false, reason: "Missing capability." };
  }
  if (capability.version !== "mission-bound-capability-v1") {
    return { valid: false, reason: "Unsupported capability version." };
  }

  const {
    capabilityId,
    capabilityHash,
    nullifier,
    ...body
  } = capability;
  const expectedId = id("capability", body);
  if (capabilityId !== expectedId) {
    return { valid: false, reason: "Capability id mismatch." };
  }
  const expectedHash = sha256Hex(body);
  if (capabilityHash !== expectedHash) {
    return { valid: false, reason: "Capability hash mismatch." };
  }
  const expectedNullifier = sha256Hex({
    capabilityId,
    capabilityHash,
    missionIdHash: body.missionIdHash,
    nullifierSeed: body.nullifierSeed,
    settlementReleaseCondition: body.settlementReleaseCondition
  });
  if (nullifier !== expectedNullifier) {
    return { valid: false, reason: "Capability nullifier mismatch." };
  }
  if (!options.allowExpired) {
    const expiry = Date.parse(capability.expiresAt);
    if (Number.isNaN(expiry) || expiry <= Date.now()) {
      return { valid: false, reason: "Capability expired or has invalid expiry." };
    }
  }
  return { valid: true, capabilityHash, capabilityId, nullifier };
}
