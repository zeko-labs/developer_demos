import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

type BuilderAuthMode = 'api-key' | 'bearer';
type BuilderScope =
  | 'auth:read'
  | 'operators:read'
  | 'models:read'
  | 'agents:read'
  | 'agents:write'
  | 'inferences:read'
  | 'inferences:write'
  | 'credits:read'
  | 'credits:write';

interface BuilderRateLimitPolicy {
  windowMs: number;
  maxRequests: number;
  maxWriteRequests: number | null;
}

interface BuilderDailyQuotaPolicy {
  inferenceCreates: number | null;
  agentCreates: number | null;
  creditsSpendCount: number | null;
  creditsSpendMina: number | null;
}

interface BuilderAuthRecord {
  id: string;
  label: string;
  status: 'active' | 'paused';
  authMode: BuilderAuthMode;
  secretHash: string;
  scopes: BuilderScope[];
  rateLimit: BuilderRateLimitPolicy | null;
  dailyQuota: BuilderDailyQuotaPolicy | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface BuilderAuthFile {
  version: 1;
  updatedAt: string | null;
  builders: BuilderAuthRecord[];
}

const repoRoot = process.cwd();
const authDir = path.join(repoRoot, 'data', 'opengradient', 'http-auth');
const buildersDir = path.join(authDir, 'builders');
const builderAuthPath = process.env.OPENGRADIENT_BUILDER_AUTH_PATH?.trim() || path.join(authDir, 'builders.json');
const validScopes: BuilderScope[] = [
  'auth:read',
  'operators:read',
  'models:read',
  'agents:read',
  'agents:write',
  'inferences:read',
  'inferences:write',
  'credits:read',
  'credits:write'
];

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeMode(value: string | undefined): BuilderAuthMode {
  return value?.trim().toLowerCase() === 'bearer' ? 'bearer' : 'api-key';
}

function parseNullableLimit(value: string | undefined) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseScopes(value: string | undefined) {
  if (!value?.trim()) {
    return validScopes;
  }
  const requested = Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is BuilderScope => validScopes.includes(entry as BuilderScope))
    )
  );
  return requested.length ? requested : validScopes;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function writeJson(filePath: string, value: unknown) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const id = (process.env.OPENGRADIENT_BUILDER_ID?.trim() || `builder-${crypto.randomUUID().slice(0, 8)}`).replace(/\s+/g, '-');
  const label = process.env.OPENGRADIENT_BUILDER_LABEL?.trim() || id;
  const authMode = normalizeMode(process.env.OPENGRADIENT_BUILDER_AUTH_MODE);
  const secret =
    process.env.OPENGRADIENT_BUILDER_SECRET?.trim() ||
    (authMode === 'bearer' ? crypto.randomBytes(32).toString('base64url') : crypto.randomBytes(24).toString('hex'));
  const scopes = parseScopes(process.env.OPENGRADIENT_BUILDER_SCOPES);
  const now = nowIso();

  const maxRequests = parseNullableLimit(process.env.OPENGRADIENT_BUILDER_RATE_LIMIT_MAX_REQUESTS);
  const maxWriteRequests = parseNullableLimit(process.env.OPENGRADIENT_BUILDER_RATE_LIMIT_MAX_WRITE_REQUESTS);
  const rateLimit =
    maxRequests !== null
      ? {
          windowMs: Math.max(1000, Number(process.env.OPENGRADIENT_BUILDER_RATE_LIMIT_WINDOW_MS || 60_000)),
          maxRequests: Math.max(1, maxRequests),
          maxWriteRequests: maxWriteRequests !== null ? Math.max(1, maxWriteRequests) : null
        }
      : null;

  const dailyQuota = {
    inferenceCreates: parseNullableLimit(process.env.OPENGRADIENT_BUILDER_DAILY_INFERENCE_CREATES),
    agentCreates: parseNullableLimit(process.env.OPENGRADIENT_BUILDER_DAILY_AGENT_CREATES),
    creditsSpendCount: parseNullableLimit(process.env.OPENGRADIENT_BUILDER_DAILY_CREDITS_SPEND_COUNT),
    creditsSpendMina: parseNullableLimit(process.env.OPENGRADIENT_BUILDER_DAILY_CREDITS_SPEND_MINA)
  };
  const hasDailyQuota = Object.values(dailyQuota).some((entry) => entry !== null);

  const authFile = await readJson<BuilderAuthFile>(builderAuthPath, {
    version: 1,
    updatedAt: null,
    builders: []
  });
  const existing = authFile.builders.find((entry) => entry.id === id) || null;
  const record: BuilderAuthRecord = {
    id,
    label,
    status: process.env.OPENGRADIENT_BUILDER_STATUS?.trim().toLowerCase() === 'paused' ? 'paused' : 'active',
    authMode,
    secretHash: sha256Hex(secret),
    scopes,
    rateLimit,
    dailyQuota: hasDailyQuota ? dailyQuota : null,
    metadata: existing?.metadata || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  authFile.builders = [record, ...authFile.builders.filter((entry) => entry.id !== id)];
  authFile.updatedAt = now;
  await writeJson(builderAuthPath, authFile);

  const envFilePath = path.join(buildersDir, `${id}.local.env`);
  const envLines = [
    `OPENGRADIENT_BUILDER_ID=${id}`,
    authMode === 'bearer'
      ? `OPENGRADIENT_COORDINATOR_BEARER_TOKEN=${secret}`
      : `OPENGRADIENT_COORDINATOR_API_KEY=${secret}`
  ];
  if (process.env.OPENGRADIENT_COORDINATOR_URL?.trim()) {
    envLines.unshift(`OPENGRADIENT_COORDINATOR_URL=${process.env.OPENGRADIENT_COORDINATOR_URL.trim()}`);
  }
  await writeText(envFilePath, `${envLines.join('\n')}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        builderId: id,
        label,
        authMode,
        builderAuthPath,
        envFilePath,
        scopes,
        rateLimit,
        dailyQuota: hasDailyQuota ? dailyQuota : null,
        note:
          'Source the generated env file for SDK/example usage. The stored builders.json file keeps only the hashed secret, not the raw credential.'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[auth:issue:builder] failed', error);
  process.exit(1);
});
