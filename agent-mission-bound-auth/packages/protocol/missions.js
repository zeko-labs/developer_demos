import { hmacSha256Hex, id, sha256Hex } from "./digest.js";
import { signJws, verifyJws, jwks } from "./authority-keys.js";

const agents = new Map();
const missions = new Map();
const approvals = new Map();
const enforcementLog = [];

function missionSecret() {
  return process.env.MISSION_AUTHORITY_SECRET ?? process.env.ZK_OAUTH_ISSUER_SECRET ?? "local-mission-authority-secret";
}

export function buildAgentPassport(input = {}) {
  const agentId = input.agentId ?? "agent-research-ops-001";
  const domain = input.domain ?? "agents.local";
  const passport = {
    version: "agent-passport-v1",
    agentId,
    agentIdentifier: `aauth:${agentId}@${domain}`,
    represents: {
      type: "organization",
      id: input.organization ?? "Northstar Bio"
    },
    vouchedBy: [
      {
        type: "enterprise-idp",
        protocol: input.idpProtocol ?? "saml-or-oidc",
        issuer: input.issuer ?? "zk-oauth-demo.enterprise.example"
      },
      {
        type: "mission-authority",
        issuer: "agent-mission-bound-auth"
      }
    ],
    keyBinding: {
      method: "http-message-signatures-compatible",
      jwksUri: input.jwksUri ?? `https://${domain}/.well-known/agent-jwks.json`
    },
    createdAt: new Date().toISOString()
  };

  const registered = {
    ...passport,
    passportId: id("agent", passport),
    passportCommitment: sha256Hex(passport),
    authoritySignature: hmacSha256Hex(missionSecret(), passport),
    authorityJws: signJws(passport, { typ: "agent-passport+jwt" })
  };
  agents.set(registered.agentId, registered);
  return registered;
}

export function getAgentPassport(agentId) {
  return agents.get(agentId) ?? buildAgentPassport({ agentId });
}

export function proposeMission(input) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 20 * 60 * 1000));
  const agent = getAgentPassport(input.agentId);
  const mission = {
    version: "mission-bound-agent-auth-v1",
    agentId: agent.agentId,
    agentIdentifier: agent.agentIdentifier,
    personOrOrg: agent.represents,
    title: input.title ?? `Compute over ${input.datasetId}`,
    task: input.task,
    datasetId: input.datasetId,
    operation: input.operation,
    allowedTools: input.allowedTools ?? ["private_compute.run", "x402.payment_offer", "x402.pay", "x402.settle", "zeko.receipt.anchor"],
    allowedScopes: input.allowedScopes,
    constraints: {
      rawDataEgress: false,
      aggregateOnly: true,
      maxSpendUsd: input.maxSpendUsd ?? "5.00",
      allowedRails: input.allowedRails ?? ["zeko", "ethereum", "base"],
      requiresIndependentReceipt: true
    },
    checkpoints: [
      "before_payment_offer",
      "before_private_compute",
      "before_external_side_effect",
      "after_receipt"
    ],
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  const missionId = id("mission", mission);
  const missionHash = sha256Hex(mission);
  const record = {
    ...mission,
    missionId,
    missionHash,
    status: "proposed"
  };
  missions.set(missionId, record);
  return record;
}

export function approveMission(input) {
  const mission = missions.get(input.missionId);
  if (!mission) {
    throw new Error("mission_not_found");
  }

  const approvalBody = {
    version: "mission-approval-v1",
    missionId: mission.missionId,
    missionHash: mission.missionHash,
    approver: {
      type: input.approverType ?? "enterprise-human-or-policy",
      id: input.approverId ?? "approver@example.com",
      issuer: input.issuer ?? "agent-mission-bound-auth"
    },
    approvedTools: mission.allowedTools,
    approvedScopes: mission.allowedScopes,
    approvedRails: mission.constraints.allowedRails,
    missionSnapshot: {
      agentId: mission.agentId,
      datasetId: mission.datasetId,
      operation: mission.operation,
      constraints: mission.constraints,
      checkpoints: mission.checkpoints
    },
    expiresAt: mission.expiresAt,
    approvedAt: new Date().toISOString()
  };
  const approval = {
    ...approvalBody,
    approvalId: id("approval", approvalBody),
    approvalHash: sha256Hex(approvalBody),
    authoritySignature: hmacSha256Hex(missionSecret(), approvalBody),
    authorityJws: signJws(approvalBody, { typ: "mission-approval+jwt" }),
    zekoAnchor: {
      primitive: "mission-approval-commitment-v1",
      commitment: sha256Hex({
        missionHash: mission.missionHash,
        approvalHash: sha256Hex(approvalBody)
      }),
      status: "ready-to-anchor"
    }
  };

  approvals.set(approval.approvalId, approval);
  missions.set(mission.missionId, { ...mission, status: "approved", approvalId: approval.approvalId });
  return approval;
}

export function verifyMissionApproval(approval, context) {
  if (!approval || typeof approval !== "object") {
    return { ok: false, reason: "Missing mission approval." };
  }
  const {
    approvalId: _approvalId,
    approvalHash: _approvalHash,
    authoritySignature,
    authorityJws,
    zekoAnchor: _zekoAnchor,
    ...body
  } = approval;
  if (authorityJws) {
    try {
      const verified = verifyJws(authorityJws, jwks());
      if (sha256Hex(verified.payload) !== sha256Hex(body)) {
        return { ok: false, reason: "Mission approval JWS payload does not match approval body." };
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Mission approval JWS is invalid." };
    }
  } else {
    const expectedSignature = hmacSha256Hex(missionSecret(), body);
    if (authoritySignature !== expectedSignature) {
      return { ok: false, reason: "Mission approval signature is invalid." };
    }
  }
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    return { ok: false, reason: "Mission approval is expired." };
  }
  const mission = missions.get(approval.missionId) ?? approval.missionSnapshot;
  if (!mission) {
    return { ok: false, reason: "Mission approval does not include a verifiable mission snapshot." };
  }

  if (context.agentId && context.agentId !== mission.agentId) {
    return { ok: false, reason: "Mission approval is not bound to this agent." };
  }
  if (context.datasetId && context.datasetId !== mission.datasetId) {
    return { ok: false, reason: "Mission approval is not bound to this dataset." };
  }
  if (context.operation && context.operation !== mission.operation) {
    return { ok: false, reason: "Mission approval is not bound to this operation." };
  }
  if (context.railId && !approval.approvedRails.includes(context.railId)) {
    return { ok: false, reason: `Mission approval does not allow rail:${context.railId}.` };
  }
  if (context.action && !approval.approvedTools.includes(context.action)) {
    return { ok: false, reason: `Mission approval does not allow action:${context.action}.` };
  }

  return {
    ok: true,
    mission,
    approval,
    missionCommitment: sha256Hex({
      missionHash: body.missionHash,
      approvalHash: sha256Hex(body)
    })
  };
}

export function enforceCheckpoint(input) {
  if (!input.approval?.missionSnapshot?.checkpoints?.includes(input.checkpoint)) {
    return {
      ok: false,
      reason: `Mission approval does not allow checkpoint:${input.checkpoint}.`,
      event: {
        checkpointId: id("checkpoint", {
          checkpoint: input.checkpoint,
          at: Date.now(),
          missionId: input.approval?.missionId,
          context: input.context
        }),
        checkpoint: input.checkpoint,
        ok: false,
        reason: `Mission approval does not allow checkpoint:${input.checkpoint}.`,
        missionId: input.approval?.missionId ?? null,
        context: input.context,
        observedAt: new Date().toISOString()
      }
    };
  }
  const verified = verifyMissionApproval(input.approval, input.context);
  const event = {
    checkpointId: id("checkpoint", {
      checkpoint: input.checkpoint,
      at: Date.now(),
      missionId: input.approval?.missionId,
      context: input.context
    }),
    checkpoint: input.checkpoint,
    ok: verified.ok,
    reason: verified.reason ?? null,
    missionId: input.approval?.missionId ?? null,
    context: input.context,
    observedAt: new Date().toISOString()
  };
  enforcementLog.push(event);

  if (!verified.ok) {
    return { ...verified, event };
  }

  return {
    ok: true,
    event,
    mission: verified.mission,
    approval: verified.approval,
    missionCommitment: verified.missionCommitment,
    enforcementReceipt: {
      primitive: "mission-checkpoint-receipt-v1",
      checkpoint: input.checkpoint,
      missionId: verified.mission.missionId,
      approvalId: verified.approval.approvalId,
      actionHash: sha256Hex(input.context),
      receiptHash: sha256Hex(event)
    }
  };
}

export function listMissions() {
  return Array.from(missions.values());
}

export function listEnforcementLog() {
  return [...enforcementLog];
}

export function getMission(missionId) {
  return missions.get(missionId) ?? null;
}

export function getApproval(approvalId) {
  return approvals.get(approvalId) ?? null;
}
