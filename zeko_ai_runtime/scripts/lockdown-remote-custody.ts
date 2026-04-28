import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';

interface ActivationManifest {
  version: 1;
  activatedAt: string;
  remoteOperatorId: string;
  localOperatorId: string;
  remoteEndpoint: string;
  remoteActiveLanes: string[];
  localRetainedLanes: string[];
  runtimeEnvPath: string;
  launchScriptPath: string;
  localIsolationEnvPath?: string;
  localIsolationLaunchPath?: string;
  registryPath: string;
}

interface BundleManifest {
  bundleDir: string;
  archive?: {
    path: string;
    checksumPath: string;
    sha256: string;
  } | null;
}

interface OperatorRegistryRecord {
  id: string;
  endpoint: string | null;
  metadata: Record<string, unknown> | null;
}

interface OperatorRegistryFile {
  operators: OperatorRegistryRecord[];
  lastUpdatedAt: string | null;
}

interface QuarantineMoveRecord {
  sourcePath: string;
  quarantinePath: string;
  kind: 'file' | 'directory';
  moved: boolean;
}

const repoRoot = process.cwd();
const operatorsDir = path.join(repoRoot, 'data', 'opengradient', 'operators');
const quarantineRoot = path.join(operatorsDir, 'quarantine');
const coordinatorEndpoint = process.env.OPENGRADIENT_REMOTE_LOCKDOWN_COORDINATOR_ENDPOINT?.trim() || null;

function nowIso() {
  return new Date().toISOString();
}

function timestampSlug() {
  return nowIso().replace(/[:.]/g, '-');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function resolveActivationPath() {
  const explicitPath = process.env.OPENGRADIENT_REMOTE_ACTIVATION_PATH?.trim();
  if (explicitPath) return explicitPath;

  const explicitOperatorId = process.env.OPENGRADIENT_REMOTE_OPERATOR_ID?.trim();
  if (explicitOperatorId) {
    return path.join(operatorsDir, `${explicitOperatorId}.activation.json`);
  }

  const entries = await fs.readdir(operatorsDir);
  const activationCandidates = entries
    .filter((entry) => entry.endsWith('.activation.json'))
    .map((entry) => path.join(operatorsDir, entry));

  if (activationCandidates.length === 0) {
    return path.join(operatorsDir, 'remote-operator-testnet-1.activation.json');
  }

  const ranked = await Promise.all(
    activationCandidates.map(async (candidatePath) => {
      const manifest = await readJson<ActivationManifest>(candidatePath);
      const stats = await fs.stat(candidatePath);
      return {
        candidatePath,
        activatedAtMs: Date.parse(manifest.activatedAt || '') || 0,
        mtimeMs: stats.mtimeMs
      };
    })
  );

  ranked.sort((a, b) => {
    if (a.activatedAtMs !== b.activatedAtMs) {
      return b.activatedAtMs - a.activatedAtMs;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  return ranked[0]?.candidatePath || path.join(operatorsDir, 'remote-operator-testnet-1.activation.json');
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function pathExists(target: string) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function chmodRecursive(target: string) {
  const stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    await fs.chmod(target, 0o700);
    const entries = await fs.readdir(target);
    for (const entry of entries) {
      await chmodRecursive(path.join(target, entry));
    }
    return;
  }
  await fs.chmod(target, 0o600);
}

async function verifyRemoteHealth(remoteEndpoint: string) {
  const url = `${remoteEndpoint.replace(/\/+$/, '')}/health`;
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Remote operator health check failed (${response.status}): ${body}`);
  }
  return await response.json();
}

async function verifyCoordinatorRecord(remoteOperatorId: string) {
  if (!coordinatorEndpoint) return null;
  const url = `${coordinatorEndpoint.replace(/\/+$/, '')}/api/operators/${remoteOperatorId}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: buildCoordinatorAuthHeaders(),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Coordinator remote operator check failed (${response.status}): ${body}`);
  }
  return await response.json();
}

function buildCoordinatorAuthHeaders() {
  const headers = {} as Record<string, string>;
  const apiKey =
    process.env.OPENGRADIENT_REMOTE_LOCKDOWN_COORDINATOR_API_KEY?.trim() ||
    process.env.OPENGRADIENT_OUTBOUND_API_KEY?.trim() ||
    process.env.OPENGRADIENT_HTTP_API_KEYS?.split(',')[0]?.trim() ||
    '';
  const bearerToken =
    process.env.OPENGRADIENT_REMOTE_LOCKDOWN_COORDINATOR_BEARER_TOKEN?.trim() ||
    process.env.OPENGRADIENT_OUTBOUND_BEARER_TOKEN?.trim() ||
    process.env.OPENGRADIENT_HTTP_BEARER_TOKENS?.split(',')[0]?.trim() ||
    '';
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

function uniquePaths(paths: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    if (!entry) continue;
    const normalized = path.resolve(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function moveToQuarantine(sourcePath: string, root: string): Promise<QuarantineMoveRecord> {
  const stat = await fs.lstat(sourcePath);
  const relativePath = path.relative(repoRoot, sourcePath);
  const quarantinePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(quarantinePath), { recursive: true });
  await fs.rename(sourcePath, quarantinePath);
  await chmodRecursive(quarantinePath);
  return {
    sourcePath,
    quarantinePath,
    kind: stat.isDirectory() ? 'directory' : 'file',
    moved: true
  };
}

async function main() {
  const activationPath = await resolveActivationPath();
  const activation = await readJson<ActivationManifest>(activationPath);
  const bundleManifestPath = path.join(
    operatorsDir,
    'export',
    activation.remoteOperatorId,
    'bundle-manifest.json'
  );
  const bundleManifest = (await pathExists(bundleManifestPath))
    ? await readJson<BundleManifest>(bundleManifestPath)
    : null;

  const registry = await readJson<OperatorRegistryFile>(activation.registryPath);
  const remoteRecord = registry.operators.find((entry) => entry.id === activation.remoteOperatorId) || null;
  const remoteEndpoint =
    process.env.OPENGRADIENT_REMOTE_LOCKDOWN_REMOTE_ENDPOINT?.trim() ||
    remoteRecord?.endpoint?.trim() ||
    activation.remoteEndpoint;

  const remoteHealth = await verifyRemoteHealth(remoteEndpoint);
  const coordinatorRecord = await verifyCoordinatorRecord(activation.remoteOperatorId);

  const quarantineDir = path.join(quarantineRoot, `${timestampSlug()}-${activation.remoteOperatorId}`);
  await fs.mkdir(quarantineDir, { recursive: true });
  await fs.chmod(quarantineDir, 0o700);

  const candidatePaths = uniquePaths([
    path.join(operatorsDir, `${activation.remoteOperatorId}.bootstrap.json`),
    activation.runtimeEnvPath,
    activation.launchScriptPath,
    bundleManifest?.bundleDir || null,
    bundleManifest?.archive?.path || null,
    bundleManifest?.archive?.checksumPath || null
  ]);

  const moved: QuarantineMoveRecord[] = [];
  const skipped: string[] = [];
  for (const candidate of candidatePaths) {
    if (!(await pathExists(candidate))) {
      skipped.push(candidate);
      continue;
    }
    moved.push(await moveToQuarantine(candidate, quarantineDir));
  }

  const quarantineManifestPath = path.join(quarantineDir, 'lockdown-manifest.json');
  const quarantineManifest = {
    version: 1,
    lockedDownAt: nowIso(),
    remoteOperatorId: activation.remoteOperatorId,
    localOperatorId: activation.localOperatorId,
    remoteEndpoint,
    quarantineDir,
    moved,
    skipped,
    remoteHealthSummary: {
      ok: Boolean((remoteHealth as any)?.ok),
      endpoint: remoteEndpoint,
      operatorId: (remoteHealth as any)?.operatorRegistry?.localOperatorId || null
    },
    coordinatorRecord:
      coordinatorRecord && typeof coordinatorRecord === 'object'
        ? {
            id: (coordinatorRecord as any).id || null,
            endpoint: (coordinatorRecord as any).endpoint || null,
            status: (coordinatorRecord as any).status || null
          }
        : null
  };
  await writeJson(quarantineManifestPath, quarantineManifest);
  await fs.chmod(quarantineManifestPath, 0o600);

  registry.operators = registry.operators.map((entry) => {
    if (entry.id !== activation.remoteOperatorId) return entry;
    return {
      ...entry,
      metadata: {
        ...(entry.metadata || {}),
        localCustody: {
          status: 'quarantined',
          quarantinedAt: quarantineManifest.lockedDownAt,
          quarantineDir,
          quarantineManifestPath
        }
      }
    };
  });
  registry.lastUpdatedAt = nowIso();
  await writeJson(activation.registryPath, registry);

  console.log(
    JSON.stringify(
      {
        ok: true,
        remoteOperatorId: activation.remoteOperatorId,
        remoteEndpoint,
        quarantineDir,
        quarantineManifestPath,
        moved,
        skipped,
        note:
          'The remote operator remains live. Local macOS custody of the packaged remote bootstrap and export artifacts has been quarantined.'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:lockdown:remote] failed', error);
  process.exit(1);
});
