import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

type SponsorLane = 'request' | 'output' | 'registry' | 'credits';

interface ActivationManifest {
  version: 1;
  activatedAt: string;
  remoteOperatorId: string;
  localOperatorId: string;
  remoteEndpoint: string;
  remoteActiveLanes: SponsorLane[];
  localRetainedLanes: SponsorLane[];
  localReleasedLanes: Array<{
    lane: SponsorLane;
    backupPath: string | null;
    released: boolean;
  }>;
  runtimeEnvPath: string;
  launchScriptPath: string;
  registryPath: string;
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
    status: 'active' | 'paused' | 'draining';
  };
  lanes: Array<{
    lane: SponsorLane;
    privateKey: string;
    publicKey: string;
  }>;
  generatedAt: string;
  updatedAt: string;
}

interface OperatorRegistryFile {
  operators: Array<{
    id: string;
    endpoint: string | null;
    sponsorLanes: Array<{
      lane: SponsorLane;
      configured: boolean;
      publicKey: string | null;
    }>;
  }>;
  lastUpdatedAt: string | null;
}

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const operatorsDir = path.join(repoRoot, 'data', 'opengradient', 'operators');
const packageRoot = path.join(operatorsDir, 'export');
const bundleCoordinatorEndpoint =
  process.env.OPENGRADIENT_BUNDLE_COORDINATOR_ENDPOINT?.trim() || 'http://REPLACE_WITH_PRIMARY_OPERATOR:5180';
const bundleRemoteEndpoint =
  process.env.OPENGRADIENT_BUNDLE_REMOTE_ENDPOINT?.trim() || 'http://REPLACE_WITH_REMOTE_HOST:5181';
const bundleRemotePort = Number(process.env.OPENGRADIENT_BUNDLE_REMOTE_PORT || 5181);
const includeNodeModules = isEnabled(process.env.OPENGRADIENT_BUNDLE_INCLUDE_NODE_MODULES, true);
const createTarball = isEnabled(process.env.OPENGRADIENT_BUNDLE_CREATE_TARBALL, true);
const seedFiles = [
  'models.json',
  'agents.json',
  'coordination-trees.json',
  'credits-checkpoint-batches.json',
  'credits-deposit-monitors.json',
  'credits-intents.json',
  'credits-ledger.json',
  'credits-nullifiers.json',
  'credits-operator-queue.json',
  'attester-keys.json',
  'operator-registry.json'
] as const;

function isEnabled(value: string | undefined, fallback: boolean) {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
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

async function maybeCopyFile(from: string, to: string) {
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return true;
  } catch {
    return false;
  }
}

async function maybeCopyTree(from: string, to: string) {
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

function getBootstrapLane(bootstrap: RemoteOperatorBootstrapFile, lane: SponsorLane) {
  const entry = bootstrap.lanes.find((item) => item.lane === lane);
  if (!entry) {
    throw new Error(`Missing ${lane} lane in remote bootstrap.`);
  }
  return entry;
}

async function resolveZkappPublicKeyV2() {
  const envPublicKey = process.env.ZKAPP_V2_PUBLIC_KEY?.trim();
  if (envPublicKey) return envPublicKey;
  const latestPath = path.join(repoRoot, 'data', 'deployments', 'agent-request-v2.latest.json');
  const latest = await readJson<{ zkappPublicKey?: string }>(latestPath);
  if (!latest.zkappPublicKey?.trim()) {
    throw new Error('Missing zkapp public key for portable remote bundle.');
  }
  return latest.zkappPublicKey.trim();
}

async function resolveNodeModulesSource() {
  const source = path.join(repoRoot, 'node_modules');
  return await fs.realpath(source);
}

async function computeSha256(filePath: string) {
  const payload = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function createBundleArchive(bundleDir: string, bundleName: string) {
  const archivePath = path.join(packageRoot, `${bundleName}.tgz`);
  await fs.rm(archivePath, { force: true });
  await execFileAsync('tar', ['-czf', archivePath, '-C', packageRoot, bundleName]);
  const checksum = await computeSha256(archivePath);
  const checksumPath = `${archivePath}.sha256`;
  await writeText(checksumPath, `${checksum}  ${path.basename(archivePath)}\n`);
  return { archivePath, checksumPath, checksum };
}

function buildRuntimeLocalExample(activation: ActivationManifest) {
  const authLines = [];
  if (process.env.OPENGRADIENT_HTTP_API_KEYS?.trim()) {
    authLines.push(`OPENGRADIENT_HTTP_API_KEYS=${process.env.OPENGRADIENT_HTTP_API_KEYS.trim()}`);
  } else {
    authLines.push(`# OPENGRADIENT_HTTP_API_KEYS=shared-api-key`);
  }
  if (process.env.OPENGRADIENT_OUTBOUND_API_KEY?.trim()) {
    authLines.push(`OPENGRADIENT_OUTBOUND_API_KEY=${process.env.OPENGRADIENT_OUTBOUND_API_KEY.trim()}`);
  } else {
    authLines.push(`# OPENGRADIENT_OUTBOUND_API_KEY=shared-api-key`);
  }
  if (process.env.OPENGRADIENT_HTTP_BEARER_TOKENS?.trim()) {
    authLines.push(`OPENGRADIENT_HTTP_BEARER_TOKENS=${process.env.OPENGRADIENT_HTTP_BEARER_TOKENS.trim()}`);
  } else {
    authLines.push(`# OPENGRADIENT_HTTP_BEARER_TOKENS=shared-bearer-token`);
  }
  if (process.env.OPENGRADIENT_OUTBOUND_BEARER_TOKEN?.trim()) {
    authLines.push(`OPENGRADIENT_OUTBOUND_BEARER_TOKEN=${process.env.OPENGRADIENT_OUTBOUND_BEARER_TOKEN.trim()}`);
  } else {
    authLines.push(`# OPENGRADIENT_OUTBOUND_BEARER_TOKEN=shared-bearer-token`);
  }
  return [
    '# Copy this file to runtime.local.env on the remote host and edit the values below.',
    `# The launch script automatically loads runtime.env first and runtime.local.env second.`,
    `HOST=0.0.0.0`,
    `OPENGRADIENT_PORT=${bundleRemotePort}`,
    `OPENGRADIENT_OPERATOR_ENDPOINT=${bundleRemoteEndpoint}`,
    `OPENGRADIENT_COORDINATOR_ENDPOINT=${bundleCoordinatorEndpoint}`,
    `OPENGRADIENT_COORDINATOR_SYNC_MS=${process.env.OPENGRADIENT_COORDINATOR_SYNC_MS?.trim() || '30000'}`,
    '# Optional auth: keep inbound and outbound values aligned if you protect /api/*.',
    ...authLines,
    `# Optional: set to a reachable public URL if this host sits behind a reverse proxy.`,
    `# Optional: leave request/output disabled for this remote registry+credits lane split.`,
    `# Remote lanes: ${activation.remoteActiveLanes.join(', ')}`,
    `# Local lanes: ${activation.localRetainedLanes.join(', ')}`
  ].join('\n');
}

function buildLaunchScript() {
  return `#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"
set -a
. "$ROOT/runtime.env"
if [ -f "$ROOT/runtime.local.env" ]; then
  . "$ROOT/runtime.local.env"
fi
set +a
case "\${OPENGRADIENT_DATA_DIR:-}" in
  ./*) OPENGRADIENT_DATA_DIR="$ROOT/\${OPENGRADIENT_DATA_DIR#./}" ;;
esac
export OPENGRADIENT_DATA_DIR
exec node dist/src/server.js
`;
}

function buildHealthcheckScript() {
  return `#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"
set -a
. "$ROOT/runtime.env"
if [ -f "$ROOT/runtime.local.env" ]; then
  . "$ROOT/runtime.local.env"
fi
set +a
PORT="\${OPENGRADIENT_PORT:-5181}"
curl -fsS "http://127.0.0.1:$PORT/health"
`;
}

function buildVerifyScript() {
  return `#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"
set -a
. "$ROOT/runtime.env"
if [ -f "$ROOT/runtime.local.env" ]; then
  . "$ROOT/runtime.local.env"
fi
set +a
LOCAL_PORT="\${OPENGRADIENT_PORT:-5181}"
REMOTE_HEALTH_URL="\${OPENGRADIENT_VERIFY_REMOTE_URL:-http://127.0.0.1:$LOCAL_PORT/health}"
curl -fsS "$REMOTE_HEALTH_URL"
if [ -n "\${OPENGRADIENT_COORDINATOR_ENDPOINT:-}" ]; then
  curl -fsS "\${OPENGRADIENT_COORDINATOR_ENDPOINT%/}/api/operators/\${OPENGRADIENT_OPERATOR_ID}"
fi
`;
}

function buildDockerRunScript(operatorId: string) {
  return `#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
IMAGE_TAG="\${OPENGRADIENT_DOCKER_IMAGE:-${operatorId}}"
CONTAINER_NAME="\${OPENGRADIENT_DOCKER_CONTAINER:-${operatorId}}"
HOST_PORT="\${OPENGRADIENT_DOCKER_PORT:-${bundleRemotePort}}"
docker build -t "$IMAGE_TAG" "$ROOT"
set -- --rm --name "$CONTAINER_NAME" -p "$HOST_PORT:5181" \\
  -v "$ROOT/data:/app/data" \\
  -v "$ROOT/runtime.env:/app/runtime.env:ro"
if [ -f "$ROOT/runtime.local.env" ]; then
  set -- "$@" -v "$ROOT/runtime.local.env:/app/runtime.local.env:ro"
fi
set -- "$@" "$IMAGE_TAG"
docker run "$@"
`;
}

function buildSystemdService(operatorId: string) {
  return `[Unit]
Description=Zeko AI Runtime remote operator ${operatorId}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=__BUNDLE_ROOT__
ExecStart=__BUNDLE_ROOT__/launch.sh
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
}

function buildDockerfile(includeBundledNodeModules: boolean) {
  if (includeBundledNodeModules) {
    return `FROM node:20-bullseye-slim
WORKDIR /app
COPY package.json ./package.json
COPY node_modules ./node_modules
COPY dist ./dist
COPY data ./data
COPY runtime.env ./runtime.env
COPY runtime.local.env.example ./runtime.local.env.example
COPY launch.sh ./launch.sh
COPY healthcheck.sh ./healthcheck.sh
COPY verify-coordinator-sync.sh ./verify-coordinator-sync.sh
RUN chmod +x ./launch.sh ./healthcheck.sh ./verify-coordinator-sync.sh
EXPOSE 5181
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD ["./healthcheck.sh"]
CMD ["./launch.sh"]
`;
  }
  return `FROM node:20-bullseye-slim
WORKDIR /app
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
RUN npm install --omit=dev
COPY dist ./dist
COPY data ./data
COPY runtime.env ./runtime.env
COPY runtime.local.env.example ./runtime.local.env.example
COPY launch.sh ./launch.sh
COPY healthcheck.sh ./healthcheck.sh
COPY verify-coordinator-sync.sh ./verify-coordinator-sync.sh
RUN chmod +x ./launch.sh ./healthcheck.sh ./verify-coordinator-sync.sh
EXPOSE 5181
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD ["./healthcheck.sh"]
CMD ["./launch.sh"]
`;
}

function buildBundleReadme(params: {
  activation: ActivationManifest;
  bootstrap: RemoteOperatorBootstrapFile;
  seededFiles: string[];
  includeBundledNodeModules: boolean;
  archivePath: string | null;
  checksumPath: string | null;
}) {
  const { activation, bootstrap, seededFiles, includeBundledNodeModules, archivePath, checksumPath } = params;
  return `# Remote Operator Bundle

This bundle packages the remote ${activation.remoteOperatorId} runtime for off-box deployment.

## What Is Included

- compiled runtime under \`dist/\`
- seeded lane-owned state under \`data/opengradient/\`
- ${includeBundledNodeModules ? 'vendored runtime dependencies under `node_modules/`' : 'package metadata for an online `npm install --omit=dev`'}
- layered env files: \`runtime.env\` and \`runtime.local.env.example\`
- launch and verification helpers:
  - \`launch.sh\`
  - \`healthcheck.sh\`
  - \`verify-coordinator-sync.sh\`
  - \`docker-run.sh\`
  - \`remote-operator.service\`

## Before Launch

1. Copy this whole directory to the target host, or unpack the archive below.
2. Copy \`runtime.local.env.example\` to \`runtime.local.env\`.
3. Set:
   - \`OPENGRADIENT_OPERATOR_ENDPOINT\` to the public URL of the new host
   - \`OPENGRADIENT_COORDINATOR_ENDPOINT\` to the primary operator URL that should receive registry syncs
4. Start the bundle:
   - bare metal: \`./launch.sh\`
   - Docker: \`./docker-run.sh\`
5. Verify:
   - \`./healthcheck.sh\`
   - \`./verify-coordinator-sync.sh\`

## Lane Ownership

- Remote lanes: ${activation.remoteActiveLanes.join(', ')}
- Local lanes: ${activation.localRetainedLanes.join(', ')}
- Operator label: ${bootstrap.operator.label}
- Network: ${bootstrap.network.networkId}

## Seeded State

${seededFiles.map((entry) => `- ${entry}`).join('\n')}

## Archive

- Archive: ${archivePath ? path.basename(archivePath) : 'not generated'}
- SHA256: ${checksumPath ? path.basename(checksumPath) : 'not generated'}

## Hard Isolation Note

This bundle is enough to run the remote operator on another host without changing the code path again.
For strict custody isolation after handoff, remove or lock down any local copies of the remote bootstrap and exported secrets on the original machine once the remote host is confirmed healthy.
`;
}

async function main() {
  const activationPath = await resolveActivationPath();
  const activation = await readJson<ActivationManifest>(activationPath);
  const bootstrapPath = path.join(operatorsDir, `${activation.remoteOperatorId}.bootstrap.json`);
  const bootstrap = await readJson<RemoteOperatorBootstrapFile>(bootstrapPath);
  const registry = await readJson<OperatorRegistryFile>(activation.registryPath);
  const zkappPublicKey = await resolveZkappPublicKeyV2();

  const bundleDir = path.join(packageRoot, activation.remoteOperatorId);
  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });

  await maybeCopyFile(path.join(repoRoot, 'package.json'), path.join(bundleDir, 'package.json'));
  await maybeCopyFile(path.join(repoRoot, 'package-lock.json'), path.join(bundleDir, 'package-lock.json'));
  await fs.cp(path.join(repoRoot, 'dist'), path.join(bundleDir, 'dist'), { recursive: true });

  let nodeModulesIncluded = false;
  if (includeNodeModules) {
    const nodeModulesSource = await resolveNodeModulesSource();
    nodeModulesIncluded = await maybeCopyTree(nodeModulesSource, path.join(bundleDir, 'node_modules'));
  }

  const dataRoot = path.join(bundleDir, 'data');
  const seededFiles: string[] = [];
  for (const fileName of seedFiles) {
    const source = path.join(repoRoot, 'data', 'opengradient', fileName);
    const target = path.join(dataRoot, 'opengradient', fileName);
    if (await maybeCopyFile(source, target)) {
      seededFiles.push(`data/opengradient/${fileName}`);
    }
  }
  await writeText(path.join(dataRoot, 'opengradient', 'local-operator-id.txt'), `${activation.remoteOperatorId}\n`);
  seededFiles.push('data/opengradient/local-operator-id.txt');

  const runtimeEnvPath = path.join(bundleDir, 'runtime.env');
  const runtimeEnv = [
    'HOST=0.0.0.0',
    `OPENGRADIENT_PORT=${bundleRemotePort}`,
    'OPENGRADIENT_DATA_DIR=./data/opengradient',
    `OPENGRADIENT_OPERATOR_ID=${activation.remoteOperatorId}`,
    `OPENGRADIENT_OPERATOR_LABEL=${bootstrap.operator.label}`,
    `OPENGRADIENT_OPERATOR_ENDPOINT=${bundleRemoteEndpoint}`,
    `OPENGRADIENT_COORDINATOR_ENDPOINT=${bundleCoordinatorEndpoint}`,
    `OPENGRADIENT_DISABLED_SPONSOR_LANES=${(['request', 'output', 'registry', 'credits'] as SponsorLane[])
      .filter((lane) => !activation.remoteActiveLanes.includes(lane))
      .join(',')}`,
    `ZEKO_NETWORK_ID=${bootstrap.network.networkId}`,
    `ZEKO_GRAPHQL=${bootstrap.network.graphql}`,
    `ZEKO_EXPLORER=${bootstrap.network.explorer || ''}`,
    `ZKAPP_V2_PUBLIC_KEY=${zkappPublicKey}`,
    `OPENGRADIENT_COORDINATOR_SYNC_MS=${process.env.OPENGRADIENT_COORDINATOR_SYNC_MS?.trim() || '30000'}`
  ];
  activation.remoteActiveLanes.forEach((lane) => {
    const entry = getBootstrapLane(bootstrap, lane);
    runtimeEnv.push(`OPENGRADIENT_${lane.toUpperCase()}_SPONSOR_PRIVATE_KEY=${entry.privateKey}`);
  });
  await writeText(runtimeEnvPath, `${runtimeEnv.join('\n')}\n`);

  const runtimeLocalExamplePath = path.join(bundleDir, 'runtime.local.env.example');
  await writeText(runtimeLocalExamplePath, `${buildRuntimeLocalExample(activation)}\n`);

  const launchScriptPath = path.join(bundleDir, 'launch.sh');
  await writeText(launchScriptPath, buildLaunchScript());
  await fs.chmod(launchScriptPath, 0o700);

  const healthcheckScriptPath = path.join(bundleDir, 'healthcheck.sh');
  await writeText(healthcheckScriptPath, buildHealthcheckScript());
  await fs.chmod(healthcheckScriptPath, 0o700);

  const verifyScriptPath = path.join(bundleDir, 'verify-coordinator-sync.sh');
  await writeText(verifyScriptPath, buildVerifyScript());
  await fs.chmod(verifyScriptPath, 0o700);

  const dockerRunScriptPath = path.join(bundleDir, 'docker-run.sh');
  await writeText(dockerRunScriptPath, buildDockerRunScript(activation.remoteOperatorId));
  await fs.chmod(dockerRunScriptPath, 0o700);

  const dockerfilePath = path.join(bundleDir, 'Dockerfile');
  await writeText(dockerfilePath, buildDockerfile(nodeModulesIncluded));

  const systemdServicePath = path.join(bundleDir, 'remote-operator.service');
  await writeText(systemdServicePath, buildSystemdService(activation.remoteOperatorId));

  const routingManifestPath = path.join(bundleDir, 'lane-routing.json');
  const localOperator = registry.operators.find((entry) => entry.id === activation.localOperatorId) || null;
  const routingManifest = {
    remoteOperatorId: activation.remoteOperatorId,
    remoteEndpoint: bundleRemoteEndpoint,
    remoteLanes: activation.remoteActiveLanes,
    localOperatorId: activation.localOperatorId,
    localEndpoint: localOperator?.endpoint || 'http://REPLACE_WITH_LOCAL_OPERATOR',
    localLanes: activation.localRetainedLanes
  };
  await writeText(routingManifestPath, `${JSON.stringify(routingManifest, null, 2)}\n`);

  let archivePath: string | null = null;
  let checksumPath: string | null = null;
  let checksum: string | null = null;
  if (createTarball) {
    const archive = await createBundleArchive(bundleDir, activation.remoteOperatorId);
    archivePath = archive.archivePath;
    checksumPath = archive.checksumPath;
    checksum = archive.checksum;
  }

  const readmePath = path.join(bundleDir, 'README.md');
  await writeText(
    readmePath,
    `${buildBundleReadme({
      activation,
      bootstrap,
      seededFiles,
      includeBundledNodeModules: nodeModulesIncluded,
      archivePath,
      checksumPath
    })}\n`
  );

  const bundleManifestPath = path.join(bundleDir, 'bundle-manifest.json');
  const bundleManifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    activationPath,
    bootstrapPath,
    bundleDir,
    runtimeEnvPath: 'runtime.env',
    runtimeLocalExamplePath: 'runtime.local.env.example',
    launchScriptPath: 'launch.sh',
    healthcheckScriptPath: 'healthcheck.sh',
    verifyScriptPath: 'verify-coordinator-sync.sh',
    dockerRunScriptPath: 'docker-run.sh',
    dockerfilePath: 'Dockerfile',
    systemdServicePath: 'remote-operator.service',
    routedLanes: routingManifest,
    seededFiles,
    zkappPublicKey,
    nodeModulesIncluded,
    archive: archivePath
      ? {
          path: archivePath,
          checksumPath,
          sha256: checksum
        }
      : null
  };
  await writeText(bundleManifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        bundleDir,
        runtimeEnvPath,
        runtimeLocalExamplePath,
        launchScriptPath,
        healthcheckScriptPath,
        verifyScriptPath,
        dockerRunScriptPath,
        dockerfilePath,
        systemdServicePath,
        routingManifestPath,
        bundleManifestPath,
        archivePath,
        checksumPath,
        nodeModulesIncluded,
        notes: [
          'This bundle is portable and only requires the zkApp public key for runtime settlement.',
          nodeModulesIncluded
            ? 'Runtime dependencies were vendored into the bundle, so bare-metal launch does not require npm install.'
            : 'Runtime dependencies were not vendored; the target host must run npm install --omit=dev before launch.',
          'The remote operator will sync itself back to the coordinator endpoint if OPENGRADIENT_COORDINATOR_ENDPOINT is set.',
          'Before launching off-box, copy runtime.local.env.example to runtime.local.env and replace the placeholder endpoint values.'
        ]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:package-remote] failed', error);
  process.exit(1);
});
