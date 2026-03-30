import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.DA_RELAY_PORT || '8787', 10);
const FORWARD_MODE = String(process.env.DA_RELAY_FORWARD_MODE || 'none').trim().toLowerCase();
const ZEKO_DA_BRIDGE_URL = process.env.ZEKO_DA_BRIDGE_URL || '';
const ZEKO_DA_BRIDGE_TOKEN = process.env.ZEKO_DA_BRIDGE_TOKEN || '';
const ZEKO_DA_NAMESPACE = process.env.ZEKO_DA_NAMESPACE || 'shadowbook';
const ZEKO_DA_REQUIRE_FORWARD =
  String(process.env.ZEKO_DA_REQUIRE_FORWARD || (FORWARD_MODE === 'zeko-bridge' ? 'true' : 'false')).toLowerCase() === 'true';
const DA_RELAY_FORWARD_RETRIES = Math.max(1, Number.parseInt(process.env.DA_RELAY_FORWARD_RETRIES || '3', 10));
const DA_RELAY_FORWARD_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.DA_RELAY_FORWARD_TIMEOUT_MS || '15000', 10));
const DA_RELAY_SECRET = process.env.DA_RELAY_SECRET || 'shadowbook-da-relay-secret';
const DA_RELAY_COMMAND = process.env.DA_RELAY_COMMAND || '';
const DATA_DIR = process.env.DA_RELAY_DATA_DIR || path.join(path.dirname(__dirname), 'data');
const LOG_FILE = process.env.DA_RELAY_LOG_FILE || path.join(DATA_DIR, 'da-relay-log.jsonl');
const CACHE_FILE = process.env.DA_RELAY_CACHE_FILE || path.join(DATA_DIR, 'da-relay-cache.json');

const startedAtUnixMs = Date.now();
const cache = new Map();
let acceptedCount = 0;
let duplicateCount = 0;
let forwardedCount = 0;
let failedForwardCount = 0;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function signReceipt(value) {
  return createHmac('sha256', DA_RELAY_SECRET).update(value).digest('hex');
}

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`invalid json: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    req.on('error', reject);
  });
}

async function ensureDataDir() {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
}

async function appendLog(entry) {
  await ensureDataDir();
  await appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function loadCache() {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of items) {
      if (!item || typeof item.payloadHash !== 'string') continue;
      cache.set(item.payloadHash, item);
    }
  } catch {
    // empty cache
  }
}

async function persistCache() {
  await ensureDataDir();
  const items = Array.from(cache.values()).slice(-10000);
  await writeFile(CACHE_FILE, JSON.stringify({ items }, null, 2), 'utf8');
}

async function forwardWithCommand(payload) {
  return new Promise((resolve) => {
    const command = DA_RELAY_COMMAND.trim();
    if (!command) return resolve({ ok: false, error: 'DA_RELAY_COMMAND is empty' });
    const child = spawn(command, {
      shell: true,
      env: {
        ...process.env,
        DA_RELAY_PAYLOAD_B64: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('close', (code) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        try {
          const parsed = trimmed ? JSON.parse(trimmed) : {};
          resolve({ ok: true, reference: parsed.reference || parsed.id || null, response: parsed });
        } catch {
          resolve({ ok: true, reference: trimmed || null, response: { raw: trimmed } });
        }
      } else {
        resolve({ ok: false, error: `command exited with code ${code}: ${stderr.trim() || stdout.trim()}` });
      }
    });
  });
}

async function forwardToBridge(payload) {
  if (!ZEKO_DA_BRIDGE_URL) return { ok: false, error: 'ZEKO_DA_BRIDGE_URL is not configured' };
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= DA_RELAY_FORWARD_RETRIES; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DA_RELAY_FORWARD_TIMEOUT_MS);
    try {
      const response = await fetch(ZEKO_DA_BRIDGE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(ZEKO_DA_BRIDGE_TOKEN ? { authorization: `Bearer ${ZEKO_DA_BRIDGE_TOKEN}` } : {})
        },
        body: JSON.stringify(payload),
        signal: ac.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = `bridge http ${response.status}`;
      } else {
        clearTimeout(timer);
        return { ok: true, reference: body.reference || body.id || body.cid || null, response: body };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}

function validatePublishPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload must be an object');
  if (payload.mode !== 'zeko-relay') throw new Error('mode must be "zeko-relay"');
  if (typeof payload.commitment !== 'string' || payload.commitment.length < 8) throw new Error('commitment is required');
  if (!payload.payloadCiphertext || typeof payload.payloadCiphertext !== 'object') {
    throw new Error('payloadCiphertext is required');
  }
  if (payload.payloadCiphertext.mode !== 'aes-256-gcm') {
    throw new Error('payloadCiphertext.mode must be "aes-256-gcm"');
  }
}

async function handlePublish(req, res) {
  const payload = await parseJsonBody(req);
  validatePublishPayload(payload);
  const canonical = stableStringify(payload);
  const payloadHash = sha256Hex(canonical);
  const existing = cache.get(payloadHash);
  if (existing) {
    duplicateCount += 1;
    return json(res, 200, {
      ok: true,
      duplicate: true,
      id: existing.id,
      reference: existing.reference,
      payloadHash,
      relaySignature: existing.relaySignature,
      createdAtUnixMs: existing.createdAtUnixMs
    });
  }

  const createdAtUnixMs = Date.now();
  const id = `da_${payloadHash.slice(0, 20)}`;
  const relaySignature = signReceipt(`${id}|${payloadHash}|${createdAtUnixMs}`);

  let forwardResult = { ok: true, reference: id, response: { mode: 'stored_only' } };
  if (FORWARD_MODE === 'zeko-bridge') {
    forwardResult = await forwardToBridge({
      type: 'shadowbook.da.publish.v1',
      id,
      createdAtUnixMs,
      payloadHash,
      namespace: ZEKO_DA_NAMESPACE,
      commitment: payload.commitment,
      appId: payload.appId || null,
      network: payload.network || null,
      schema: payload.schema || null,
      payloadCiphertext: payload.payloadCiphertext,
      relaySignature
    });
  } else if (FORWARD_MODE === 'command') {
    forwardResult = await forwardWithCommand({
      type: 'shadowbook.da.publish',
      id,
      createdAtUnixMs,
      payloadHash,
      payload
    });
  }

  if (forwardResult.ok) forwardedCount += 1;
  else failedForwardCount += 1;
  if (!forwardResult.ok && ZEKO_DA_REQUIRE_FORWARD) {
    await appendLog({
      event: 'publish_rejected',
      id,
      payloadHash,
      createdAtUnixMs,
      forwardMode: FORWARD_MODE,
      error: String(forwardResult.error || 'unknown')
    });
    return json(res, 502, {
      ok: false,
      error: `zeko da forward failed: ${String(forwardResult.error || 'unknown')}`,
      id,
      payloadHash
    });
  }

  const reference = forwardResult.ok ? forwardResult.reference || id : `relay_error:${forwardResult.error || 'unknown'}`;
  const record = {
    id,
    payloadHash,
    reference,
    relaySignature,
    createdAtUnixMs,
    forwardMode: FORWARD_MODE,
    forwardOk: Boolean(forwardResult.ok),
    forwardError: forwardResult.ok ? null : String(forwardResult.error || 'unknown'),
    payloadMeta: {
      network: payload.network || null,
      appId: payload.appId || null,
      schema: payload.schema || null,
      commitment: payload.commitment || null
    }
  };

  cache.set(payloadHash, record);
  acceptedCount += 1;
  await appendLog({ event: 'publish', ...record });
  await persistCache();

  return json(res, 200, {
    ok: true,
    id,
    reference,
    payloadHash,
    relaySignature,
    forward: {
      mode: FORWARD_MODE,
      ok: Boolean(forwardResult.ok),
      error: forwardResult.ok ? null : String(forwardResult.error || 'unknown')
    }
  });
}

function statusSnapshot() {
  return {
    ok: true,
    nowUnixMs: Date.now(),
    uptimeSec: Math.floor((Date.now() - startedAtUnixMs) / 1000),
    relay: {
      port: PORT,
      forwardMode: FORWARD_MODE,
      bridgeConfigured: Boolean(ZEKO_DA_BRIDGE_URL),
      commandConfigured: Boolean(DA_RELAY_COMMAND),
      requireForward: ZEKO_DA_REQUIRE_FORWARD,
      forwardRetries: DA_RELAY_FORWARD_RETRIES,
      forwardTimeoutMs: DA_RELAY_FORWARD_TIMEOUT_MS
    },
    metrics: {
      acceptedCount,
      duplicateCount,
      forwardedCount,
      failedForwardCount,
      cachedItems: cache.size
    }
  };
}

async function main() {
  await loadCache();
  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) return json(res, 400, { error: 'bad request' });
    if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, statusSnapshot());
      if (req.method === 'GET' && url.pathname === '/records') {
        const limitRaw = Number.parseInt(url.searchParams.get('limit') || '50', 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;
        const records = Array.from(cache.values()).sort((a, b) => Number(b.createdAtUnixMs) - Number(a.createdAtUnixMs)).slice(0, limit);
        return json(res, 200, { ok: true, records });
      }
      if (req.method === 'POST' && url.pathname === '/publish') return handlePublish(req, res);
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(
      JSON.stringify({
        ok: true,
        message: 'da relay listening',
        port: PORT,
        forwardMode: FORWARD_MODE,
        bridgeConfigured: Boolean(ZEKO_DA_BRIDGE_URL),
        commandConfigured: Boolean(DA_RELAY_COMMAND),
        namespace: ZEKO_DA_NAMESPACE,
        requireForward: ZEKO_DA_REQUIRE_FORWARD
      })
    );
  });
}

main().catch((error) => {
  console.error('[da-relay] failed', error);
  process.exit(1);
});
