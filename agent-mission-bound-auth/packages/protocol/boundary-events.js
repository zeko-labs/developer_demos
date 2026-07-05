import { id, sha256Hex } from "./digest.js";

export function holderChallengeHash(eventBody) {
  return sha256Hex({
    missionIdHash: eventBody.missionIdHash,
    capabilityHash: eventBody.capabilityHash,
    policyHash: eventBody.policyHash,
    eventType: eventBody.eventType,
    action: eventBody.action,
    actionHash: eventBody.actionHash,
    targetDomainHash: eventBody.targetDomainHash,
    resourceHash: eventBody.resourceHash,
    paymentContextDigest: eventBody.paymentContextDigest,
    sideEffectId: eventBody.sideEffectId,
    idempotencyKey: eventBody.idempotencyKey,
    previousEventHash: eventBody.previousEventHash
  });
}

export function buildHolderProof(eventBody, input = {}) {
  const messageHash = holderChallengeHash(eventBody);
  return {
    scheme: input.scheme ?? "digest-holder-proof-v1",
    keyThumbprint: input.keyThumbprint ?? eventBody.holderKeyCommitment,
    messageHash,
    signature: input.signature ?? sha256Hex({
      holderSecret: input.holderSecret ?? "local-holder-proof",
      messageHash
    })
  };
}

export function buildBoundaryEvent(input = {}) {
  const body = {
    version: "mission-bound-boundary-event-v1",
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    policyHash: input.policyHash,
    eventType: input.eventType ?? input.action,
    action: input.action,
    actionHash: input.actionHash ?? sha256Hex(input.action ?? input.eventType),
    targetDomainHash: input.targetDomainHash ?? sha256Hex(input.targetDomain ?? "unknown-domain"),
    resourceHash: input.resourceHash ?? sha256Hex(input.resource ?? input.datasetId ?? "unknown-resource"),
    paymentContextDigest: input.paymentContextDigest ?? sha256Hex(input.paymentContext ?? "no-payment-context"),
    sideEffectId: input.sideEffectId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    previousEventHash: input.previousEventHash ?? "GENESIS",
    observedAt: input.observedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt,
    holderKeyCommitment: input.holderKeyCommitment
  };
  const holderProof = input.holderProof ?? buildHolderProof(body, input.holder ?? {});
  const eventBody = {
    ...body,
    holderProof
  };
  return {
    ...eventBody,
    eventId: input.eventId ?? id("event", eventBody),
    eventHash: sha256Hex(eventBody)
  };
}

export function verifyBoundaryEvent(event, options = {}) {
  if (!event || typeof event !== "object") {
    return { valid: false, reason: "Missing boundary event." };
  }
  if (event.version !== "mission-bound-boundary-event-v1") {
    return { valid: false, reason: "Unsupported boundary event version." };
  }
  const { eventId, eventHash, ...body } = event;
  if (eventId !== id("event", body)) {
    return { valid: false, reason: "Boundary event id mismatch." };
  }
  if (eventHash !== sha256Hex(body)) {
    return { valid: false, reason: "Boundary event hash mismatch." };
  }
  if (options.previousEventHash && event.previousEventHash !== options.previousEventHash) {
    return { valid: false, reason: "Boundary event previousHash mismatch." };
  }
  if (options.missionIdHash && event.missionIdHash !== options.missionIdHash) {
    return { valid: false, reason: "Boundary event missionIdHash mismatch." };
  }
  if (options.capabilityHash && event.capabilityHash !== options.capabilityHash) {
    return { valid: false, reason: "Boundary event capabilityHash mismatch." };
  }
  if (options.policyHash && event.policyHash !== options.policyHash) {
    return { valid: false, reason: "Boundary event policyHash mismatch." };
  }
  if (options.allowedActions && !options.allowedActions.includes(event.action)) {
    return { valid: false, reason: `Boundary event action not allowed: ${event.action}.` };
  }
  if (options.allowedDomainHashes && !options.allowedDomainHashes.includes(event.targetDomainHash)) {
    return { valid: false, reason: "Boundary event target domain not allowed." };
  }
  if (!options.allowExpired && event.expiresAt && Date.parse(event.expiresAt) <= Date.now()) {
    return { valid: false, reason: "Boundary event expired." };
  }
  const holderProof = event.holderProof;
  if (!holderProof?.messageHash) {
    return { valid: false, reason: "Boundary event missing holder proof message hash." };
  }
  if (holderProof.messageHash !== holderChallengeHash(body)) {
    return { valid: false, reason: "Boundary event holder proof is not bound to this action context." };
  }
  return { valid: true, eventHash, eventId };
}

export function verifyTraceChain(events = [], options = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    return { valid: false, reason: "Trace must contain at least one boundary event." };
  }

  let previousEventHash = options.initialPreviousEventHash ?? "GENESIS";
  for (const event of events) {
    const verified = verifyBoundaryEvent(event, {
      ...options,
      previousEventHash
    });
    if (!verified.valid) {
      return { ...verified, eventHash: event?.eventHash };
    }
    previousEventHash = event.eventHash;
  }

  const latestEventHash = events.at(-1).eventHash;
  return {
    valid: true,
    eventCount: events.length,
    traceHash: sha256Hex({ events: events.map((event) => event.eventHash) }),
    latestEventHash
  };
}
