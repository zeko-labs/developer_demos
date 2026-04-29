import { Encoding, Field, Poseidon, PrivateKey, PublicKey, Signature } from 'o1js';
import type { SponsorLane } from './sponsor-lanes.js';

export type OperatorRegistryStatus = 'active' | 'paused' | 'draining';
export type OperatorMembershipRole = 'primary' | 'backup' | 'standby';

export type SignatureJson = ReturnType<Signature['toJSON']>;

export interface OperatorMembershipLanePolicy {
  lane: SponsorLane;
  enabled: boolean;
  publicKey: string | null;
  priority: number;
  role: OperatorMembershipRole;
  notes: string[];
}

export interface OperatorMembershipRecordBody {
  operatorId: string;
  label: string;
  endpoint: string | null;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: OperatorMembershipLanePolicy[];
  allowedStatuses: OperatorRegistryStatus[];
  metadata: Record<string, unknown> | null;
  issuedAt: string;
  updatedAt: string;
}

export interface SignedOperatorMembershipRecord extends OperatorMembershipRecordBody {
  policyDigest: string;
  policyPublicKey: string;
  policySignature: SignatureJson;
}

export interface OperatorMembershipFile {
  version: 1;
  generatedAt: string;
  policyPublicKey: string;
  operators: SignedOperatorMembershipRecord[];
}

export interface VerifiedOperatorMembershipRecord {
  record: SignedOperatorMembershipRecord;
  verified: boolean;
  verificationError: string | null;
  laneMap: Record<SponsorLane, OperatorMembershipLanePolicy | null>;
}

const sponsorLanes = ['request', 'output', 'registry', 'credits'] as SponsorLane[];

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function hashStringToField(value: string) {
  const fields = Encoding.stringToFields(value.length ? value : '0');
  return Poseidon.hash(fields.length ? fields : [Field(0)]);
}

export function normalizeOperatorMembershipRole(
  value: unknown,
  fallback: OperatorMembershipRole = 'primary'
): OperatorMembershipRole {
  return value === 'primary' || value === 'backup' || value === 'standby' ? value : fallback;
}

export function operatorMembershipRoleWeight(role: OperatorMembershipRole) {
  if (role === 'primary') return 3;
  if (role === 'backup') return 2;
  return 1;
}

export function normalizeOperatorMembershipLanePolicy(
  value: unknown,
  fallbackLane: SponsorLane = 'credits'
): OperatorMembershipLanePolicy {
  const body = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const lane = sponsorLanes.includes(body.lane as SponsorLane) ? (body.lane as SponsorLane) : fallbackLane;
  const priority = Number(body.priority);
  return {
    lane,
    enabled: body.enabled !== false,
    publicKey: typeof body.publicKey === 'string' && body.publicKey.trim().length > 0 ? body.publicKey.trim() : null,
    priority: Number.isFinite(priority) ? Math.max(0, Math.round(priority)) : 100,
    role: normalizeOperatorMembershipRole(body.role, 'primary'),
    notes: Array.isArray(body.notes) ? body.notes.map((entry) => String(entry)) : []
  };
}

export function normalizeOperatorMembershipRecordBody(
  value: unknown,
  fallbackId = 'operator-1'
): OperatorMembershipRecordBody {
  const body = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const sponsorLanePolicies = Array.isArray(body.sponsorLanes)
    ? body.sponsorLanes.map((entry) => normalizeOperatorMembershipLanePolicy(entry)).sort(compareMembershipLanePolicy)
    : [];
  const allowedStatuses: OperatorRegistryStatus[] = Array.isArray(body.allowedStatuses)
    ? Array.from(
        new Set(
          body.allowedStatuses.filter(
            (entry): entry is OperatorRegistryStatus => entry === 'active' || entry === 'paused' || entry === 'draining'
          )
        )
      )
    : ['active', 'paused', 'draining'];
  return {
    operatorId: typeof body.operatorId === 'string' && body.operatorId.trim().length > 0 ? body.operatorId.trim() : fallbackId,
    label:
      typeof body.label === 'string' && body.label.trim().length > 0
        ? body.label.trim()
        : typeof body.operatorId === 'string' && body.operatorId.trim().length > 0
          ? body.operatorId.trim()
          : fallbackId,
    endpoint: typeof body.endpoint === 'string' && body.endpoint.trim().length > 0 ? body.endpoint.trim() : null,
    networkId: typeof body.networkId === 'string' && body.networkId.trim().length > 0 ? body.networkId.trim() : 'testnet',
    contractVersions: Array.isArray(body.contractVersions)
      ? body.contractVersions.filter((entry): entry is 'v1' | 'v2' => entry === 'v1' || entry === 'v2')
      : ['v2'],
    capabilities: Array.isArray(body.capabilities)
      ? Array.from(new Set(body.capabilities.map((entry) => String(entry)).filter(Boolean))).sort((a, b) => a.localeCompare(b))
      : [],
    sponsorLanes: sponsorLanePolicies,
    allowedStatuses: allowedStatuses.length ? allowedStatuses : ['active'],
    metadata: typeof body.metadata === 'object' && body.metadata !== null ? (body.metadata as Record<string, unknown>) : null,
    issuedAt: typeof body.issuedAt === 'string' && body.issuedAt.trim().length > 0 ? body.issuedAt.trim() : new Date().toISOString(),
    updatedAt:
      typeof body.updatedAt === 'string' && body.updatedAt.trim().length > 0 ? body.updatedAt.trim() : new Date().toISOString()
  };
}

export function compareMembershipLanePolicy(a: OperatorMembershipLanePolicy, b: OperatorMembershipLanePolicy) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aWeight = operatorMembershipRoleWeight(a.role);
  const bWeight = operatorMembershipRoleWeight(b.role);
  if (aWeight !== bWeight) return bWeight - aWeight;
  return a.lane.localeCompare(b.lane);
}

export function buildMembershipLaneMap(
  sponsorLanePolicies: OperatorMembershipLanePolicy[]
): Record<SponsorLane, OperatorMembershipLanePolicy | null> {
  return {
    request: sponsorLanePolicies.find((entry) => entry.lane === 'request') || null,
    output: sponsorLanePolicies.find((entry) => entry.lane === 'output') || null,
    registry: sponsorLanePolicies.find((entry) => entry.lane === 'registry') || null,
    credits: sponsorLanePolicies.find((entry) => entry.lane === 'credits') || null
  };
}

export function computeOperatorMembershipDigest(record: OperatorMembershipRecordBody): Field {
  return hashStringToField(stableStringify(record));
}

export function signOperatorMembershipRecord(
  record: OperatorMembershipRecordBody,
  privateKeyInput: string | PrivateKey
): SignedOperatorMembershipRecord {
  const privateKey = typeof privateKeyInput === 'string' ? PrivateKey.fromBase58(privateKeyInput) : privateKeyInput;
  const digest = computeOperatorMembershipDigest(record);
  return {
    ...record,
    policyDigest: digest.toJSON(),
    policyPublicKey: privateKey.toPublicKey().toBase58(),
    policySignature: Signature.create(privateKey, [digest]).toJSON()
  };
}

export function verifyOperatorMembershipRecord(
  record: SignedOperatorMembershipRecord,
  expectedPublicKey?: string | null
) {
  try {
    const normalized = normalizeOperatorMembershipRecordBody(record, record.operatorId);
    const digest = computeOperatorMembershipDigest(normalized);
    const digestJson = digest.toJSON();
    if (record.policyDigest !== digestJson) {
      return {
        ok: false,
        digest: digestJson,
        error: 'Membership digest mismatch.'
      };
    }
    const policyPublicKey = PublicKey.fromBase58(expectedPublicKey?.trim() || record.policyPublicKey);
    if (expectedPublicKey?.trim() && expectedPublicKey.trim() !== record.policyPublicKey) {
      return {
        ok: false,
        digest: digestJson,
        error: 'Membership record is signed by an unexpected policy key.'
      };
    }
    const signature = Signature.fromJSON(record.policySignature);
    const verified = signature.verify(policyPublicKey, [digest]).toBoolean();
    return {
      ok: verified,
      digest: digestJson,
      error: verified ? null : 'Membership signature verification failed.'
    };
  } catch (error) {
    return {
      ok: false,
      digest: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function normalizeSignedOperatorMembershipRecord(
  value: unknown,
  fallbackId = 'operator-1'
): SignedOperatorMembershipRecord {
  const body = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const normalized = normalizeOperatorMembershipRecordBody(body, fallbackId);
  return {
    ...normalized,
    policyDigest: typeof body.policyDigest === 'string' && body.policyDigest.trim().length > 0 ? body.policyDigest.trim() : '',
    policyPublicKey:
      typeof body.policyPublicKey === 'string' && body.policyPublicKey.trim().length > 0 ? body.policyPublicKey.trim() : '',
    policySignature:
      typeof body.policySignature === 'object' && body.policySignature !== null
        ? (body.policySignature as SignatureJson)
        : ({ field: '', scalar: '' } as SignatureJson)
  };
}

export function normalizeOperatorMembershipFile(value: unknown): OperatorMembershipFile | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.operators)) return null;
  const operators = body.operators
    .map((entry) => normalizeSignedOperatorMembershipRecord(entry))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId));
  const policyPublicKey =
    typeof body.policyPublicKey === 'string' && body.policyPublicKey.trim().length > 0
      ? body.policyPublicKey.trim()
      : operators[0]?.policyPublicKey || '';
  if (!policyPublicKey) return null;
  return {
    version: 1,
    generatedAt:
      typeof body.generatedAt === 'string' && body.generatedAt.trim().length > 0 ? body.generatedAt.trim() : new Date().toISOString(),
    policyPublicKey,
    operators
  };
}

export function verifyOperatorMembershipFile(file: OperatorMembershipFile | null) {
  if (!file) {
    return {
      present: false,
      policyPublicKey: null,
      operators: [] as VerifiedOperatorMembershipRecord[]
    };
  }
  return {
    present: true,
    policyPublicKey: file.policyPublicKey,
    operators: file.operators.map((record) => {
      const verification = verifyOperatorMembershipRecord(record, file.policyPublicKey);
      return {
        record,
        verified: verification.ok,
        verificationError: verification.error,
        laneMap: buildMembershipLaneMap(record.sponsorLanes)
      };
    })
  };
}
