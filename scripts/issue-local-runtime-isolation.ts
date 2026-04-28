import 'dotenv/config';

import path from 'node:path';
import { promises as fs } from 'node:fs';

import { parseSponsorLaneList, sponsorLaneOrder, writeLocalRuntimeIsolationFiles } from '../src/local-runtime-isolation.js';
import type { SponsorLane } from '../src/sponsor-lanes.js';

interface ActivationManifest {
  localOperatorId: string;
  localRetainedLanes?: SponsorLane[];
}

interface MembershipRecord {
  operatorId: string;
  sponsorLanes?: Array<{
    lane?: SponsorLane;
    enabled?: boolean;
    role?: 'primary' | 'backup' | 'standby';
  }>;
  metadata?: {
    retainedLanes?: SponsorLane[];
  } | null;
}

interface MembershipFile {
  operators?: MembershipRecord[];
}

interface RegistryFile {
  operators?: Array<{
    id: string;
    local?: boolean;
    metadata?: {
      retainedLanes?: SponsorLane[];
    } | null;
  }>;
}

const repoRoot = process.cwd();
const dataDir = path.join(repoRoot, 'data', 'opengradient');
const operatorsDir = path.join(dataDir, 'operators');
const localOperatorIdPath = path.join(dataDir, 'local-operator-id.txt');
const activationPath =
  process.env.OPENGRADIENT_REMOTE_ACTIVATION_PATH?.trim() ||
  path.join(operatorsDir, 'remote-operator-testnet-1.activation.json');
const membershipPath =
  process.env.OPENGRADIENT_OPERATOR_MEMBERSHIP_PATH?.trim() || path.join(dataDir, 'operator-membership.json');
const registryPath = process.env.OPENGRADIENT_OPERATOR_REGISTRY_PATH?.trim() || path.join(dataDir, 'operator-registry.json');
const coordinatorEnvPath = path.join(dataDir, 'http-auth', 'coordinator.local.env');

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readTextIfPresent(filePath: string) {
  try {
    const value = (await fs.readFile(filePath, 'utf8')).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function resolveLocalOperatorId() {
  const explicit = process.env.OPENGRADIENT_OPERATOR_ID?.trim();
  if (explicit) return explicit;
  const stored = await readTextIfPresent(localOperatorIdPath);
  if (stored) return stored;
  throw new Error(`Local operator id not found at ${localOperatorIdPath}`);
}

function uniqueLanes(lanes: SponsorLane[]) {
  return sponsorLaneOrder.filter((lane) => lanes.includes(lane));
}

async function resolveRetainedLanes(localOperatorId: string) {
  const envRetained = parseSponsorLaneList(process.env.OPENGRADIENT_LOCAL_ISOLATION_KEEP_LANES, []);
  if (envRetained.length > 0) {
    return { source: 'env' as const, retainedLanes: envRetained };
  }

  const activation = await readJsonIfPresent<ActivationManifest>(activationPath);
  if (activation?.localOperatorId === localOperatorId && Array.isArray(activation.localRetainedLanes)) {
    const retained = parseSponsorLaneList(activation.localRetainedLanes, []);
    if (retained.length > 0) {
      return { source: 'activation' as const, retainedLanes: retained };
    }
  }

  const registry = await readJsonIfPresent<RegistryFile>(registryPath);
  const registryRecord = registry?.operators?.find((entry) => entry.id === localOperatorId || entry.local === true) || null;
  const registryRetained = parseSponsorLaneList(registryRecord?.metadata?.retainedLanes, []);
  if (registryRetained.length > 0) {
    return { source: 'registry' as const, retainedLanes: registryRetained };
  }

  const membership = await readJsonIfPresent<MembershipFile>(membershipPath);
  const membershipRecord = membership?.operators?.find((entry) => entry.operatorId === localOperatorId) || null;
  const metadataRetained = parseSponsorLaneList(membershipRecord?.metadata?.retainedLanes, []);
  if (metadataRetained.length > 0) {
    return { source: 'membership-metadata' as const, retainedLanes: metadataRetained };
  }

  const sponsorLaneRetained = uniqueLanes(
    (membershipRecord?.sponsorLanes || [])
      .filter((entry) => entry.enabled === true && entry.role !== 'standby' && sponsorLaneOrder.includes(entry.lane as SponsorLane))
      .map((entry) => entry.lane as SponsorLane)
  );
  if (sponsorLaneRetained.length > 0) {
    return { source: 'membership-sponsor-lanes' as const, retainedLanes: sponsorLaneRetained };
  }

  return {
    source: 'fallback-default' as const,
    retainedLanes: ['request', 'output'] as SponsorLane[]
  };
}

async function main() {
  const localOperatorId = await resolveLocalOperatorId();
  const retained = await resolveRetainedLanes(localOperatorId);
  const artifacts = await writeLocalRuntimeIsolationFiles({
    repoRoot,
    operatorsDir,
    localOperatorId,
    retainedLanes: retained.retainedLanes,
    coordinatorEnvPath
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        localOperatorId,
        retainedLanes: artifacts.retainedLanes,
        disabledLanes: artifacts.disabledLanes,
        routeStrategy: artifacts.routeStrategy,
        source: retained.source,
        envPath: artifacts.envPath,
        launchPath: artifacts.launchPath,
        note:
          'Source the generated env snippet, or run the generated launch script, before restarting the local coordinator if you want hard lane exclusivity instead of shared fallback custody.'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:issue:local-isolation] failed', error);
  process.exit(1);
});
