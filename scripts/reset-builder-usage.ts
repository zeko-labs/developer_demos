import 'dotenv/config';

import path from 'node:path';
import { promises as fs } from 'node:fs';

import dotenv from 'dotenv';

interface BuilderUsageDailyRecord {
  day: string;
  totalRequests: number;
  writeRequests: number;
  inferenceCreates: number;
  agentCreates: number;
  creditsSpendCount: number;
  creditsSpendMina: number;
}

interface BuilderUsageRecord {
  lastSeenAt: string | null;
  lastRequestAt: string | null;
  lastRequestPath: string | null;
  rateLimitWindow: {
    startedAt: string | null;
    totalRequests: number;
    writeRequests: number;
  };
  daily: BuilderUsageDailyRecord;
}

interface BuilderUsageFile {
  version: 1;
  updatedAt: string | null;
  builders: Record<string, BuilderUsageRecord>;
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return nowIso().slice(0, 10);
}

function defaultBuilderEnvFile() {
  return path.join(process.cwd(), 'data', 'opengradient', 'http-auth', 'builders', 'builder-conformance-local.local.env');
}

function defaultBuilderUsagePath() {
  return path.join(process.cwd(), 'data', 'opengradient', 'builder-usage.json');
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const envFilePath = process.env.OPENGRADIENT_TEST_BUILDER_ENV_FILE?.trim() || defaultBuilderEnvFile();
  const envFile = dotenv.parse(await fs.readFile(envFilePath, 'utf8'));
  const builderId = process.env.OPENGRADIENT_BUILDER_ID?.trim() || envFile.OPENGRADIENT_BUILDER_ID?.trim() || 'builder-conformance-local';
  const usagePath = process.env.OPENGRADIENT_BUILDER_USAGE_PATH?.trim() || defaultBuilderUsagePath();
  const usageFile = await readJson<BuilderUsageFile>(usagePath, {
    version: 1,
    updatedAt: null,
    builders: {}
  });

  const existing = usageFile.builders[builderId] || null;
  const next: BuilderUsageRecord = {
    lastSeenAt: existing?.lastSeenAt || null,
    lastRequestAt: existing?.lastRequestAt || null,
    lastRequestPath: existing?.lastRequestPath || null,
    rateLimitWindow: {
      startedAt: null,
      totalRequests: 0,
      writeRequests: 0
    },
    daily: {
      day: todayIso(),
      totalRequests: 0,
      writeRequests: 0,
      inferenceCreates: 0,
      agentCreates: 0,
      creditsSpendCount: 0,
      creditsSpendMina: 0
    }
  };

  usageFile.builders[builderId] = next;
  usageFile.updatedAt = nowIso();
  await writeJson(usagePath, usageFile);

  console.log(
    JSON.stringify(
      {
        ok: true,
        builderId,
        usagePath,
        resetAt: usageFile.updatedAt
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[reset-builder-usage] failed', error);
  process.exit(1);
});
