import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PrivateKey } from 'o1js';
import {
  compareMembershipLanePolicy,
  normalizeOperatorMembershipFile,
  normalizeOperatorMembershipRecordBody,
  signOperatorMembershipRecord,
  type OperatorMembershipFile,
  type OperatorMembershipLanePolicy,
  type OperatorMembershipRecordBody,
  type OperatorRegistryStatus
} from '../src/operator-membership.js';
import type { SponsorLane } from '../src/sponsor-lanes.js';

interface OperatorLaneAssignment {
  lane: SponsorLane;
  configured: boolean;
  publicKey: string | null;
  source: string;
  usesSharedFallback: boolean;
}

interface OperatorRegistryRecord {
  id: string;
  label: string;
  endpoint: string | null;
  status: OperatorRegistryStatus;
  local: boolean;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: OperatorLaneAssignment[];
  metadata: Record<string, unknown> | null;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

interface OperatorRegistryFile {
  operators: OperatorRegistryRecord[];
  lastUpdatedAt: string | null;
}

interface LaneOrderingEntry {
  operatorId: string;
  role: 'primary' | 'backup' | 'standby';
  priority: number;
  orderSource: 'env-override' | 'existing-membership' | 'registry-snapshot';
}

const laneOrder = ['request', 'output', 'registry', 'credits'] as SponsorLane[];
const dataDir = path.join(process.cwd(), 'data', 'opengradient');
const operatorRegistryPath =
  process.env.OPENGRADIENT_OPERATOR_REGISTRY_PATH?.trim() || path.join(dataDir, 'operator-registry.json');
const operatorMembershipPath =
  process.env.OPENGRADIENT_OPERATOR_MEMBERSHIP_PATH?.trim() || path.join(dataDir, 'operator-membership.json');
const operatorPolicyKeyPath =
  process.env.OPENGRADIENT_OPERATOR_POLICY_KEY_PATH?.trim() || path.join(dataDir, 'operator-policy-private-key.txt');
const operatorPolicyPublicKeyPath =
  process.env.OPENGRADIENT_OPERATOR_POLICY_PUBLIC_KEY_PATH?.trim() || path.join(dataDir, 'operator-policy-public-key.txt');

function nowIso() {
  return new Date().toISOString();
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeSecret(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${value.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function readSecret(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function resolvePolicyPrivateKey() {
  const envKey = process.env.OPENGRADIENT_OPERATOR_POLICY_PRIVATE_KEY?.trim();
  if (envKey) {
    return PrivateKey.fromBase58(envKey);
  }
  const stored = await readSecret(operatorPolicyKeyPath);
  if (stored) {
    return PrivateKey.fromBase58(stored);
  }
  const generated = PrivateKey.random();
  await writeSecret(operatorPolicyKeyPath, generated.toBase58());
  return generated;
}

function compareOperators(a: OperatorRegistryRecord, b: OperatorRegistryRecord) {
  if (a.local !== b.local) return a.local ? -1 : 1;
  const aSeen = Date.parse(a.lastSeenAt || a.updatedAt || '1970-01-01T00:00:00.000Z');
  const bSeen = Date.parse(b.lastSeenAt || b.updatedAt || '1970-01-01T00:00:00.000Z');
  return bSeen - aSeen;
}

function dedupeOperatorIds(operatorIds: string[]) {
  const seen = new Set<string>();
  return operatorIds.filter((operatorId) => {
    if (seen.has(operatorId)) return false;
    seen.add(operatorId);
    return true;
  });
}

function getLanePolicyOrderEnvVar(lane: SponsorLane) {
  return `OPENGRADIENT_OPERATOR_POLICY_${lane.toUpperCase()}_ORDER`;
}

function rankRole(index: number): 'primary' | 'backup' | 'standby' {
  if (index <= 0) return 'primary';
  if (index === 1) return 'backup';
  return 'standby';
}

function rankPriority(index: number) {
  return Math.max(10, 100 - index * 10);
}

function parseLaneOrderOverride(lane: SponsorLane, supportedOperatorIds: Set<string>) {
  const envVar = getLanePolicyOrderEnvVar(lane);
  const raw = process.env[envVar]?.trim();
  if (!raw) {
    return {
      envVar,
      orderedIds: [] as string[],
      ignoredIds: [] as string[]
    };
  }
  const orderedIds: string[] = [];
  const ignoredIds: string[] = [];
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((operatorId) => {
      if (supportedOperatorIds.has(operatorId)) {
        orderedIds.push(operatorId);
      } else {
        ignoredIds.push(operatorId);
      }
    });
  return {
    envVar,
    orderedIds: dedupeOperatorIds(orderedIds),
    ignoredIds: dedupeOperatorIds(ignoredIds)
  };
}

function buildExistingLaneOrderMap(existingMembership: OperatorMembershipFile | null) {
  const laneMap = new Map<SponsorLane, string[]>();
  laneOrder.forEach((lane) => {
    const ranked = (existingMembership?.operators || [])
      .map((record) => ({
        operatorId: record.operatorId,
        policy: record.sponsorLanes.find((entry) => entry.lane === lane && entry.enabled) || null
      }))
      .filter((entry): entry is { operatorId: string; policy: OperatorMembershipLanePolicy } => Boolean(entry.policy))
      .sort((a, b) => compareMembershipLanePolicy(a.policy, b.policy))
      .map((entry) => entry.operatorId);
    laneMap.set(lane, dedupeOperatorIds(ranked));
  });
  return laneMap;
}

function buildLanePolicyMap(registry: OperatorRegistryFile, existingMembership: OperatorMembershipFile | null) {
  const laneMap = new Map<SponsorLane, LaneOrderingEntry[]>();
  const warnings: string[] = [];
  const existingLaneOrder = buildExistingLaneOrderMap(existingMembership);
  laneOrder.forEach((lane) => {
    const supportedOperators = registry.operators
      .filter((operator) => operator.sponsorLanes.some((entry) => entry.lane === lane && entry.configured))
      .sort(compareOperators);
    const supportedIds = supportedOperators.map((operator) => operator.id);
    const supportedIdSet = new Set(supportedIds);
    const override = parseLaneOrderOverride(lane, supportedIdSet);
    if (override.ignoredIds.length > 0) {
      warnings.push(
        `${override.envVar} ignored unsupported operators for ${lane}: ${override.ignoredIds.join(', ')}.`
      );
    }
    const finalOrder = dedupeOperatorIds([
      ...override.orderedIds,
      ...(existingLaneOrder.get(lane) || []).filter((operatorId) => supportedIdSet.has(operatorId)),
      ...supportedIds
    ]);
    const overrideIds = new Set(override.orderedIds);
    const existingIds = new Set((existingLaneOrder.get(lane) || []).filter((operatorId) => supportedIdSet.has(operatorId)));
    const participants = finalOrder.map(
      (operatorId, index): LaneOrderingEntry => ({
        operatorId,
        role: rankRole(index),
        priority: rankPriority(index),
        orderSource: overrideIds.has(operatorId)
          ? 'env-override'
          : existingIds.has(operatorId)
            ? 'existing-membership'
            : 'registry-snapshot'
      })
    );
    laneMap.set(lane, participants);
  });
  return {
    laneMap,
    warnings
  };
}

function buildMembershipLanePolicies(
  operator: OperatorRegistryRecord,
  laneMap: Map<SponsorLane, LaneOrderingEntry[]>
): OperatorMembershipLanePolicy[] {
  return operator.sponsorLanes
    .filter((lane) => lane.configured)
    .map((lane) => {
      const laneOrdering = laneMap.get(lane.lane) || [];
      const policy = laneOrdering.find((entry) => entry.operatorId === operator.id);
      const notes = [operator.local ? 'Local coordinator member.' : 'Remote operator member.'];
      if (policy?.orderSource === 'env-override') {
        notes.push(`Lane order set by ${getLanePolicyOrderEnvVar(lane.lane)}.`);
      } else if (policy?.orderSource === 'existing-membership') {
        notes.push('Lane order preserved from the previous signed membership policy.');
      } else {
        notes.push('Lane order derived from the current operator-registry snapshot.');
      }
      return {
        lane: lane.lane,
        enabled: true,
        publicKey: lane.publicKey,
        priority: policy?.priority ?? 100,
        role: policy?.role ?? 'primary',
        notes
      } satisfies OperatorMembershipLanePolicy;
    });
}

function buildMembershipRecordBody(
  operator: OperatorRegistryRecord,
  laneMap: Map<SponsorLane, LaneOrderingEntry[]>
): OperatorMembershipRecordBody {
  const issuedAt = nowIso();
  return normalizeOperatorMembershipRecordBody({
    operatorId: operator.id,
    label: operator.label,
    endpoint: operator.endpoint,
    networkId: operator.networkId,
    contractVersions: operator.contractVersions,
    capabilities: operator.capabilities,
    sponsorLanes: buildMembershipLanePolicies(operator, laneMap),
    allowedStatuses: ['active', 'paused', 'draining'],
    metadata: {
      ...(operator.metadata || {}),
      issuedFrom: 'operator-registry',
      issuedAt
    },
    issuedAt,
    updatedAt: issuedAt
  });
}

async function main() {
  const registry = await readJson<OperatorRegistryFile>(operatorRegistryPath, {
    operators: [],
    lastUpdatedAt: null
  });
  if (!registry.operators.length) {
    throw new Error('Operator registry is empty. Bootstrap operators before issuing membership.');
  }

  const policyPrivateKey = await resolvePolicyPrivateKey();
  const policyPublicKey = policyPrivateKey.toPublicKey().toBase58();
  const existingMembership = normalizeOperatorMembershipFile(
    await readJson<OperatorMembershipFile | null>(operatorMembershipPath, null)
  );
  const { laneMap, warnings } = buildLanePolicyMap(registry, existingMembership);
  const operators = registry.operators
    .map((operator) => signOperatorMembershipRecord(buildMembershipRecordBody(operator, laneMap), policyPrivateKey))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId));

  const membership: OperatorMembershipFile = {
    version: 1,
    generatedAt: nowIso(),
    policyPublicKey,
    operators
  };

  await writeJson(operatorMembershipPath, membership);
  await writeSecret(operatorPolicyPublicKeyPath, policyPublicKey);

  console.log(
    JSON.stringify(
      {
        ok: true,
        policyPublicKey,
        operatorCount: operators.length,
        path: operatorMembershipPath,
        preservedPreviousPolicy: Boolean(existingMembership),
        warnings,
        operators: operators.map((operator) => ({
          operatorId: operator.operatorId,
          lanes: operator.sponsorLanes.map((lane) => ({
            lane: lane.lane,
            role: lane.role,
            priority: lane.priority,
            publicKey: lane.publicKey
          }))
        }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:policy:issue] failed', error);
  process.exit(1);
});
