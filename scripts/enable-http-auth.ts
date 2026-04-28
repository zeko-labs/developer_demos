import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const repoRoot = process.cwd();
const authDir = path.join(repoRoot, 'data', 'opengradient', 'http-auth');
const sharedApiKeyPath = path.join(authDir, 'shared-api-key.txt');
const sharedBearerTokenPath = path.join(authDir, 'shared-bearer-token.txt');
const localEnvPath = path.join(authDir, 'coordinator.local.env');
const remoteEnvPath = path.join(authDir, 'remote-operator.local.env');
const sdkEnvPath = path.join(authDir, 'sdk.local.env');
const summaryPath = path.join(authDir, 'summary.json');
const mode = normalizeMode(process.env.OPENGRADIENT_HTTP_AUTH_MODE);

function normalizeMode(value: string | undefined) {
  return value?.trim().toLowerCase() === 'bearer' ? 'bearer' : 'api-key';
}

async function writeSecret(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function writeEnv(filePath: string, entries: Record<string, string>) {
  const body = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function main() {
  const configuredApiKey = process.env.OPENGRADIENT_HTTP_SHARED_API_KEY?.trim() || null;
  const configuredBearerToken = process.env.OPENGRADIENT_HTTP_SHARED_BEARER_TOKEN?.trim() || null;
  const sharedApiKey = configuredApiKey || crypto.randomBytes(24).toString('hex');
  const sharedBearerToken = configuredBearerToken || crypto.randomBytes(32).toString('base64url');

  await writeSecret(sharedApiKeyPath, sharedApiKey);
  await writeSecret(sharedBearerTokenPath, sharedBearerToken);

  if (mode === 'api-key') {
    await writeEnv(localEnvPath, {
      OPENGRADIENT_HTTP_API_KEYS: sharedApiKey,
      OPENGRADIENT_OUTBOUND_API_KEY: sharedApiKey
    });
    await writeEnv(remoteEnvPath, {
      OPENGRADIENT_HTTP_API_KEYS: sharedApiKey,
      OPENGRADIENT_OUTBOUND_API_KEY: sharedApiKey
    });
    await writeEnv(sdkEnvPath, {
      OPENGRADIENT_COORDINATOR_API_KEY: sharedApiKey
    });
  } else {
    await writeEnv(localEnvPath, {
      OPENGRADIENT_HTTP_BEARER_TOKENS: sharedBearerToken,
      OPENGRADIENT_OUTBOUND_BEARER_TOKEN: sharedBearerToken
    });
    await writeEnv(remoteEnvPath, {
      OPENGRADIENT_HTTP_BEARER_TOKENS: sharedBearerToken,
      OPENGRADIENT_OUTBOUND_BEARER_TOKEN: sharedBearerToken
    });
    await writeEnv(sdkEnvPath, {
      OPENGRADIENT_COORDINATOR_BEARER_TOKEN: sharedBearerToken
    });
  }

  const summary = {
    ok: true,
    mode,
    generatedAt: new Date().toISOString(),
    localEnvPath,
    remoteEnvPath,
    sdkEnvPath,
    note:
      'Source the coordinator.local.env values into the primary process, copy remote-operator.local.env into the remote runtime.local.env, and use sdk.local.env for client calls like smoke:sdk.'
  };
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[enable-http-auth] failed', error);
  process.exit(1);
});
