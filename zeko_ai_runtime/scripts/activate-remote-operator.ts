import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PrivateKey } from 'o1js';
import { writeLocalRuntimeIsolationFiles } from '../src/local-runtime-isolation.js';
import { getSponsorLaneFilePath, type SponsorLane } from '../src/sponsor-lanes.js';

type OperatorRegistryStatus = 'active' | 'paused' | 'draining';

interface OperatorLaneAssignment {
  lane: SponsorLane;
  configured: boolean;
  publicKey: string | null;
  source: 'env-lane' | 'env-shared' | 'stored-lane' | 'stored-shared' | 'missing';
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

interface RemoteOperatorBootstrapLane {
  lane: SponsorLane;
  privateKey: string;
  publicKey: string;
}

interface RemoteOperatorBootstrapFile {
  version: 1;
  network: {
    networkId: string;
    graphql: string;
    explorer: string | null;
  };
  operator: {
    id: string;
    label: string;
    endpoint: string | null;
    status: OperatorRegistryStatus;
  };
  lanes: RemoteOperatorBootstrapLane[];
  generatedAt: string;
  updatedAt: string;
  funding: {
    txFee: string;
    targetMina: number;
    sourceSponsorPublicKey: string;
    sourceBalanceBeforeMina: number | null;
    sourceBalanceAfterMina: number | null;
    transfers: Array<{
      scope: 'local' | 'remote';
      lane: SponsorLane;
      publicKey: string;
      amountMina: number;
      hash: string | null;
    }>;
  };
}

interface ActivationManifest {
  version: 1;
  activatedAt: string;
  remoteOperatorId: string;
  localOperatorId: string;
  remoteEndpoint: string;
  coordinatorEndpoint: string | null;
  remoteActiveLanes: SponsorLane[];
  localRetainedLanes: SponsorLane[];
  localReleasedLanes: Array<{
    lane: SponsorLane;
    backupPath: string | null;
    released: boolean;
  }>;
  runtimeMode: 'active' | 'standby';
  runtimeDataDir: string;
  runtimeEnvPath: string;
  launchScriptPath: string;
  localIsolationEnvPath: string;
  localIsolationLaunchPath: string;
  registryPath: string;
}

const laneOrder = ['request', 'output', 'registry', 'credits'] as SponsorLane[];
const repoRoot = process.cwd();
const deploymentDir = path.join(repoRoot, 'data', 'deployments');
const archiveDir = path.join(deploymentDir, 'archive');
const dataDir = path.join(repoRoot, 'data', 'opengradient');
const operatorsDir = path.join(dataDir, 'operators');
const registryPath = path.join(dataDir, 'operator-registry.json');
const localOperatorIdPath = path.join(dataDir, 'local-operator-id.txt');
const coordinatorLocalEnvPath = path.join(dataDir, 'http-auth', 'coordinator.local.env');
const defaultBootstrapPath = path.join(operatorsDir, 'remote-operator-testnet-1.bootstrap.json');
const bootstrapPath = process.env.OPENGRADIENT_REMOTE_BOOTSTRAP_PATH?.trim() || defaultBootstrapPath;
const bindHost = process.env.OPENGRADIENT_REMOTE_BIND_HOST?.trim() || process.env.HOST?.trim() || '127.0.0.1';
const publicHost =
  process.env.OPENGRADIENT_REMOTE_PUBLIC_HOST?.trim() || (bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost);
const port = Number(process.env.OPENGRADIENT_REMOTE_PORT || 5181);
const endpoint = process.env.OPENGRADIENT_REMOTE_OPERATOR_ENDPOINT?.trim() || `http://${publicHost}:${port}`;
const remoteActiveLanes = parseLaneList(process.env.OPENGRADIENT_REMOTE_ACTIVE_LANES, ['registry', 'credits']);
const localReleaseLanes = parseLaneList(process.env.OPENGRADIENT_LOCAL_RELEASE_LANES, remoteActiveLanes);
const remoteRuntimeDataDir = process.env.OPENGRADIENT_REMOTE_DATA_DIR?.trim() || dataDir;
const remoteCoordinatorEndpoint =
  process.env.OPENGRADIENT_REMOTE_COORDINATOR_ENDPOINT?.trim() || process.env.OPENGRADIENT_COORDINATOR_ENDPOINT?.trim() || null;
const remoteCoordinatorSyncMs =
  process.env.OPENGRADIENT_REMOTE_COORDINATOR_SYNC_MS?.trim() || process.env.OPENGRADIENT_COORDINATOR_SYNC_MS?.trim() || null;
const remoteInboundApiKeys =
  process.env.OPENGRADIENT_REMOTE_HTTP_API_KEYS?.trim() || process.env.OPENGRADIENT_HTTP_API_KEYS?.trim() || null;
const remoteInboundBearerTokens =
  process.env.OPENGRADIENT_REMOTE_HTTP_BEARER_TOKENS?.trim() || process.env.OPENGRADIENT_HTTP_BEARER_TOKENS?.trim() || null;
const remoteOutboundApiKey =
  process.env.OPENGRADIENT_REMOTE_OUTBOUND_API_KEY?.trim() || process.env.OPENGRADIENT_OUTBOUND_API_KEY?.trim() || null;
const remoteOutboundBearerToken =
  process.env.OPENGRADIENT_REMOTE_OUTBOUND_BEARER_TOKEN?.trim() ||
  process.env.OPENGRADIENT_OUTBOUND_BEARER_TOKEN?.trim() ||
  null;
const remoteStandbyMode = isEnabled(process.env.OPENGRADIENT_REMOTE_STANDBY_MODE, false);

function parseLaneList(value: string | SponsorLane[] | undefined, fallback: SponsorLane[]) {
  const raw =
    Array.isArray(value) && value.length > 0
      ? value
      : typeof value === 'string'
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry): entry is SponsorLane => laneOrder.includes(entry as SponsorLane))
        : fallback;
  const unique = new Set<SponsorLane>();
  raw.forEach((entry) => unique.add(entry));
  return laneOrder.filter((entry) => unique.has(entry));
}

function nowIso() {
  return new Date().toISOString();
}

function isEnabled(value: string | undefined, fallback: boolean) {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

async function readTextFile(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function writeTextFile(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
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

function buildOperatorCapabilities(sponsorLanes: OperatorLaneAssignment[]) {
  const capabilities = new Set<string>();
  sponsorLanes.forEach((lane) => {
    if (!lane.configured) return;
    if (lane.lane === 'request') capabilities.add('request-settlement');
    if (lane.lane === 'output') capabilities.add('output-settlement');
    if (lane.lane === 'registry') capabilities.add('registry-settlement');
    if (lane.lane === 'credits') {
      capabilities.add('credits-direct-settlement');
      capabilities.add('credits-checkpoint-settlement');
      capabilities.add('credits-deposit-monitor');
    }
  });
  return Array.from(capabilities).sort((a, b) => a.localeCompare(b));
}

function resolveStatus(value: unknown, fallback: OperatorRegistryStatus = 'active'): OperatorRegistryStatus {
  return value === 'paused' || value === 'draining' || value === 'active' ? value : fallback;
}

async function resolveLocalOperatorId() {
  const explicit = process.env.OPENGRADIENT_OPERATOR_ID?.trim();
  if (explicit) return explicit;
  const stored = await readTextFile(localOperatorIdPath);
  if (stored) return stored;
  const generated = `credits-operator-${crypto.randomUUID().slice(0, 12)}`;
  await writeTextFile(localOperatorIdPath, `${generated}\n`);
  return generated;
}

async function readRegistry() {
  return await readJson<OperatorRegistryFile>(registryPath, {
    operators: [],
    lastUpdatedAt: null
  });
}

function upsertRegistryRecord(registry: OperatorRegistryFile, next: OperatorRegistryRecord) {
  registry.operators = [next, ...registry.operators.filter((entry) => entry.id !== next.id)];
  registry.lastUpdatedAt = nowIso();
}

async function loadBootstrap() {
  const bootstrap = await readJson<RemoteOperatorBootstrapFile | null>(bootstrapPath, null);
  if (!bootstrap) {
    throw new Error(`Remote bootstrap bundle not found at ${bootstrapPath}`);
  }
  return bootstrap;
}

function getBootstrapLane(bootstrap: RemoteOperatorBootstrapFile, lane: SponsorLane) {
  const entry = bootstrap.lanes.find((item) => item.lane === lane);
  if (!entry) {
    throw new Error(`Bootstrap bundle missing ${lane} lane.`);
  }
  return entry;
}

async function releaseLocalLaneKeys(lanesToRelease: SponsorLane[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results: Array<{ lane: SponsorLane; backupPath: string | null; released: boolean }> = [];
  await fs.mkdir(archiveDir, { recursive: true });
  for (const lane of lanesToRelease) {
    const activePath = getSponsorLaneFilePath(lane);
    const current = await readTextFile(activePath);
    if (!current) {
      results.push({ lane, backupPath: null, released: false });
      continue;
    }
    const backupPath = path.join(archiveDir, `${timestamp}-${lane}-sponsor-private-key.txt`);
    await fs.rename(activePath, backupPath);
    results.push({ lane, backupPath, released: true });
  }
  return results;
}

async function readLocalLaneAssignments() {
  const assignments: OperatorLaneAssignment[] = [];
  for (const lane of laneOrder) {
    const key = await readTextFile(getSponsorLaneFilePath(lane));
    assignments.push({
      lane,
      configured: Boolean(key),
      publicKey: key ? PrivateKey.fromBase58(key).toPublicKey().toBase58() : null,
      source: key ? 'stored-lane' : 'missing',
      usesSharedFallback: false
    });
  }
  return assignments.filter((entry) => entry.configured);
}

function buildRemoteAssignments(
  bootstrap: RemoteOperatorBootstrapFile,
  selectedLanes: SponsorLane[]
): OperatorLaneAssignment[] {
  return selectedLanes.map((lane) => {
    const entry = getBootstrapLane(bootstrap, lane);
    return {
      lane,
      configured: true,
      publicKey: entry.publicKey,
      source: 'env-lane',
      usesSharedFallback: false
    };
  });
}

async function writeRemoteRuntimeFiles(
  bootstrap: RemoteOperatorBootstrapFile,
  selectedLanes: SponsorLane[]
) {
  const envPath = path.join(operatorsDir, `${bootstrap.operator.id}.runtime.env`);
  const launchPath = path.join(operatorsDir, `${bootstrap.operator.id}.launch.sh`);
  await fs.mkdir(operatorsDir, { recursive: true });

  const envLines = [
    `HOST=${bindHost}`,
    `OPENGRADIENT_PORT=${port}`,
    `OPENGRADIENT_DATA_DIR=${remoteRuntimeDataDir}`,
    `OPENGRADIENT_OPERATOR_ID=${bootstrap.operator.id}`,
    `OPENGRADIENT_OPERATOR_LABEL=${bootstrap.operator.label}`,
    `OPENGRADIENT_OPERATOR_ENDPOINT=${endpoint}`,
    `OPENGRADIENT_DISABLED_SPONSOR_LANES=${laneOrder.filter((lane) => !selectedLanes.includes(lane)).join(',')}`,
    `ZEKO_NETWORK_ID=${bootstrap.network.networkId}`,
    `ZEKO_GRAPHQL=${bootstrap.network.graphql}`,
    `ZEKO_EXPLORER=${bootstrap.network.explorer || ''}`
  ];
  if (remoteCoordinatorEndpoint) {
    envLines.push(`OPENGRADIENT_COORDINATOR_ENDPOINT=${remoteCoordinatorEndpoint}`);
  }
  if (remoteCoordinatorSyncMs) {
    envLines.push(`OPENGRADIENT_COORDINATOR_SYNC_MS=${remoteCoordinatorSyncMs}`);
  }
  if (remoteInboundApiKeys) {
    envLines.push(`OPENGRADIENT_HTTP_API_KEYS=${remoteInboundApiKeys}`);
  }
  if (remoteInboundBearerTokens) {
    envLines.push(`OPENGRADIENT_HTTP_BEARER_TOKENS=${remoteInboundBearerTokens}`);
  }
  if (remoteOutboundApiKey) {
    envLines.push(`OPENGRADIENT_OUTBOUND_API_KEY=${remoteOutboundApiKey}`);
  }
  if (remoteOutboundBearerToken) {
    envLines.push(`OPENGRADIENT_OUTBOUND_BEARER_TOKEN=${remoteOutboundBearerToken}`);
  }
  if (remoteStandbyMode) {
    envLines.push('OPENGRADIENT_CREDITS_OPERATOR_AUTO_PROCESS_MS=0');
    envLines.push('OPENGRADIENT_CREDITS_DEPOSIT_MONITOR_MS=0');
  }
  selectedLanes.forEach((lane) => {
    const key = getBootstrapLane(bootstrap, lane);
    envLines.push(`OPENGRADIENT_${lane.toUpperCase()}_SPONSOR_PRIVATE_KEY=${key.privateKey}`);
  });
  await writeTextFile(envPath, `${envLines.join('\n')}\n`);

  const quotedEnv = envLines.map((line) => {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    return `export ${key}=${JSON.stringify(value)}`;
  });
  const scriptBody = `#!/bin/zsh
set -euo pipefail
cd ${JSON.stringify(repoRoot)}
${quotedEnv.join('\n')}
exec npm start
`;
  await writeTextFile(launchPath, scriptBody);
  await fs.chmod(launchPath, 0o700);

  return { envPath, launchPath };
}

async function updateRegistryForActivation(
  bootstrap: RemoteOperatorBootstrapFile,
  localOperatorId: string,
  localAssignments: OperatorLaneAssignment[],
  remoteAssignments: OperatorLaneAssignment[],
  runtimeEnvPath: string,
  launchScriptPath: string,
  releasedLanes: Array<{ lane: SponsorLane; backupPath: string | null; released: boolean }>
) {
  const registry = await readRegistry();
  const now = nowIso();
  const existingLocal = registry.operators.find((entry) => entry.id === localOperatorId) || null;
  const existingRemote = registry.operators.find((entry) => entry.id === bootstrap.operator.id) || null;

  const localRecord: OperatorRegistryRecord = {
    id: localOperatorId,
    label: existingLocal?.label || localOperatorId,
    endpoint: existingLocal?.endpoint || null,
    status: localAssignments.length > 0 ? 'active' : 'paused',
    local: true,
    networkId: bootstrap.network.networkId,
    contractVersions: ['v1', 'v2'],
    capabilities: buildOperatorCapabilities(localAssignments),
    sponsorLanes: localAssignments,
    metadata: {
      ...(existingLocal?.metadata || {}),
      retainedLanes: localAssignments.map((entry) => entry.lane),
      releasedLanes: releasedLanes.filter((entry) => entry.released).map((entry) => entry.lane)
    },
    registeredAt: existingLocal?.registeredAt || now,
    updatedAt: now,
    lastSeenAt: existingLocal?.lastSeenAt || now
  };

  const remoteRecord: OperatorRegistryRecord = {
    id: bootstrap.operator.id,
    label: bootstrap.operator.label,
    endpoint,
    status: 'active',
    local: false,
    networkId: bootstrap.network.networkId,
    contractVersions: ['v1', 'v2'],
    capabilities: buildOperatorCapabilities(remoteAssignments),
    sponsorLanes: remoteAssignments,
    metadata: {
      ...(existingRemote?.metadata || {}),
      bootstrapPath,
      runtimeEnvPath,
      launchScriptPath,
      activatedAt: now,
      assignedLanes: remoteAssignments.map((entry) => entry.lane),
      handoffRequired: true
    },
    registeredAt: existingRemote?.registeredAt || now,
    updatedAt: now,
    lastSeenAt: existingRemote?.lastSeenAt || null
  };

  upsertRegistryRecord(registry, remoteRecord);
  upsertRegistryRecord(registry, localRecord);
  await writeJson(registryPath, registry);

  return { localRecord, remoteRecord };
}

async function main() {
  const bootstrap = await loadBootstrap();
  const localOperatorId = await resolveLocalOperatorId();
  const releasedLanes = await releaseLocalLaneKeys(localReleaseLanes);
  const localAssignments = await readLocalLaneAssignments();
  const remoteAssignments = buildRemoteAssignments(bootstrap, remoteActiveLanes);
  const runtimeFiles = await writeRemoteRuntimeFiles(bootstrap, remoteActiveLanes);
  const localIsolation = await writeLocalRuntimeIsolationFiles({
    repoRoot,
    operatorsDir,
    localOperatorId,
    retainedLanes: localAssignments.map((entry) => entry.lane),
    coordinatorEnvPath: coordinatorLocalEnvPath
  });
  const records = await updateRegistryForActivation(
    bootstrap,
    localOperatorId,
    localAssignments,
    remoteAssignments,
    runtimeFiles.envPath,
    runtimeFiles.launchPath,
    releasedLanes
  );

  const manifestPath = path.join(operatorsDir, `${bootstrap.operator.id}.activation.json`);
  const manifest: ActivationManifest = {
    version: 1,
    activatedAt: nowIso(),
    remoteOperatorId: bootstrap.operator.id,
    localOperatorId,
    remoteEndpoint: endpoint,
    coordinatorEndpoint: remoteCoordinatorEndpoint,
    remoteActiveLanes,
    localRetainedLanes: localAssignments.map((entry) => entry.lane),
    localReleasedLanes: releasedLanes,
    runtimeMode: remoteStandbyMode ? 'standby' : 'active',
    runtimeDataDir: remoteRuntimeDataDir,
    runtimeEnvPath: runtimeFiles.envPath,
    launchScriptPath: runtimeFiles.launchPath,
    localIsolationEnvPath: localIsolation.envPath,
    localIsolationLaunchPath: localIsolation.launchPath,
    registryPath
  };
  await writeJson(manifestPath, manifest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        bootstrapPath,
        remoteOperatorId: records.remoteRecord.id,
        remoteEndpoint: endpoint,
        coordinatorEndpoint: remoteCoordinatorEndpoint,
        remoteActiveLanes,
        localOperatorId,
        localRetainedLanes: localAssignments.map((entry) => entry.lane),
        localReleasedLanes: releasedLanes,
        runtimeMode: remoteStandbyMode ? 'standby' : 'active',
        runtimeEnvPath: runtimeFiles.envPath,
        launchScriptPath: runtimeFiles.launchPath,
        localIsolationEnvPath: localIsolation.envPath,
        localIsolationLaunchPath: localIsolation.launchPath,
        runtimeDataDir: remoteRuntimeDataDir,
        activationManifestPath: manifestPath,
        notes: [
          'Default split activates the remote operator for registry and credits lanes.',
          'The local operator releases those lanes by moving its active lane keys into the archive folder.',
          'A local isolation env snippet is generated so the coordinator can explicitly disable remotely owned lanes even when a shared sponsor fallback still exists.',
          'Request and output stay local by default so the main live receipt path remains fast.',
          remoteCoordinatorEndpoint
            ? `The generated runtime includes coordinator sync back to ${remoteCoordinatorEndpoint}.`
            : 'Set OPENGRADIENT_REMOTE_COORDINATOR_ENDPOINT or OPENGRADIENT_COORDINATOR_ENDPOINT if this runtime should sync itself back to a primary coordinator.',
          remoteStandbyMode
            ? 'Standby mode disables credits queue and deposit-monitor background workers so this runtime can stay hot without competing for operator processing.'
            : 'Active mode keeps background processing enabled on this runtime.',
          remoteRuntimeDataDir === dataDir
            ? 'If you launch this operator on the same machine as the coordinator, set OPENGRADIENT_REMOTE_DATA_DIR to an isolated path so the standby does not mutate the coordinator-local runtime state.'
            : `This activation uses an isolated runtime data dir at ${remoteRuntimeDataDir}.`
        ]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:activate-remote] failed', error);
  process.exit(1);
});
