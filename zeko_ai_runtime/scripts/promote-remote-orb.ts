import 'dotenv/config';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

interface BundleManifest {
  activationPath?: string;
  bundleDir: string;
  archive?: {
    path: string;
    checksumPath: string;
    sha256: string;
  } | null;
  routedLanes?: {
    remoteOperatorId?: string;
  } | null;
}

interface ActivationManifest {
  remoteOperatorId: string;
  remoteEndpoint: string;
  registryPath: string;
}

interface OperatorRegistryFile {
  operators: Array<{
    id: string;
    endpoint: string | null;
    metadata?: Record<string, unknown> | null;
    updatedAt?: string;
    lastSeenAt?: string | null;
  }>;
  lastUpdatedAt?: string | null;
}

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const exportRoot = path.join(repoRoot, 'data', 'opengradient', 'operators', 'export');
const machine = process.env.OPENGRADIENT_ORB_MACHINE?.trim() || 'opengradient-remote-1';
const remoteBaseDir = process.env.OPENGRADIENT_ORB_REMOTE_BASE_DIR?.trim() || 'opengradient-remote';
const remotePort = Number(process.env.OPENGRADIENT_ORB_REMOTE_PORT || 5181);
const coordinatorEndpoint =
  process.env.OPENGRADIENT_ORB_COORDINATOR_ENDPOINT?.trim() || 'http://host.docker.internal:5180';
const serviceName = process.env.OPENGRADIENT_ORB_SERVICE_NAME?.trim() || 'opengradient-remote-operator';
const machineDistro = process.env.OPENGRADIENT_ORB_MACHINE_DISTRO?.trim() || 'ubuntu';
const inboundApiKeys = process.env.OPENGRADIENT_HTTP_API_KEYS?.trim() || null;
const inboundBearerTokens = process.env.OPENGRADIENT_HTTP_BEARER_TOKENS?.trim() || null;
const outboundApiKey = process.env.OPENGRADIENT_OUTBOUND_API_KEY?.trim() || null;
const outboundBearerToken = process.env.OPENGRADIENT_OUTBOUND_BEARER_TOKEN?.trim() || null;

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function writeJson(filePath: string, payload: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function resolveManifestPath() {
  const explicitPath = process.env.OPENGRADIENT_ORB_BUNDLE_MANIFEST_PATH?.trim();
  if (explicitPath) return explicitPath;

  const explicitOperatorId =
    process.env.OPENGRADIENT_ORB_REMOTE_OPERATOR_ID?.trim() || process.env.OPENGRADIENT_REMOTE_OPERATOR_ID?.trim();
  if (explicitOperatorId) {
    return path.join(exportRoot, explicitOperatorId, 'bundle-manifest.json');
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(exportRoot);
  } catch {
    return path.join(exportRoot, 'remote-operator-testnet-1', 'bundle-manifest.json');
  }

  const candidates = entries.map((entry) => path.join(exportRoot, entry, 'bundle-manifest.json'));
  const ranked = await Promise.all(
    candidates.map(async (candidatePath) => {
      try {
        const manifest = await readJson<BundleManifest & { generatedAt?: string }>(candidatePath);
        const stats = await fs.stat(candidatePath);
        return {
          candidatePath,
          generatedAtMs: Date.parse(manifest.generatedAt || '') || 0,
          mtimeMs: stats.mtimeMs
        };
      } catch {
        return null;
      }
    })
  );

  const available = ranked.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  if (available.length === 0) {
    return path.join(exportRoot, 'remote-operator-testnet-1', 'bundle-manifest.json');
  }
  available.sort((a, b) => {
    if (a.generatedAtMs !== b.generatedAtMs) {
      return b.generatedAtMs - a.generatedAtMs;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  return available[0]!.candidatePath;
}

async function run(cmd: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

async function pushToMachine(source: string, destination?: string) {
  const args = ['push', '-m', machine, source];
  if (destination) args.push(destination);
  await run('orb', args);
}

async function runOnMachine(script: string) {
  return await run('orb', ['run', '-m', machine, 'sh', '-lc', script]);
}

async function resolveMachineIp() {
  const { stdout } = await run('orb', ['info', machine]);
  const ipv4 = stdout.match(/^IPv4:\s+(.+)$/m)?.[1]?.trim() || null;
  if (!ipv4) {
    throw new Error(`Unable to resolve IPv4 address for OrbStack machine ${machine}.`);
  }
  return ipv4;
}

async function ensureMachineExists() {
  try {
    await run('orbctl', ['info', machine]);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (!raw.includes('machine not found')) {
      throw error;
    }
    await run('orbctl', ['create', machineDistro, machine]);
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function updateLocalPromotionState(manifest: BundleManifest, remoteEndpoint: string) {
  if (!manifest.activationPath) {
    return {
      activationPath: null,
      registryPath: null
    };
  }

  const activation = await readJson<ActivationManifest>(manifest.activationPath);
  const nextActivation: ActivationManifest = {
    ...activation,
    remoteEndpoint
  };
  await writeJson(manifest.activationPath, nextActivation);

  const registry = await readJson<OperatorRegistryFile>(activation.registryPath);
  const updatedAt = nowIso();
  const nextRegistry: OperatorRegistryFile = {
    ...registry,
    operators: registry.operators.map((entry) => {
      if (entry.id !== activation.remoteOperatorId) return entry;
      return {
        ...entry,
        endpoint: remoteEndpoint,
        metadata: {
          ...(entry.metadata || {}),
          syncedFromEndpoint: remoteEndpoint,
          syncedAt: updatedAt
        },
        updatedAt,
        lastSeenAt: updatedAt
      };
    }),
    lastUpdatedAt: updatedAt
  };
  await writeJson(activation.registryPath, nextRegistry);

  const membershipPath = path.join(repoRoot, 'data', 'opengradient', 'operator-membership.json');
  const membershipExists = await fs
    .access(membershipPath)
    .then(() => true)
    .catch(() => false);
  let membershipResult: { path: string } | null = null;
  if (membershipExists) {
    await execFileAsync(process.execPath, [path.join(repoRoot, 'dist', 'scripts', 'issue-operator-membership.js')], {
      cwd: repoRoot,
      maxBuffer: 16 * 1024 * 1024
    });
    membershipResult = { path: membershipPath };
  }

  return {
    activationPath: manifest.activationPath,
    registryPath: activation.registryPath,
    membershipPath: membershipResult?.path || null
  };
}

async function main() {
  await ensureMachineExists();
  const manifestPath = await resolveManifestPath();
  const manifest = await readJson<BundleManifest>(manifestPath);
  if (!manifest.archive?.path || !manifest.archive.checksumPath) {
    throw new Error(`Bundle manifest at ${manifestPath} does not include an archive payload.`);
  }

  const archivePath = manifest.archive.path;
  const checksumPath = manifest.archive.checksumPath;
  const bundleName = path.basename(manifest.bundleDir);
  const remoteInstallDir = `$HOME/${remoteBaseDir}/${bundleName}`;
  const archiveName = path.basename(archivePath);
  const checksumName = path.basename(checksumPath);
  const remoteOperatorId =
    manifest.routedLanes?.remoteOperatorId?.trim() || bundleName.replace(/^export\//, '');
  const machineIp = await resolveMachineIp();
  const remoteEndpoint =
    process.env.OPENGRADIENT_ORB_REMOTE_ENDPOINT?.trim() || `http://${machineIp}:${remotePort}`;

  await pushToMachine(archivePath);
  await pushToMachine(checksumPath);

  const remoteScript = `
set -eu
ARCHIVE="$HOME/${archiveName}"
CHECKSUM="$HOME/${checksumName}"
BASE_DIR="$HOME/${remoteBaseDir}"
INSTALL_DIR="${remoteInstallDir}"
SERVICE_NAME="${serviceName}"
mkdir -p "$BASE_DIR"
if ! command -v node >/dev/null 2>&1; then
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs ca-certificates
fi
cd "$HOME"
sha256sum -c "$CHECKSUM"
rm -rf "$INSTALL_DIR"
tar -xzf "$ARCHIVE" -C "$BASE_DIR"
cat > "$INSTALL_DIR/runtime.local.env" <<'EOF'
HOST=0.0.0.0
OPENGRADIENT_PORT=${remotePort}
OPENGRADIENT_OPERATOR_ENDPOINT=${remoteEndpoint}
OPENGRADIENT_COORDINATOR_ENDPOINT=${coordinatorEndpoint}
${inboundApiKeys ? `OPENGRADIENT_HTTP_API_KEYS=${inboundApiKeys}` : '# OPENGRADIENT_HTTP_API_KEYS='}
${inboundBearerTokens ? `OPENGRADIENT_HTTP_BEARER_TOKENS=${inboundBearerTokens}` : '# OPENGRADIENT_HTTP_BEARER_TOKENS='}
${outboundApiKey ? `OPENGRADIENT_OUTBOUND_API_KEY=${outboundApiKey}` : '# OPENGRADIENT_OUTBOUND_API_KEY='}
${outboundBearerToken ? `OPENGRADIENT_OUTBOUND_BEARER_TOKEN=${outboundBearerToken}` : '# OPENGRADIENT_OUTBOUND_BEARER_TOKEN='}
EOF
sed "s|__BUNDLE_ROOT__|$INSTALL_DIR|g" "$INSTALL_DIR/remote-operator.service" | sudo tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME.service" >/dev/null
sudo systemctl restart "$SERVICE_NAME.service"
sleep 3
systemctl is-active "$SERVICE_NAME.service"
curl -fsS "http://127.0.0.1:${remotePort}/health"
`;

  const remoteResult = await runOnMachine(remoteScript);
  const localState = await updateLocalPromotionState(manifest, remoteEndpoint);

  console.log(
    JSON.stringify(
      {
        ok: true,
        machine,
        machineIp,
        remoteOperatorId,
        remoteEndpoint,
        coordinatorEndpoint,
        serviceName: `${serviceName}.service`,
        archivePath,
        checksumPath,
        remoteInstallDir,
        activationPath: localState.activationPath,
        registryPath: localState.registryPath,
        membershipPath: localState.membershipPath,
        remoteStdout: remoteResult.stdout,
        remoteStderr: remoteResult.stderr
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:promote:orb] failed', error);
  process.exit(1);
});
