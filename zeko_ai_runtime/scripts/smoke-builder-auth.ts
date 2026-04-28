import 'dotenv/config';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

import { CoordinatorClient, CoordinatorHttpError } from '../src/sdk/index.js';

interface BuilderAuthRecord {
  id: string;
  label: string;
  status: 'active' | 'paused';
  authMode: 'api-key' | 'bearer';
  secretHash: string;
  scopes: string[];
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    maxWriteRequests: number | null;
  } | null;
  dailyQuota: null;
  metadata: null;
  createdAt: string;
  updatedAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function waitForHealth(baseUrl: string, attempts = 40, child?: ReturnType<typeof spawn>, logs: string[] = []) {
  for (let index = 0; index < attempts; index += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`Smoke server exited early with code ${child.exitCode}. Logs:\n${logs.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health. Logs:\n${logs.join('')}`);
}

async function stopChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  const repoRoot = process.cwd();
  const sourceDataDir = path.join(repoRoot, 'data', 'opengradient');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opengradient-builder-auth-'));
  const tempDataDir = path.join(tempRoot, 'data', 'opengradient');
  const tempHttpAuthDir = path.join(tempDataDir, 'http-auth');
  const builderAuthPath = path.join(tempHttpAuthDir, 'builders.json');
  const builderId = 'smoke-builder';
  const builderSecret = 'smoke-builder-key';
  const port = 4600 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs: string[] = [];

  await fs.mkdir(path.dirname(tempDataDir), { recursive: true });
  await fs.cp(sourceDataDir, tempDataDir, {
    recursive: true,
    filter: (source) => !path.basename(source).includes('.tmp')
  });
  await fs.mkdir(tempHttpAuthDir, { recursive: true });

  const record: BuilderAuthRecord = {
    id: builderId,
    label: 'Smoke Builder',
    status: 'active',
    authMode: 'api-key',
    secretHash: sha256Hex(builderSecret),
    scopes: ['auth:read', 'operators:read'],
    rateLimit: {
      windowMs: 60_000,
      maxRequests: 3,
      maxWriteRequests: 1
    },
    dailyQuota: null,
    metadata: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await fs.writeFile(
    builderAuthPath,
    `${JSON.stringify({ version: 1, updatedAt: nowIso(), builders: [record] }, null, 2)}\n`,
    'utf8'
  );

  const child = spawn('node', [path.join(repoRoot, 'dist', 'src', 'server.js')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      OPENGRADIENT_PORT: String(port),
      OPENGRADIENT_DATA_DIR: tempDataDir,
      OPENGRADIENT_BUILDER_AUTH_PATH: builderAuthPath,
      OPENGRADIENT_CREDITS_OPERATOR_AUTO_PROCESS_MS: '0',
      OPENGRADIENT_CREDITS_DEPOSIT_MONITOR_MS: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  try {
    await waitForHealth(baseUrl, 40, child, logs);

    const client = new CoordinatorClient({
      baseUrl,
      auth: {
        kind: 'api-key',
        apiKey: builderSecret
      },
      timeoutMs: 5000
    });

    const authMe = await client.getAuthMe();
    if (!authMe.authenticated || authMe.principal?.role !== 'builder' || authMe.principal.id !== builderId) {
      throw new Error(`Unexpected auth/me response: ${JSON.stringify(authMe)}`);
    }

    const firstRouting = await client.getRouting();

    let modelsStatus = 0;
    try {
      await client.requestJson('/api/models', { method: 'GET' });
    } catch (error) {
      if (error instanceof CoordinatorHttpError) {
        modelsStatus = error.status;
      } else {
        throw error;
      }
    }

    let operatorStatusWriteStatus = 0;
    try {
      await client.requestJson(`/api/operators/${encodeURIComponent(firstRouting.localOperatorId)}/status`, {
        method: 'POST',
        body: { status: 'paused' }
      });
    } catch (error) {
      if (error instanceof CoordinatorHttpError) {
        operatorStatusWriteStatus = error.status;
      } else {
        throw error;
      }
    }

    await client.getRouting();

    let rateLimitStatus = 0;
    try {
      await client.getRouting();
    } catch (error) {
      if (error instanceof CoordinatorHttpError) {
        rateLimitStatus = error.status;
      } else {
        throw error;
      }
    }

    if (modelsStatus !== 403) {
      throw new Error(`Expected GET /api/models to fail with 403, received ${modelsStatus || 'no error'}.`);
    }
    if (operatorStatusWriteStatus !== 403) {
      throw new Error(
        `Expected POST /api/operators/:id/status to fail with 403, received ${operatorStatusWriteStatus || 'no error'}.`
      );
    }
    if (rateLimitStatus !== 429) {
      throw new Error(`Expected builder rate limit to fail with 429, received ${rateLimitStatus || 'no error'}.`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          builderId,
          authPrincipal: authMe.principal,
          scopeFailureStatus: modelsStatus,
          controlPlaneWriteFailureStatus: operatorStatusWriteStatus,
          rateLimitStatus
        },
        null,
        2
      )
    );
  } finally {
    await stopChild(child);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[smoke:builder-auth] failed', error);
  process.exit(1);
});
