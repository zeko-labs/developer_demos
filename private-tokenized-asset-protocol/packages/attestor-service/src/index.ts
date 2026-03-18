import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import os from 'node:os';
import type { ProofEnvelope } from '@tap/shared-types';

const execFileAsync = promisify(execFile);

function moonBinCandidates(): string[] {
  const fromEnv = process.env.MOON_BIN;
  const fromHome = path.join(os.homedir(), '.proto', 'shims', 'moon');
  return [fromEnv, fromHome, 'moon'].filter((value): value is string => Boolean(value));
}

function withMoonShimPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const shimDir = path.join(os.homedir(), '.proto', 'shims');
  const preferredMoonBin = moonBinCandidates().find((candidate) => candidate !== 'moon');
  const currentPath = env.PATH || process.env.PATH || '';
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  if (!pathParts.includes(shimDir)) {
    pathParts.unshift(shimDir);
  }
  return {
    ...env,
    ...(preferredMoonBin ? { MOON_BIN: preferredMoonBin } : {}),
    PATH: pathParts.join(path.delimiter)
  };
}

async function execMoon(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ stdout: string; stderr: string }> {
  const resolvedEnv = withMoonShimPath(env);
  let lastError: unknown = null;

  for (const moonBin of moonBinCandidates()) {
    try {
      return await execFileAsync(moonBin, args, {
        cwd,
        env: resolvedEnv,
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('failed to execute moon command');
}

export interface ZkTlsArtifacts {
  runId: string;
  outputDir: string;
  attestation?: unknown;
  disclosedFields?: unknown;
  proof?: unknown;
  verificationKey?: unknown;
  settlement?: unknown;
}

export interface ZkTlsToTapOptions {
  subjectCommitment: string;
  proofIdPrefix?: string;
  tenantId?: string;
  policyId?: number;
  policyVersion?: number;
  policyHash?: string;
  jurisdiction?: string;
  sourceProfile?: 'employment' | 'bank';
}

export interface ZkTlsTaskResult {
  stdout: string;
  stderr: string;
}

export interface ZkTlsPipelineOptions {
  mode?: 'eligible' | 'ineligible';
  profile?: 'employment' | 'bank';
}

function externalRepoPath(): string {
  return (
    process.env.ZKTLS_REPO_PATH ||
    path.join(process.cwd(), 'external', 'zk-verify-poc')
  );
}

async function readJsonOptional(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function listRunDirs(outputDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
      .sort();
  } catch {
    return [];
  }
}

function assertSafeRunId(runId: string): string {
  if (runId === 'latest') return runId;
  if (/^\d{4}-\d{2}-\d{2}T[\w\-:.]+$/.test(runId)) return runId;
  throw new Error(`invalid runId: ${runId}`);
}

export async function getZkTlsArtifacts(runId?: string): Promise<ZkTlsArtifacts> {
  const repo = externalRepoPath();
  const outputRoot = path.join(repo, 'output');

  let resolvedRunId = runId ? assertSafeRunId(runId) : 'latest';
  let runPath = path.join(outputRoot, 'latest');

  if (resolvedRunId === 'latest') {
    const runDirs = await listRunDirs(outputRoot);
    if (runDirs.length > 0) {
      resolvedRunId = runDirs[runDirs.length - 1]!;
      runPath = path.join(outputRoot, resolvedRunId);
    }
  } else {
    runPath = path.join(outputRoot, resolvedRunId);
  }

  try {
    await fs.access(runPath);
  } catch {
    throw new Error(`zktls run output not found for runId=${resolvedRunId} at ${runPath}`);
  }

  return {
    runId: resolvedRunId,
    outputDir: runPath,
    attestation: await readJsonOptional(path.join(runPath, 'attestation.json')),
    disclosedFields: await readJsonOptional(path.join(runPath, 'disclosed-fields.json')),
    proof: await readJsonOptional(path.join(runPath, 'proof.json')),
    verificationKey: await readJsonOptional(path.join(runPath, 'verification-key.json')),
    settlement: await readJsonOptional(path.join(runPath, 'settlement.json'))
  };
}

export async function latestZkTlsArtifacts(): Promise<ZkTlsArtifacts> {
  return getZkTlsArtifacts();
}

export async function runZkTlsPipeline(
  modeOrOptions: 'eligible' | 'ineligible' | ZkTlsPipelineOptions = 'eligible'
): Promise<{ stdout: string; stderr: string; artifacts: ZkTlsArtifacts }> {
  const repo = externalRepoPath();
  const options =
    typeof modeOrOptions === 'string' ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode === 'ineligible' ? 'ineligible' : 'eligible';
  const profile = options.profile === 'bank' ? 'bank' : 'employment';
  let stdout = '';
  let stderr = '';
  const env = {
    ...process.env,
    ...(profile === 'bank'
      ? {
          POC_SOURCE_PROFILE: 'bank',
          RUN_POC_TLSN_ENDPOINT_OVERRIDE:
            process.env.RUN_POC_TLSN_ENDPOINT_OVERRIDE ||
            '/api/v1/accounts/balance?account_id=BANK-001',
          TLSN_INELIGIBLE_ENDPOINT:
            process.env.TLSN_INELIGIBLE_ENDPOINT ||
            '/api/v1/accounts/balance?account_id=BANK-002',
          RUN_POC_INELIGIBLE_FAILURE_PATTERN:
            process.env.RUN_POC_INELIGIBLE_FAILURE_PATTERN ||
            '(balance .* below required minimum|account status hash mismatch)'
        }
      : {})
  };
  const childEnv = withMoonShimPath(env);

  try {
    const command = mode === 'ineligible' ? ['run', 'workspace:run-ineligible'] : ['run', 'workspace:run'];
    const result = await execMoon(command, repo, childEnv);
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    // Fallback for environments without moon on PATH: use repo shell runners directly.
    const script =
      profile === 'bank' && mode === 'eligible'
        ? './run-poc-bank.sh'
        : mode === 'ineligible'
          ? './run-poc-ineligible.sh'
          : './run-poc.sh';
    const result = await execFileAsync('bash', [script], {
      cwd: repo,
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024
    });
    stdout = result.stdout;
    stderr = result.stderr;
  }

  const artifacts = await latestZkTlsArtifacts();
  return { stdout, stderr, artifacts };
}

export async function runZkTlsTask(
  task: 'poc:settle' | 'poc:verify-chain',
  options?: { runId?: string }
): Promise<ZkTlsTaskResult> {
  const repo = externalRepoPath();
  const artifacts = await getZkTlsArtifacts(options?.runId);
  const env = {
    ...process.env,
    OUTPUT_DIR: artifacts.outputDir
  };
  const childEnv = withMoonShimPath(env);

  try {
    const result = await execMoon(['run', task], repo, childEnv);
    return { stdout: result.stdout, stderr: result.stderr };
  } catch {
    // No safe script fallback exists for isolated tasks.
    throw new Error(`failed to execute ${task}; ensure 'moon' is installed and available on PATH`);
  }
}

export async function assertZkTlsRepoReady(): Promise<{ repoPath: string; exists: boolean; hasMoon: boolean }> {
  const repoPath = externalRepoPath();

  let exists = false;
  let hasMoon = false;

  try {
    const stat = await fs.stat(repoPath);
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }

  if (exists) {
    try {
      await fs.access(path.join(repoPath, 'moon.yml'));
      hasMoon = true;
    } catch {
      hasMoon = false;
    }
  }

  return { repoPath, exists, hasMoon };
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizePublicInput(input: Record<string, string | number | boolean>) {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, string | number | boolean>>((acc, key) => {
      acc[key] = input[key]!;
      return acc;
    }, {});
}

function extractEligibilityFromProof(proof: unknown): boolean | null {
  const maybe = proof as { proof?: { publicOutput?: unknown[] } };
  const output = maybe?.proof?.publicOutput;
  if (!Array.isArray(output) || output.length < 1) return null;
  const raw = String(output[0] ?? '');
  // Common encodings: "1"/"0", "true"/"false"
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  return null;
}

function extractResponseBodyHash(proof: unknown): string | null {
  const maybe = proof as { proof?: { publicOutput?: unknown[] } };
  const output = maybe?.proof?.publicOutput;
  if (!Array.isArray(output) || output.length < 2) return null;
  return String(output[1] ?? '');
}

export function mapZkTlsArtifactsToTapProof(
  artifacts: ZkTlsArtifacts,
  options: ZkTlsToTapOptions
): ProofEnvelope | null {
  if (!artifacts.proof) return null;

  const now = new Date().toISOString();
  const evaluationDate = Number(now.slice(0, 10).replaceAll('-', ''));
  const externalProofHash = sha256(JSON.stringify(artifacts.proof));

  const disclosed = (artifacts.disclosedFields || {}) as Record<string, unknown>;
  const eligible = extractEligibilityFromProof(artifacts.proof);
  const responseBodyHash = extractResponseBodyHash(artifacts.proof);
  const sourceProfile =
    options.sourceProfile === 'bank' || disclosed.source_profile === 'bank' ? 'bank' : 'employment';
  const currentBalanceCents = Number(disclosed.current_balance_cents ?? disclosed.salary ?? 0);
  const availableBalanceCents = Number(
    disclosed.available_balance_cents ?? disclosed.current_balance_cents ?? disclosed.salary ?? 0
  );
  const statementAsOfUnix = Number(disclosed.statement_as_of_unix ?? disclosed.hire_date_unix ?? 0);
  const accountStatusHash = String(disclosed.account_status_hash ?? disclosed.status_hash ?? '');

  const idPrefix = options.proofIdPrefix || 'zktls';
  const publicInput = normalizePublicInput({
    subjectCommitment: options.subjectCommitment,
    runId: artifacts.runId,
    sourceProfile,
    evaluationDate,
    result: eligible ?? false,
    responseBodyHash: responseBodyHash || '',
    salary: Number(disclosed.salary ?? 0),
    hireDateUnix: Number(disclosed.hire_date_unix ?? 0),
    statusHash: String(disclosed.status_hash ?? ''),
    ...(sourceProfile === 'bank'
      ? {
          currentBalanceCents,
          availableBalanceCents,
          statementAsOfUnix,
          accountStatusHash
        }
      : {}),
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    ...(options.policyId !== undefined ? { policyId: options.policyId } : {}),
    ...(options.policyVersion !== undefined ? { policyVersion: options.policyVersion } : {}),
    ...(options.policyHash ? { policyHash: options.policyHash } : {}),
    ...(options.jurisdiction ? { jurisdiction: options.jurisdiction } : {})
  });
  const proofHash = sha256(`eligibility_v1_zktls:zk:${JSON.stringify(publicInput)}`);

  return {
    id: `${idPrefix}_${artifacts.runId}_${Date.now()}`,
    circuitId: 'eligibility_v1_zktls',
    mode: 'zk',
    publicInput,
    proof: {
      kind: 'zktls-external-proof',
      source: 'zk-verify-poc',
      runId: artifacts.runId,
      sourceProfile,
      externalProofHash,
      payload: artifacts.proof
    },
    proofHash,
    verifiedLocal: false,
    createdAt: now
  };
}
