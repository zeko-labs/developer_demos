import type { ProofEnvelope } from '@tap/shared-types';

type GuardReason =
  | 'policy_linkage_missing'
  | 'active_policy_not_found'
  | 'policy_version_mismatch'
  | 'policy_hash_mismatch';

export interface PolicyGuardFailure {
  ok: false;
  reason: GuardReason;
  detail: string;
}

export interface PolicyGuardSuccess {
  ok: true;
  tenantId: string;
  policyId: number;
  policySnapshotHash: string;
  policyVersion: number;
  policyEffectiveAt: string;
}

export type PolicyGuardResult = PolicyGuardFailure | PolicyGuardSuccess;

export interface PolicyLinkageInput {
  tenantId: string | undefined;
  policyId: number | undefined;
  policyVersion: number | undefined;
  policyHash: string | undefined;
}

export interface ActivePolicySnapshot {
  version: number;
  policyHash: string;
  effectiveAt: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function extractPolicyLinkage(
  proof: Pick<ProofEnvelope, 'publicInput'>,
  metadata?: Record<string, unknown>
): PolicyLinkageInput {
  const input = proof.publicInput || {};
  return {
    tenantId: readString(input.tenantId) ?? readString(metadata?.tenantId),
    policyId: readNumber(input.policyId) ?? readNumber(metadata?.policyId),
    policyVersion: readNumber(input.policyVersion) ?? readNumber(metadata?.policyVersion),
    policyHash: readString(input.policyHash) ?? readString(metadata?.policyHash)
  };
}

export function validatePolicyAtSettlement(
  linkage: PolicyLinkageInput,
  activePolicy: ActivePolicySnapshot | null
): PolicyGuardResult {
  if (!linkage.tenantId || linkage.policyId === undefined || linkage.policyVersion === undefined || !linkage.policyHash) {
    return {
      ok: false,
      reason: 'policy_linkage_missing',
      detail: 'tenantId, policyId, policyVersion, and policyHash are required for settlement'
    };
  }

  if (!activePolicy) {
    return {
      ok: false,
      reason: 'active_policy_not_found',
      detail: `no active policy for tenant=${linkage.tenantId} policyId=${linkage.policyId}`
    };
  }

  if (activePolicy.version !== linkage.policyVersion) {
    return {
      ok: false,
      reason: 'policy_version_mismatch',
      detail: `proof policyVersion=${linkage.policyVersion} active policyVersion=${activePolicy.version}`
    };
  }

  if (activePolicy.policyHash !== linkage.policyHash) {
    return {
      ok: false,
      reason: 'policy_hash_mismatch',
      detail: `proof policyHash=${linkage.policyHash} active policyHash=${activePolicy.policyHash}`
    };
  }

  return {
    ok: true,
    tenantId: linkage.tenantId,
    policyId: linkage.policyId,
    policySnapshotHash: activePolicy.policyHash,
    policyVersion: activePolicy.version,
    policyEffectiveAt: activePolicy.effectiveAt
  };
}
