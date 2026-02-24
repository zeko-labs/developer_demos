import 'reflect-metadata';
import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import express from 'express';
import cors from 'cors';
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  Bool,
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
  UInt32,
  Encoding,
  MerkleTree,
  Poseidon,
  fetchAccount,
  fetchTransactionStatus
} from 'o1js';
import { SimpleFungibleToken } from './zk/fungibleToken.js';
import { AgentRequestContract } from './zk/agentContract.js';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const fredApiKey = process.env.FRED_API_KEY || '';
const alphaVantageKey = process.env.ALPHAVANTAGE_API_KEY || '';
const twelveDataKey = process.env.TWELVE_DATA_API_KEY || '';
const massiveApiKey = process.env.MASSIVE_API_KEY || '';
const massiveS3AccessKeyId = process.env.MASSIVE_S3_ACCESS_KEY_ID || '';
const massiveS3SecretAccessKey = process.env.MASSIVE_S3_SECRET_ACCESS_KEY || '';
const massiveS3Endpoint = process.env.MASSIVE_S3_ENDPOINT || 'https://files.massive.com';
const massiveS3Bucket = process.env.MASSIVE_S3_BUCKET || 'flatfiles';
const massiveS3Region = process.env.MASSIVE_S3_REGION || 'us-east-1';
const massiveS3ForcePathStyle = process.env.MASSIVE_S3_FORCE_PATH_STYLE !== 'false';
const massiveS3Insecure = process.env.MASSIVE_S3_INSECURE === 'true';
const massiveFlatfilesMode = process.env.MASSIVE_FLATFILES_MODE || 'targeted';
const massiveFlatfilesStocksPrefix =
  process.env.MASSIVE_FLATFILES_STOCKS_PREFIX || 'us_stocks_sip/day_aggs_v1';
const massiveFlatfilesCryptoPrefix =
  process.env.MASSIVE_FLATFILES_CRYPTO_PREFIX || 'global_crypto/day_aggs_v1';
const secUserAgent = process.env.SEC_USER_AGENT || '';
const ipfsApiUrl = process.env.IPFS_API_URL || '';
const ipfsAuth = process.env.IPFS_AUTH || '';
const ipfsGateway = process.env.IPFS_GATEWAY || '';
const platformTreasuryKey =
  process.env.PLATFORM_TREASURY_PUBLIC_KEY || 'B62qqpyJPDGci2uxpapnXQmrFr77b47wRx1v2GDRnAHMUFJFjJv4YPb';
const platformFeeMina = process.env.PLATFORM_FEE_MINA ? Number(process.env.PLATFORM_FEE_MINA) : 0.01;
const adminToken = process.env.ADMIN_TOKEN || '';
const acpProtocol = 'acp';
const acpVersion = '0.1';

function getRelayerPublicKey(): string | null {
  const sponsorKey = getSecret('SPONSOR_PRIVATE_KEY');
  if (!sponsorKey) return null;
  try {
    return PrivateKey.fromBase58(sponsorKey).toPublicKey().toBase58();
  } catch {
    return null;
  }
}
const creditsMinDeposit = process.env.CREDITS_MIN_DEPOSIT_MINA
  ? Number(process.env.CREDITS_MIN_DEPOSIT_MINA)
  : 1;
const creditsTreasuryKey = process.env.CREDITS_TREASURY_PUBLIC_KEY || platformTreasuryKey;

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const bundledDataDir = path.join(process.cwd(), 'data');
const agentsPath = path.join(dataDir, 'agents.json');
const edgarPath = path.join(dataDir, 'edgar_sample.json');
const sp500Path = path.join(dataDir, 'sp500_sample.json');
const macroPath = path.join(dataDir, 'macro_sample.json');
const cryptoPath = path.join(dataDir, 'crypto_top500.json');
const requestsPath = path.join(dataDir, 'requests.json');
const merklePath = path.join(dataDir, 'merkle.json');
const outputMerklePath = path.join(dataDir, 'output_merkle.json');
const agentMerklePath = path.join(dataDir, 'agent_merkle.json');
const creditsMerklePath = path.join(dataDir, 'credits_merkle.json');
const nullifierMerklePath = path.join(dataDir, 'nullifier_merkle.json');
const creditsLedgerPath = path.join(dataDir, 'credits_ledger.json');
const nullifierSetPath = path.join(dataDir, 'nullifier_set.json');
const outputKeyPath = path.join(dataDir, 'output_encryption.key');
const pricesDir = path.join(dataDir, 'prices');
const edgarCacheDir = path.join(dataDir, 'edgar_cache');
const cryptoListPath = path.join(dataDir, 'crypto_top500.json');
const flatfilesDir = path.join(dataDir, 'flatfiles');
const massiveFlatfilesDir = path.join(flatfilesDir, 'massive');
const massiveFlatfilesPricesDir = path.join(flatfilesDir, 'prices');
const massiveFlatfilesStatePath = path.join(massiveFlatfilesDir, 'last_sync.json');
const symbolIndexPath = path.join(dataDir, 'name_index.json');

const merkleHeight = 20;

let cachedOutputKey: Buffer | null = null;

async function getOutputEncryptionKey(): Promise<Buffer> {
  if (cachedOutputKey) return cachedOutputKey;
  try {
    const raw = await fs.readFile(outputKeyPath, 'utf-8');
    cachedOutputKey = Buffer.from(raw.trim(), 'base64');
    if (cachedOutputKey.length !== 32) {
      throw new Error('Invalid output encryption key length.');
    }
    return cachedOutputKey;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as any).code === 'ENOENT') {
      const generated = crypto.randomBytes(32);
      await fs.writeFile(outputKeyPath, generated.toString('base64'), 'utf-8');
      cachedOutputKey = generated;
      return generated;
    }
    throw err;
  }
}

function encryptPayload(payload: unknown, key: Buffer): { alg: string; iv: string; tag: string; ciphertext: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
}

function decryptPayload(
  payload: { alg: string; iv: string; tag: string; ciphertext: string },
  key: Buffer
): any {
  if (payload.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported encryption algorithm.');
  }
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

function hashAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifySignedMessage(publicKeyBase58: string, signatureBase58: string, message: string): boolean {
  const publicKey = PublicKey.fromBase58(publicKeyBase58);
  const signature = Signature.fromBase58(signatureBase58);
  const fields = Encoding.stringToFields(message);
  return signature.verify(publicKey, fields).toBoolean();
}
let contractCompiled = false;
const precompileZkapp = process.env.PRECOMPILE_ZKAPP === 'true';
const debugTxTiming = process.env.DEBUG_TX_TIMING === 'true';
let txLock: Promise<void> = Promise.resolve();

async function withTxLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = txLock;
  txLock = prev.then(() => next);
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}
const stakeRequired = 0;
const tzekoTokenAddress =
  process.env.TZEKO_TOKEN_ADDRESS ?? 'B62qjUhPDbMskxMduyzkyGnK6LZwHksuuYPRjyF4owJM7UWLGJynN36';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

function getSecret(envKey: string): string | null {
  return process.env[envKey] ?? null;
}

function hashToField(input: string): Field {
  const hex = crypto.createHash('sha256').update(input).digest('hex');
  return Field.from(BigInt(`0x${hex}`));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function normalizeMassiveSymbol(rawSymbol: string) {
  let symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return '';
  if (symbol.startsWith('X:')) symbol = symbol.slice(2);
  if (symbol.includes('/')) symbol = symbol.split('/')[0];
  if (symbol.includes('-')) symbol = symbol.split('-')[0];
  if (symbol.endsWith('USD') && symbol.length > 3) {
    symbol = symbol.slice(0, -3);
  }
  return symbol;
}

function inferMassiveColumns(headers: string[]) {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const symbolIndex = normalized.findIndex((h) => ['ticker', 'symbol', 'sym', 's'].includes(h));
  const closeIndex = normalized.findIndex((h) =>
    ['close', 'c', 'close_price', 'closeprice'].includes(h)
  );
  return { symbolIndex, closeIndex };
}

function normalizeCompanyName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|plc|holdings|holding)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsProhibitedPersonalContext(text: string) {
  const lowered = text.toLowerCase();
  const blockedPhrases = [
    'my income',
    'my salary',
    'my net worth',
    'my savings',
    'my age',
    'my job',
    'my financial situation',
    'risk tolerance',
    'retirement',
    'college fund',
    'allocate',
    'portfolio allocation',
    'based on my profile',
    'suitable for me'
  ];
  return blockedPhrases.some((phrase) => lowered.includes(phrase));
}

function sanitizePrompt(raw: string) {
  let cleaned = raw;
  cleaned = cleaned.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');
  cleaned = cleaned.replace(/\b(\+?\d[\d\s().-]{7,}\d)\b/g, '[REDACTED_PHONE]');
  cleaned = cleaned.replace(/\b(I am|I'm|My name is)\s+[A-Za-z'-]{2,}\b/gi, '[REDACTED_NAME]');
  const pronounTokens = new Set(['i', 'me', 'my', 'myself', 'you', 'your', 'yours', 'we', 'our']);
  cleaned = cleaned
    .split(/\s+/)
    .filter((token) => !pronounTokens.has(token.toLowerCase()))
    .join(' ');
  return cleaned.trim();
}

function sanitizeTextOutput(value: string) {
  let cleaned = value;
  cleaned = cleaned.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');
  cleaned = cleaned.replace(/\b(\+?\d[\d\s().-]{7,}\d)\b/g, '[REDACTED_PHONE]');
  cleaned = cleaned.replace(/\b(I am|I'm|My name is)\s+[A-Za-z'-]{2,}\b/gi, '[REDACTED_NAME]');
  cleaned = cleaned.replace(/\bBUY\b/gi, 'positive');
  cleaned = cleaned.replace(/\bSELL\b/gi, 'negative');
  cleaned = cleaned.replace(/\bHOLD\b/gi, 'neutral');
  return cleaned;
}

function sanitizeModelOutput(output: any): any {
  if (output === null || output === undefined) return output;
  if (typeof output === 'string') return sanitizeTextOutput(output);
  if (Array.isArray(output)) return output.map((item) => sanitizeModelOutput(item));
  if (typeof output === 'object') {
    const entries = Object.entries(output).map(([key, val]) => [key, sanitizeModelOutput(val)]);
    return Object.fromEntries(entries);
  }
  return output;
}

function normalizeActionLabel(action: string | null | undefined) {
  const value = String(action || '').toUpperCase();
  if (value === 'BUY' || value === 'BULLISH' || value === 'POSITIVE') return 'POSITIVE';
  if (value === 'SELL' || value === 'BEARISH' || value === 'NEGATIVE') return 'NEGATIVE';
  return 'NEUTRAL';
}

function canonicalAgentId(agentId: string | null | undefined) {
  const value = String(agentId || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'alpha') return 'alpha-signal';
  if (value === 'edgar') return 'edgar-scout';
  if (value === 'macro' || value === 'marco') return 'macro-sentiment';
  if (value === 'crypto') return 'crypto-quant';
  return value;
}

function normalizeOutputActions(output: any) {
  if (!output || typeof output !== 'object') return output;
  const outputs = Array.isArray(output.outputs) ? output.outputs : [output];
  const normalized = outputs.map((entry: any) => ({
    ...entry,
    action: normalizeActionLabel(entry?.action)
  }));
  return { ...output, outputs: normalized };
}

function normalizeAcpAction(action: string | null | undefined) {
  const normalized = normalizeActionLabel(action);
  if (normalized === 'POSITIVE') return 'positive';
  if (normalized === 'NEGATIVE') return 'negative';
  return 'neutral';
}

function redactKey(value: string | undefined): string {
  if (!value) return 'missing';
  const trimmed = value.trim();
  if (trimmed.length <= 12) return `${trimmed} (len=${trimmed.length})`;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-6)} (len=${trimmed.length})`;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, payload: unknown) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

async function readCreditsLedger() {
  return readJson<{
    balances: Record<string, number>;
    pending?: Record<string, any>;
    slashes?: Array<any>;
    confirms?: Array<any>;
  }>(creditsLedgerPath, {
    balances: {},
    pending: {},
    slashes: [],
    confirms: []
  });
}

async function writeCreditsLedger(ledger: {
  balances: Record<string, number>;
  pending?: Record<string, any>;
  slashes?: Array<any>;
  confirms?: Array<any>;
}) {
  await writeJson(creditsLedgerPath, ledger);
}

async function readNullifierSet() {
  return readJson<{ nullifiers: Record<string, any> }>(nullifierSetPath, { nullifiers: {} });
}

async function writeNullifierSet(payload: { nullifiers: Record<string, any> }) {
  await writeJson(nullifierSetPath, payload);
}

let nameIndexCache: Map<string, string> | null = null;

async function fetchSymbolIndex() {
  const url = 'https://dumbstockapi.com/stock?format=csv&countries=US';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Symbol index fetch failed: ${res.status}`);
  }
  const text = await res.text();
  const lines = text.split('\n').filter((line) => line.trim());
  if (!lines.length) throw new Error('Symbol index empty');
  const header = splitCsvLine(lines[0]);
  const symbolIndex = header.findIndex((h) => h.toLowerCase() === 'ticker');
  const nameIndex = header.findIndex((h) => h.toLowerCase() === 'name');
  if (symbolIndex === -1 || nameIndex === -1) {
    throw new Error('Symbol index missing required columns');
  }
  const map: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const symbol = (cols[symbolIndex] || '').toUpperCase().trim();
    const name = (cols[nameIndex] || '').trim();
    if (!symbol || !name) continue;
    const normalized = normalizeCompanyName(name);
    if (!normalized) continue;
    if (!map[normalized]) {
      map[normalized] = symbol;
    }
    const noSpaces = normalized.replace(/\s+/g, '');
    if (noSpaces && !map[noSpaces]) {
      map[noSpaces] = symbol;
    }
  }
  return map;
}

async function ensureSymbolIndexFresh() {
  try {
    const cached = await readJson<{ updatedAt?: string; source?: string; map?: Record<string, string> }>(
      symbolIndexPath,
      {}
    );
    const updatedAt = cached.updatedAt ? Date.parse(cached.updatedAt) : 0;
    const now = Date.now();
    if (cached.map && now - updatedAt < 1000 * 60 * 60 * 24 * 30) {
      nameIndexCache = new Map(Object.entries(cached.map));
      return;
    }
    const map = await fetchSymbolIndex();
    await writeJson(symbolIndexPath, {
      updatedAt: new Date().toISOString(),
      source: 'dumbstockapi',
      map
    });
    nameIndexCache = new Map(Object.entries(map));
  } catch (err) {
    console.warn('Symbol index refresh failed:', err instanceof Error ? err.message : err);
    if (!nameIndexCache) {
      const cached = await readJson<{ map?: Record<string, string> }>(symbolIndexPath, {});
      if (cached.map) {
        nameIndexCache = new Map(Object.entries(cached.map));
      }
    }
  }
}

function pickTickersFromNames(prompt: string, max = 3) {
  if (!nameIndexCache) return [];
  const normalizedPrompt = normalizeCompanyName(prompt);
  if (!normalizedPrompt) return [];
  const words = normalizedPrompt.split(' ').filter(Boolean);
  const hits: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let len = 1; len <= 4 && i + len <= words.length; len += 1) {
      const phrase = words.slice(i, i + len).join(' ');
      const symbol = nameIndexCache.get(phrase) || nameIndexCache.get(phrase.replace(/\s+/g, ''));
      if (symbol) hits.push(symbol);
      if (hits.length >= max) return Array.from(new Set(hits));
    }
  }
  return Array.from(new Set(hits)).slice(0, max);
}

async function uploadEncryptedToIpfs(payload: unknown) {
  if (!ipfsApiUrl) return null;
  try {
    const body = new FormData();
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    body.append('file', blob, 'output.json');
    const headers: Record<string, string> = {};
    if (ipfsAuth) {
      headers.Authorization = ipfsAuth.startsWith('Basic ') ? ipfsAuth : `Basic ${ipfsAuth}`;
    }
    const res = await fetch(`${ipfsApiUrl.replace(/\/$/, '')}/api/v0/add`, {
      method: 'POST',
      headers,
      body
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`IPFS add failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text);
    const cid = data?.Hash || data?.Cid || data?.cid;
    if (!cid) return null;
    return {
      cid,
      gateway: ipfsGateway ? `${ipfsGateway.replace(/\/$/, '')}/ipfs/${cid}` : null
    };
  } catch (err) {
    console.warn('IPFS upload failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function createMassiveS3Client() {
  if (!massiveS3AccessKeyId || !massiveS3SecretAccessKey) return null;
  if (massiveS3Insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  return new S3Client({
    region: massiveS3Region,
    endpoint: massiveS3Endpoint,
    forcePathStyle: massiveS3ForcePathStyle,
    credentials: {
      accessKeyId: massiveS3AccessKeyId,
      secretAccessKey: massiveS3SecretAccessKey
    }
  });
}

async function listLatestMassiveFlatfileKey(client: S3Client, prefix: string) {
  const now = new Date();
  try {
    const candidates: string[] = [];
    for (let offset = 0; offset < 2; offset += 1) {
      const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const y = targetDate.getUTCFullYear();
      const m = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: massiveS3Bucket,
          Prefix: `${prefix}/${y}/${m}/`
        })
      );
      const keys =
        list.Contents?.map((obj) => obj.Key).filter((key): key is string => Boolean(key)) ?? [];
      candidates.push(...keys);
      if (candidates.length) break;
    }
    if (candidates.length) {
      candidates.sort();
      return candidates[candidates.length - 1];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Massive flatfile list failed, probing direct keys:', message);
  }

  for (let offset = 1; offset <= 10; offset += 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const y = day.getUTCFullYear();
    const m = String(day.getUTCMonth() + 1).padStart(2, '0');
    const d = String(day.getUTCDate()).padStart(2, '0');
    const key = `${prefix}/${y}/${m}/${y}-${m}-${d}.csv.gz`;
    try {
      await client.send(new HeadObjectCommand({ Bucket: massiveS3Bucket, Key: key }));
      return key;
    } catch {
      // keep probing
    }
  }
  return null;
}

async function updateFlatfileSeries(
  symbol: string,
  date: string,
  close: number
) {
  if (!symbol || !Number.isFinite(close)) return;
  await fs.mkdir(massiveFlatfilesPricesDir, { recursive: true });
  const filePath = path.join(massiveFlatfilesPricesDir, `${symbol}.json`);
  let series: Array<{ date: string; close: number }> = [];
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) series = parsed;
  } catch {
    // ignore
  }
  const merged = mergeSeries(series, [{ date, close }]);
  await fs.writeFile(filePath, JSON.stringify(merged.slice(-400), null, 2));
}

async function readFlatfileSeries(symbol: string) {
  try {
    const filePath = path.join(massiveFlatfilesPricesDir, `${symbol.toUpperCase()}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as Array<{ date: string; close: number }>;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function getMassiveTargetSymbols() {
  const targets = new Set<string>();
  const cryptoTargets = new Set<string>();
  const addSymbol = (value: string) => {
    const symbol = value.trim().toUpperCase();
    if (symbol.length < 2) return;
    targets.add(symbol);
  };
  try {
    const sp500 = await readJson<{ tickers?: Array<{ symbol: string }> }>(sp500Path, {});
    (sp500.tickers || []).forEach((item) => addSymbol(item.symbol));
  } catch {
    // ignore
  }
  try {
    const macro = await readJson<{ tickers?: Array<{ symbol: string }> }>(macroPath, {});
    (macro.tickers || []).forEach((item) => addSymbol(item.symbol));
  } catch {
    // ignore
  }
  try {
    const cryptoList = await readJson<{ symbols?: string[] }>(cryptoPath, {});
    (cryptoList.symbols || []).forEach((symbol) => {
      const upper = symbol.trim().toUpperCase();
      if (upper.length < 2) return;
      targets.add(upper);
      cryptoTargets.add(upper);
    });
  } catch {
    // ignore
  }
  try {
    const requests = await readJson<Array<{ output?: any; outputs?: any[] }>>(requestsPath, []);
    requests.forEach((req) => {
      const outputs = Array.isArray(req.outputs) ? req.outputs : req.output ? [req.output] : [];
      outputs.forEach((entry) => {
        if (entry?.symbol) addSymbol(String(entry.symbol));
      });
    });
  } catch {
    // ignore
  }
  const equityTargets = new Set<string>(targets);
  cryptoTargets.forEach((symbol) => equityTargets.delete(symbol));
  return { targets, cryptoTargets, equityTargets };
}

async function syncMassiveFlatfile(prefix: string, label: string, isCrypto: boolean) {
  const client = createMassiveS3Client();
  if (!client) {
    return { label, ok: false, reason: 'missing credentials' };
  }
  const latestKey = await listLatestMassiveFlatfileKey(client, prefix);
  if (!latestKey) return { label, ok: false, reason: 'no files found' };
  const match = latestKey.match(/(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})/);
  const fileDate = match?.[3];
  if (!fileDate) return { label, ok: false, reason: 'unable to parse date' };

  const state = await readJson<any>(massiveFlatfilesStatePath, {});
  if (state?.[label]?.lastKey === latestKey) {
    return { label, ok: true, reason: 'already synced', key: latestKey };
  }

  let response: any;
  try {
    response = await client.send(new GetObjectCommand({ Bucket: massiveS3Bucket, Key: latestKey }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const extra =
      err && typeof err === 'object' && '$response' in err
        ? (err as any).$response?.body?.toString?.() || ''
        : '';
    return { label, ok: false, reason: `getObject failed: ${message}`, extra: extra.slice(0, 200) };
  }
  if (!response.Body) return { label, ok: false, reason: 'empty response' };
  const gunzip = zlib.createGunzip();
  const stream = response.Body as any;
  const input = stream.pipe(gunzip);
  const rl = readline.createInterface({ input });
  let headers: string[] = [];
  let columns: { symbolIndex: number; closeIndex: number } | null = null;
  let targets: Set<string> | null = null;
  if (massiveFlatfilesMode !== 'full') {
    const symbolSets = await getMassiveTargetSymbols();
    targets = isCrypto ? symbolSets.cryptoTargets : symbolSets.equityTargets;
  }
  let processed = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (!headers.length) {
      headers = splitCsvLine(line);
      columns = inferMassiveColumns(headers);
      continue;
    }
    if (!columns || columns.symbolIndex < 0 || columns.closeIndex < 0) continue;
    const parts = splitCsvLine(line);
    const rawSymbol = parts[columns.symbolIndex] || '';
    const closeValue = Number(parts[columns.closeIndex]);
    const symbol = normalizeMassiveSymbol(rawSymbol);
    if (!symbol || !Number.isFinite(closeValue)) continue;
    if (targets && !targets.has(symbol)) continue;
    await updateFlatfileSeries(symbol, fileDate, closeValue);
    processed += 1;
  }

  await fs.mkdir(massiveFlatfilesDir, { recursive: true });
  state[label] = { lastKey: latestKey, date: fileDate, processed, updatedAt: new Date().toISOString() };
  await writeJson(massiveFlatfilesStatePath, state);
  return { label, ok: true, key: latestKey, processed };
}

async function syncMassiveFlatfiles() {
  const results = [];
  results.push(await syncMassiveFlatfile(massiveFlatfilesStocksPrefix, 'stocks', false));
  results.push(await syncMassiveFlatfile(massiveFlatfilesCryptoPrefix, 'crypto', true));
  return results;
}

async function ensureMassiveFlatfilesFresh() {
  try {
    const state = await readJson<any>(massiveFlatfilesStatePath, {});
    const last = state?.lastRun ? new Date(state.lastRun).getTime() : 0;
    const now = Date.now();
    if (now - last < 1000 * 60 * 60 * 20) return;
    const results = await syncMassiveFlatfiles();
    state.lastRun = new Date().toISOString();
    state.results = results;
    await fs.mkdir(massiveFlatfilesDir, { recursive: true });
    await writeJson(massiveFlatfilesStatePath, state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const extra =
      err && typeof err === 'object' && '$response' in err
        ? (err as any).$response?.body?.toString?.() || ''
        : '';
    console.warn('Massive flatfile sync failed:', message, extra.slice(0, 200));
  }
}


async function ensureMerkleState() {
  const current = await readJson<{ height: number; nextIndex: number; leaves: string[] }>(merklePath, {
    height: merkleHeight,
    nextIndex: 0,
    leaves: []
  });
  if (!current.height) {
    current.height = merkleHeight;
  }
  return current;
}

async function ensureOutputMerkleState() {
  const current = await readJson<{ height: number; nextIndex: number; leaves: string[] }>(outputMerklePath, {
    height: merkleHeight,
    nextIndex: 0,
    leaves: []
  });
  if (!current.height) {
    current.height = merkleHeight;
  }
  return current;
}

async function ensureAgentMerkleState() {
  const current = await readJson<{ height: number; nextIndex: number; leaves: string[] }>(agentMerklePath, {
    height: merkleHeight,
    nextIndex: 0,
    leaves: []
  });
  if (!current.height) {
    current.height = merkleHeight;
  }
  return current;
}

async function ensureCreditsMerkleState() {
  const current = await readJson<{ height: number; nextIndex: number; leaves: string[] }>(creditsMerklePath, {
    height: merkleHeight,
    nextIndex: 0,
    leaves: []
  });
  if (!current.height) {
    current.height = merkleHeight;
  }
  return current;
}

async function ensureNullifierMerkleState() {
  const current = await readJson<{ height: number; nextIndex: number; leaves: string[] }>(nullifierMerklePath, {
    height: merkleHeight,
    nextIndex: 0,
    leaves: []
  });
  if (!current.height) {
    current.height = merkleHeight;
  }
  return current;
}

function buildMerkle(leaves: Field[]): MerkleTree {
  const tree = new MerkleTree(merkleHeight);
  leaves.forEach((leaf, index) => {
    tree.setLeaf(BigInt(index), leaf);
  });
  return tree;
}

async function commitLeaf(leaf: Field) {
  const state = await ensureMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const index = state.nextIndex;
  leaves[index] = leaf;
  const tree = buildMerkle(leaves);
  const newRoot = tree.getRoot();
  const witness = tree.getWitness(BigInt(index)).map((node: any) => ({
    isLeft: Boolean(node.isLeft),
    sibling: node.sibling.toString()
  }));

  const updated = {
    height: merkleHeight,
    nextIndex: index + 1,
    leaves: leaves.map((item) => item.toJSON())
  };
  await writeJson(merklePath, updated);

  return { index, newRoot, witness };
}

async function commitOutputLeaf(leaf: Field) {
  const state = await ensureOutputMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const index = state.nextIndex;
  leaves[index] = leaf;
  const tree = buildMerkle(leaves);
  const newRoot = tree.getRoot();
  const witness = tree.getWitness(BigInt(index)).map((node: any) => ({
    isLeft: Boolean(node.isLeft),
    sibling: node.sibling.toString()
  }));

  const updated = {
    height: merkleHeight,
    nextIndex: index + 1,
    leaves: leaves.map((item) => item.toJSON())
  };
  await writeJson(outputMerklePath, updated);

  return { index, newRoot, witness };
}

async function commitAgentLeaf(leaf: Field) {
  const state = await ensureAgentMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const index = state.nextIndex;
  leaves[index] = leaf;
  const tree = buildMerkle(leaves);
  const newRoot = tree.getRoot();
  const witness = tree.getWitness(BigInt(index)).map((node: any) => ({
    isLeft: Boolean(node.isLeft),
    sibling: node.sibling.toString()
  }));

  const updated = {
    height: merkleHeight,
    nextIndex: index + 1,
    leaves: leaves.map((item) => item.toJSON())
  };
  await writeJson(agentMerklePath, updated);

  return { index, newRoot, witness };
}

async function commitCreditsLeaf(leaf: Field) {
  const state = await ensureCreditsMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const index = state.nextIndex;
  leaves[index] = leaf;
  const tree = buildMerkle(leaves);
  const newRoot = tree.getRoot();
  const witness = tree.getWitness(BigInt(index)).map((node: any) => ({
    isLeft: Boolean(node.isLeft),
    sibling: node.sibling.toString()
  }));
  const updated = {
    height: merkleHeight,
    nextIndex: index + 1,
    leaves: leaves.map((item) => item.toJSON())
  };
  await writeJson(creditsMerklePath, updated);
  return { index, newRoot, witness };
}

async function commitNullifierLeaf(leaf: Field) {
  const state = await ensureNullifierMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const index = state.nextIndex;
  leaves[index] = leaf;
  const tree = buildMerkle(leaves);
  const newRoot = tree.getRoot();
  const witness = tree.getWitness(BigInt(index)).map((node: any) => ({
    isLeft: Boolean(node.isLeft),
    sibling: node.sibling.toString()
  }));
  const updated = {
    height: merkleHeight,
    nextIndex: index + 1,
    leaves: leaves.map((item) => item.toJSON())
  };
  await writeJson(nullifierMerklePath, updated);
  return { index, newRoot, witness };
}

async function getCurrentCreditsRoot() {
  const state = await ensureCreditsMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const tree = buildMerkle(leaves);
  return tree.getRoot();
}

async function getCurrentNullifierRoot() {
  const state = await ensureNullifierMerkleState();
  const leaves = state.leaves.map((leafHex) => Field.fromJSON(leafHex));
  const tree = buildMerkle(leaves);
  return tree.getRoot();
}

async function ensureContractCompiled() {
  if (!contractCompiled) {
    const start = Date.now();
    await AgentRequestContract.compile();
    if (debugTxTiming) {
      console.log(`Contract compiled in ${Date.now() - start}ms`);
    }
    contractCompiled = true;
  }
}

function getOracleKey(): PrivateKey {
  const env = getSecret('ORACLE_PRIVATE_KEY');
  if (env) return PrivateKey.fromBase58(env);
  return PrivateKey.random();
}

function getZkappPublicKey(): string | null {
  if (process.env.ZKAPP_PUBLIC_KEY) return process.env.ZKAPP_PUBLIC_KEY;
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  if (!zkappPrivateKey) return null;
  try {
    return PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
  } catch {
    return null;
  }
}

function resolveTreasuryKey(): string | null {
  return process.env.MODEL_TREASURY_PUBLIC_KEY ?? getZkappPublicKey();
}


function getNetwork() {
  const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
  const graphql = process.env.ZEKO_GRAPHQL;
  if (!graphql) {
    return { networkId, graphql: null };
  }
  return { networkId, graphql };
}

function computeLeaf(requestHash: Field, agentIdHash: Field): Field {
  return Poseidon.hash([requestHash, agentIdHash]);
}

function computeOutputLeaf(requestHash: Field, outputHash: Field): Field {
  return Poseidon.hash([requestHash, outputHash]);
}

function computeAgentLeaf(agentIdHash: Field, ownerHash: Field, treasuryHash: Field, stakeAmount: Field): Field {
  return Poseidon.hash([agentIdHash, ownerHash, treasuryHash, stakeAmount]);
}

function computeCreditsLeaf(ownerHash: Field, amount: Field, direction: Field): Field {
  return Poseidon.hash([ownerHash, amount, direction]);
}

function computeNullifierLeaf(ownerHash: Field, nonceHash: Field): Field {
  return Poseidon.hash([ownerHash, nonceHash]);
}

function signCreditsUpdate(
  creditsRoot: Field,
  nullifierRoot: Field,
  spendAmount?: Field,
  platformAmount?: Field
) {
  const oracleKey = getOracleKey();
  const oraclePk = oracleKey.toPublicKey();
  const signature = Signature.create(oracleKey, [
    creditsRoot,
    nullifierRoot,
    spendAmount ?? Field(0),
    platformAmount ?? Field(0)
  ]);
  return { oraclePk, signature };
}

async function buildUnsignedTx(payload: {
  requestHash: string;
  agentIdHash: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
  priceMina?: number;
  treasuryPublicKey?: string | null;
}, feePayer: string) {
  return withTxLock(async () => {
  const start = debugTxTiming ? Date.now() : 0;
  const network = getNetwork();
  if (!network.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const zkappPublicKey = getZkappPublicKey();
  if (!zkappPublicKey) {
    throw new Error('ZKAPP_PUBLIC_KEY env var not set');
  }
  if (!zkappPrivateKey) {
    throw new Error('ZKAPP_PRIVATE_KEY env var not set');
  }
  try {
    const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
    if (derived !== zkappPublicKey) {
      throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Invalid ZKAPP_PRIVATE_KEY');
  }

  await ensureContractCompiled();
  const networkInstance = Mina.Network({
    networkId: network.networkId as any,
    mina: network.graphql,
    archive: network.graphql
  });
  Mina.setActiveInstance(networkInstance);

  const fee = process.env.TX_FEE ?? '100000000';
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }
  if (!payload?.requestHash || !payload.agentIdHash || !payload.oraclePublicKey || !payload.signature || !payload.merkleRoot) {
    throw new Error('Missing payload fields for transaction');
  }
  const requestHash = Field.fromJSON(payload.requestHash);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  let oraclePk: PublicKey;
  try {
    oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  } catch {
    throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
  }
  let signature: Signature;
  try {
    signature = Signature.fromJSON(payload.signature as any);
  } catch {
    throw new Error('Invalid signature payload (base58 parse failed)');
  }
  const newRoot = Field.fromJSON(payload.merkleRoot);
  try {
    signature.verify(oraclePk, [requestHash, agentIdHash, newRoot]).toBoolean();
  } catch {
    // ignore signature verification logging here
  }
  let feePayerPk: PublicKey;
  try {
    feePayerPk = PublicKey.fromBase58(feePayer);
  } catch {
    throw new Error(`Invalid feePayer public key: ${redactKey(feePayer)}`);
  }
  const treasuryKey = payload.treasuryPublicKey || resolveTreasuryKey();
  if (!treasuryKey) {
    throw new Error('MODEL_TREASURY_PUBLIC_KEY or ZKAPP_PUBLIC_KEY must be set');
  }
  let treasuryPk: PublicKey;
  try {
    treasuryPk = PublicKey.fromBase58(treasuryKey);
  } catch {
    throw new Error(`Invalid treasury public key: ${redactKey(treasuryKey)}`);
  }
  let platformPk: PublicKey | null = null;
  try {
    platformPk = PublicKey.fromBase58(platformTreasuryKey);
  } catch {
    platformPk = null;
  }
  const priceMina = typeof payload.priceMina === 'number' ? payload.priceMina : 0.1;
  const amountNano = BigInt(Math.round(priceMina * 1e9));
  const amount = UInt64.from(amountNano);
  const platformFeeNano = BigInt(Math.round(Math.max(0, platformFeeMina) * 1e9));
  const platformFee = UInt64.from(platformFeeNano);
  const tx = await Mina.transaction({ sender: feePayerPk, fee }, async () => {
    const payment = AccountUpdate.createSigned(feePayerPk);
    payment.send({ to: treasuryPk, amount });
    if (platformPk && platformFeeNano > 0n) {
      payment.send({ to: platformPk, amount: platformFee });
    }
    await zkapp.submitSignedRequest(requestHash, agentIdHash, oraclePk, signature, newRoot);
  });

  // Non-magic fee payer handling: remove nonce precondition and require full commitment
  const feePayerUpdate = (tx as any).feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  await tx.prove();
  const txJson = tx.toJSON() as any;
  if (debugTxTiming) {
    console.log(`buildUnsignedTx total ${Date.now() - start}ms`);
  }
  return { tx: txJson, fee, networkId: network.networkId };
  });
}

async function buildAndSendRequestTxWithSponsor(payload: {
  requestHash: string;
  agentIdHash: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
  priceMina?: number;
  treasuryPublicKey?: string | null;
}) {
  return withTxLock(async () => {
  const sponsorKey = getSecret('SPONSOR_PRIVATE_KEY');
  if (!sponsorKey) {
    throw new Error('SPONSOR_PRIVATE_KEY not configured');
  }
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const network = getNetwork();
  if (!network.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const zkappPublicKey = getZkappPublicKey();
  if (!zkappPublicKey || !zkappPrivateKey) {
    throw new Error('ZKAPP_PUBLIC_KEY and ZKAPP_PRIVATE_KEY must be set');
  }
  const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
  if (derived !== zkappPublicKey) {
    throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
  }

  await ensureContractCompiled();
  const networkInstance = Mina.Network({
    networkId: network.networkId as any,
    mina: network.graphql,
    archive: network.graphql
  });
  Mina.setActiveInstance(networkInstance);

  const fee = process.env.TX_FEE ?? '100000000';
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }

  const requestHash = Field.fromJSON(payload.requestHash);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  let oraclePk: PublicKey;
  try {
    oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  } catch {
    throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
  }
  let signature: Signature;
  try {
    signature = Signature.fromJSON(payload.signature as any);
  } catch {
    throw new Error('Invalid signature payload (base58 parse failed)');
  }
  const newRoot = Field.fromJSON(payload.merkleRoot);

  const treasuryKey = payload.treasuryPublicKey || resolveTreasuryKey();
  if (!treasuryKey) {
    throw new Error('MODEL_TREASURY_PUBLIC_KEY or ZKAPP_PUBLIC_KEY must be set');
  }
  let treasuryPk: PublicKey;
  try {
    treasuryPk = PublicKey.fromBase58(treasuryKey);
  } catch {
    throw new Error(`Invalid treasury public key: ${redactKey(treasuryKey)}`);
  }
  let platformPk: PublicKey | null = null;
  try {
    platformPk = PublicKey.fromBase58(platformTreasuryKey);
  } catch {
    platformPk = null;
  }
  const priceMina = typeof payload.priceMina === 'number' ? payload.priceMina : 0.1;
  const amountNano = BigInt(Math.round(priceMina * 1e9));
  const amount = UInt64.from(amountNano);
  const platformFeeNano = BigInt(Math.round(Math.max(0, platformFeeMina) * 1e9));
  const platformFee = UInt64.from(platformFeeNano);

  const tx = await Mina.transaction({ sender: sponsorPk, fee }, async () => {
    const payment = AccountUpdate.createSigned(sponsorPk);
    payment.send({ to: treasuryPk, amount });
    if (platformPk && platformFeeNano > 0n) {
      payment.send({ to: platformPk, amount: platformFee });
    }
    await zkapp.submitSignedRequest(requestHash, agentIdHash, oraclePk, signature, newRoot);
  });

  const feePayerUpdate = (tx as any).feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
  });
}


async function buildUnsignedOutputTx(payload: {
  requestHash: string;
  outputHash: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
}, feePayer: string) {
  return withTxLock(async () => {
  const start = debugTxTiming ? Date.now() : 0;
  const network = getNetwork();
  if (!network.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const zkappPublicKey = getZkappPublicKey();
  if (!zkappPublicKey) {
    throw new Error('ZKAPP_PUBLIC_KEY env var not set');
  }
  if (!zkappPrivateKey) {
    throw new Error('ZKAPP_PRIVATE_KEY env var not set');
  }
  const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
  if (derived !== zkappPublicKey) {
    throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
  }

  await ensureContractCompiled();
  const networkInstance = Mina.Network({
    networkId: network.networkId as any,
    mina: network.graphql,
    archive: network.graphql
  });
  Mina.setActiveInstance(networkInstance);

  const fee = process.env.TX_FEE ?? '100000000';
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }
  if (!payload?.requestHash || !payload.outputHash || !payload.oraclePublicKey || !payload.signature || !payload.merkleRoot) {
    throw new Error('Missing payload fields for transaction');
  }
  const requestHash = Field.fromJSON(payload.requestHash);
  const outputHash = Field.fromJSON(payload.outputHash);
  let oraclePk: PublicKey;
  try {
    oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  } catch {
    throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
  }
  let signature: Signature;
  try {
    signature = Signature.fromJSON(payload.signature as any);
  } catch {
    throw new Error('Invalid signature payload (base58 parse failed)');
  }
  const newRoot = Field.fromJSON(payload.merkleRoot);
  try {
    signature.verify(oraclePk, [requestHash, outputHash, newRoot]).toBoolean();
  } catch {
    // ignore signature verification logging here
  }
  let feePayerPk: PublicKey;
  try {
    feePayerPk = PublicKey.fromBase58(feePayer);
  } catch {
    throw new Error(`Invalid feePayer public key: ${redactKey(feePayer)}`);
  }
  const tx = await Mina.transaction({ sender: feePayerPk, fee }, async () => {
    await zkapp.submitSignedOutput(requestHash, outputHash, oraclePk, signature, newRoot);
  });

  // Non-magic fee payer handling: remove nonce precondition and require full commitment
  const feePayerUpdate = (tx as any).feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  await tx.prove();
  const txJson = tx.toJSON() as any;
  if (debugTxTiming) {
    console.log(`buildUnsignedOutputTx total ${Date.now() - start}ms`);
  }
  return { tx: txJson, fee, networkId: network.networkId };
  });
}

async function buildAndSendOutputTxWithSponsor(payload: {
  requestHash: string;
  outputHash: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
}) {
  return withTxLock(async () => {
  const sponsorKey = getSecret('SPONSOR_PRIVATE_KEY');
  if (!sponsorKey) {
    throw new Error('SPONSOR_PRIVATE_KEY not configured');
  }
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const network = getNetwork();
  if (!network.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const zkappPublicKey = getZkappPublicKey();
  if (!zkappPublicKey || !zkappPrivateKey) {
    throw new Error('ZKAPP_PUBLIC_KEY and ZKAPP_PRIVATE_KEY must be set');
  }
  const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
  if (derived !== zkappPublicKey) {
    throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
  }

  await ensureContractCompiled();
  const networkInstance = Mina.Network({
    networkId: network.networkId as any,
    mina: network.graphql,
    archive: network.graphql
  });
  Mina.setActiveInstance(networkInstance);

  const fee = process.env.TX_FEE ?? '100000000';
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }

  if (!payload?.requestHash || !payload.outputHash || !payload.oraclePublicKey || !payload.signature || !payload.merkleRoot) {
    throw new Error('Missing payload fields for transaction');
  }
  const requestHash = Field.fromJSON(payload.requestHash);
  const outputHash = Field.fromJSON(payload.outputHash);
  let oraclePk: PublicKey;
  try {
    oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  } catch {
    throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
  }
  let signature: Signature;
  try {
    signature = Signature.fromJSON(payload.signature as any);
  } catch {
    throw new Error('Invalid signature payload (base58 parse failed)');
  }
  const newRoot = Field.fromJSON(payload.merkleRoot);

  const tx = await Mina.transaction({ sender: sponsorPk, fee }, async () => {
    await zkapp.submitSignedOutput(requestHash, outputHash, oraclePk, signature, newRoot);
  });

  const feePayerUpdate = (tx as any).feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
  });
}

async function buildUnsignedCreditsTx(payload: {
  creditsRoot: string;
  nullifierRoot: string;
  oraclePublicKey: string;
  signature: unknown;
  depositMina?: number;
  spendTo?: string;
  spendAmountMina?: number;
  platformAmountMina?: number;
  platformPayee?: string;
}, feePayer: string) {
  return withTxLock(async () => {
  const network = getNetwork();
  if (!network.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const zkappPublicKey = getZkappPublicKey();
  if (!zkappPublicKey) {
    throw new Error('ZKAPP_PUBLIC_KEY env var not set');
  }
  if (!zkappPrivateKey) {
    throw new Error('ZKAPP_PRIVATE_KEY env var not set');
  }
  try {
    const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
    if (derived !== zkappPublicKey) {
      throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Invalid ZKAPP_PRIVATE_KEY');
  }

  await ensureContractCompiled();
  const networkInstance = Mina.Network({
    networkId: network.networkId as any,
    mina: network.graphql,
    archive: network.graphql
  });
  Mina.setActiveInstance(networkInstance);

  const fee = process.env.TX_FEE ?? '100000000';
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }

  if (!payload?.creditsRoot || !payload.nullifierRoot || !payload.oraclePublicKey || !payload.signature) {
    throw new Error('Missing payload fields for transaction');
  }

  let oraclePk: PublicKey;
  try {
    oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  } catch {
    throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
  }
  let signature: Signature;
  try {
    signature = Signature.fromJSON(payload.signature as any);
  } catch {
    throw new Error('Invalid signature payload (base58 parse failed)');
  }
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);

  let feePayerPk: PublicKey;
  try {
    feePayerPk = PublicKey.fromBase58(feePayer);
  } catch {
    throw new Error(`Invalid feePayer public key: ${redactKey(feePayer)}`);
  }

  const depositMina = typeof payload.depositMina === 'number' ? payload.depositMina : 0;
  const spendAmountMina = typeof payload.spendAmountMina === 'number' ? payload.spendAmountMina : 0;
  const platformAmountMina = typeof payload.platformAmountMina === 'number' ? payload.platformAmountMina : 0;
  let platformPk: PublicKey | null = null;
  if (payload.platformPayee) {
    try {
      platformPk = PublicKey.fromBase58(payload.platformPayee);
    } catch {
      platformPk = null;
    }
  } else {
    try {
      platformPk = PublicKey.fromBase58(platformTreasuryKey);
    } catch {
      platformPk = null;
    }
  }
  let spendTo: PublicKey | null = null;
  if (payload.spendTo) {
    try {
      spendTo = PublicKey.fromBase58(payload.spendTo);
    } catch {
      spendTo = null;
    }
  }
  const tx = await Mina.transaction({ sender: feePayerPk, fee }, async () => {
    if (depositMina > 0) {
      const amount = UInt64.from(BigInt(Math.round(depositMina * 1e9)));
      const payment = AccountUpdate.createSigned(feePayerPk);
      payment.send({ to: zkappAddress, amount });
    }
    if (spendTo && spendAmountMina > 0) {
      const spendAmount = UInt64.from(BigInt(Math.round(spendAmountMina * 1e9)));
      const platformAmount = UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)));
      if (!platformPk) {
        throw new Error('Invalid platform payee for credits spend');
      }
      await zkapp.submitSignedCreditsSpend(
        creditsRoot,
        nullifierRoot,
        oraclePk,
        signature,
        spendTo,
        spendAmount,
        platformPk,
        platformAmount
      );
    } else {
      await zkapp.submitSignedCreditsUpdate(creditsRoot, nullifierRoot, oraclePk, signature);
    }
  });

  const feePayerUpdate = (tx as any).feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  await tx.prove();
  const txJson = tx.toJSON() as any;
  return { tx: txJson, fee, networkId: network.networkId };
  });
}

async function buildAndSendCreditsTxWithSponsor(payload: {
  creditsRoot: string;
  nullifierRoot: string;
  oraclePublicKey: string;
  signature: unknown;
  spendTo?: string;
  spendAmountMina?: number;
  platformAmountMina?: number;
  platformPayee?: string;
}) {
  return withTxLock(async () => {
  const sponsorKey = getSecret('SPONSOR_PRIVATE_KEY');
  if (!sponsorKey) {
    throw new Error('SPONSOR_PRIVATE_KEY not configured');
  }
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const network = getNetwork();
  if (!network.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const zkappPublicKey = getZkappPublicKey();
  if (!zkappPublicKey || !zkappPrivateKey) {
    throw new Error('ZKAPP_PUBLIC_KEY and ZKAPP_PRIVATE_KEY must be set');
  }
  const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
  if (derived !== zkappPublicKey) {
    throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
  }

  await ensureContractCompiled();
  const networkInstance = Mina.Network({
    networkId: network.networkId as any,
    mina: network.graphql,
    archive: network.graphql
  });
  Mina.setActiveInstance(networkInstance);

  const fee = process.env.TX_FEE ?? '100000000';
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }

  if (!payload?.creditsRoot || !payload.nullifierRoot || !payload.oraclePublicKey || !payload.signature) {
    throw new Error('Missing payload fields for transaction');
  }
  let oraclePk: PublicKey;
  try {
    oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  } catch {
    throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
  }
  let signature: Signature;
  try {
    signature = Signature.fromJSON(payload.signature as any);
  } catch {
    throw new Error('Invalid signature payload (base58 parse failed)');
  }
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);

  const spendAmountMina = typeof payload.spendAmountMina === 'number' ? payload.spendAmountMina : 0;
  const platformAmountMina = typeof payload.platformAmountMina === 'number' ? payload.platformAmountMina : 0;
  let spendTo: PublicKey | null = null;
  if (payload.spendTo) {
    try {
      spendTo = PublicKey.fromBase58(payload.spendTo);
    } catch {
      spendTo = null;
    }
  }
  let platformPk: PublicKey | null = null;
  if (payload.platformPayee) {
    try {
      platformPk = PublicKey.fromBase58(payload.platformPayee);
    } catch {
      platformPk = null;
    }
  }
  if (!platformPk) {
    platformPk = sponsorPk;
  }

  const tx = await Mina.transaction({ sender: sponsorPk, fee }, async () => {
    if (spendTo && spendAmountMina > 0) {
      const spendAmount = UInt64.from(BigInt(Math.round(spendAmountMina * 1e9)));
      const platformAmount = UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)));
      await zkapp.submitSignedCreditsSpend(
        creditsRoot,
        nullifierRoot,
        oraclePk,
        signature,
        spendTo,
        spendAmount,
        platformPk,
        platformAmount
      );
    } else {
      await zkapp.submitSignedCreditsUpdate(creditsRoot, nullifierRoot, oraclePk, signature);
    }
  });

  const feePayerUpdate = (tx as any).feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
  });
}


function seededScore(seed: string) {
  const hex = crypto.createHash('sha256').update(seed).digest('hex');
  const value = parseInt(hex.slice(0, 8), 16);
  return value / 0xffffffff;
}

function simulateReturn(symbol: string, timestamp: string, action: string) {
  const seed = `${symbol}:${timestamp}:${action}`;
  const score = seededScore(seed);
  const base = (score - 0.5) * 0.1; // -5% to +5%
  if (action === 'POSITIVE') return base + 0.02;
  if (action === 'NEGATIVE') return -base + 0.01;
  return base * 0.3;
}

function computePerformance(outputs: Array<{ symbol: string; action: string; fulfilledAt: string }>) {
  if (!outputs.length) {
    return { avgReturn: 0, winRate: 0, cagr: 0 };
  }
  const returns = outputs.map((entry) =>
    simulateReturn(entry.symbol, entry.fulfilledAt, entry.action)
  );
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const wins = returns.filter((r) => r > 0).length;
  const winRate = wins / returns.length;
  // Assume 7-day holding period per signal for demo CAGR
  const periodsPerYear = 365 / 7;
  const cagr = Math.pow(1 + avgReturn, periodsPerYear) - 1;
  return { avgReturn, winRate, cagr };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function fetchSecJson<T>(url: string): Promise<T> {
  if (!secUserAgent) {
    throw new Error('SEC_USER_AGENT env var not set');
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': secUserAgent,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`SEC fetch failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function readEdgarCache<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<T | null> {
  try {
    const filePath = path.join(edgarCacheDir, `${key}.json`);
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeEdgarCache<T>(key: string, payload: T) {
  await fs.mkdir(edgarCacheDir, { recursive: true });
  const filePath = path.join(edgarCacheDir, `${key}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

async function ensureSeedData() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    if (dataDir === bundledDataDir) return;
    const seedFiles = [
      'agents.json',
      'crypto_top500.json',
      'edgar_sample.json',
      'macro_sample.json',
      'sp500_sample.json',
      'requests_seed.json'
    ];
    await Promise.all(
      seedFiles.map(async (file) => {
        const target = path.join(dataDir, file === 'requests_seed.json' ? 'requests.json' : file);
        try {
          await fs.access(target);
          if (file === 'requests_seed.json') {
            try {
              const existing = await fs.readFile(target, 'utf-8');
              const parsed = JSON.parse(existing);
              if (Array.isArray(parsed?.requests) && parsed.requests.length > 0) {
                return;
              }
            } catch {
              // fall through to seed
            }
          } else {
            return;
          }
        } catch {
          // continue to seed
        }
        const source = path.join(bundledDataDir, file);
        try {
          const raw = await fs.readFile(source, 'utf-8');
          await fs.writeFile(target, raw);
        } catch {
          // ignore missing bundled file
        }
      })
    );
  } catch (err) {
    console.warn('Seed data init failed:', err instanceof Error ? err.message : err);
  }
}

function computeRequestStats(requests: any[]) {
  const byAgent: Record<string, number> = {};
  const attestedByAgent: Record<string, number> = {};
  for (const req of requests) {
    const agentId = canonicalAgentId(req?.agentId) || String(req?.agentId || '');
    if (!agentId) continue;
    byAgent[agentId] = (byAgent[agentId] || 0) + 1;
    if (req?.outputProof) {
      attestedByAgent[agentId] = (attestedByAgent[agentId] || 0) + 1;
    }
  }
  const nonAlphaRequests = Object.entries(byAgent)
    .filter(([agentId]) => agentId !== 'alpha-signal')
    .reduce((sum, [, count]) => sum + count, 0);
  return {
    totalRequests: requests.length,
    byAgent,
    attestedByAgent,
    nonAlphaRequests
  };
}

async function mergeSeedRequests(options?: { onlyIfMissingNonAlpha?: boolean; dryRun?: boolean }) {
  const onlyIfMissingNonAlpha = options?.onlyIfMissingNonAlpha ?? false;
  const dryRun = options?.dryRun ?? false;
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const existingRequests = Array.isArray(requestsStore.requests) ? requestsStore.requests : [];
  const beforeStats = computeRequestStats(existingRequests);
  if (onlyIfMissingNonAlpha && beforeStats.nonAlphaRequests > 0) {
    return { merged: false, added: 0, skipped: 'non-alpha requests already present', before: beforeStats, after: beforeStats };
  }
  const seedPath = path.join(bundledDataDir, 'requests_seed.json');
  const seedStore = await readJson<{ requests: any[] }>(seedPath, { requests: [] });
  const seedRequests = Array.isArray(seedStore.requests) ? seedStore.requests : [];
  if (!seedRequests.length) {
    return { merged: false, added: 0, skipped: 'seed file empty', before: beforeStats, after: beforeStats };
  }
  const knownIds = new Set(existingRequests.map((entry) => String(entry?.id || '')));
  const toAdd: any[] = [];
  for (const raw of seedRequests) {
    const id = String(raw?.id || '');
    if (!id || knownIds.has(id)) continue;
    const normalizedAgentId = canonicalAgentId(raw?.agentId) || String(raw?.agentId || '');
    toAdd.push({ ...raw, agentId: normalizedAgentId });
    knownIds.add(id);
  }
  if (!dryRun && toAdd.length > 0) {
    requestsStore.requests = [...existingRequests, ...toAdd];
    await writeJson(requestsPath, requestsStore);
  }
  const afterRequests = dryRun ? [...existingRequests, ...toAdd] : requestsStore.requests;
  const afterStats = computeRequestStats(afterRequests);
  return { merged: toAdd.length > 0, added: toAdd.length, before: beforeStats, after: afterStats };
}

async function logRequestStats(prefix: string) {
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const requests = Array.isArray(requestsStore.requests) ? requestsStore.requests : [];
  const stats = computeRequestStats(requests);
  console.log(`[${prefix}] request stats total=${stats.totalRequests} byAgent=${JSON.stringify(stats.byAgent)} attested=${JSON.stringify(stats.attestedByAgent)}`);
}

async function getTickerCikMap(): Promise<Map<string, string>> {
  const cacheKey = 'company_tickers';
  const cached = await readEdgarCache<Record<string, any>>(cacheKey);
  const data =
    cached ||
    (await fetchSecJson<Record<string, any>>('https://www.sec.gov/files/company_tickers.json'));
  if (!cached) await writeEdgarCache(cacheKey, data);
  const map = new Map<string, string>();
  Object.values(data).forEach((entry: any) => {
    const ticker = String(entry.ticker || '').toUpperCase();
    const cik = String(entry.cik_str || '').padStart(10, '0');
    if (ticker && cik) map.set(ticker, cik);
  });
  return map;
}

async function getCompanyFacts(cik: string) {
  const cacheKey = `facts_${cik}`;
  const cached = await readEdgarCache<any>(cacheKey);
  if (cached) return cached;
  const data = await fetchSecJson<any>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  await writeEdgarCache(cacheKey, data);
  return data;
}

async function getCompanySubmissions(cik: string) {
  const cacheKey = `submissions_${cik}`;
  const cached = await readEdgarCache<any>(cacheKey);
  if (cached) return cached;
  const data = await fetchSecJson<any>(`https://data.sec.gov/submissions/CIK${cik}.json`);
  await writeEdgarCache(cacheKey, data);
  return data;
}

function extractYoY(series: any[]): number | null {
  if (!Array.isArray(series)) return null;
  const annual = series
    .filter((row) => row?.fp === 'FY' && row?.form === '10-K')
    .map((row) => ({ end: row.end, val: Number(row.val) }))
    .filter((row) => Number.isFinite(row.val))
    .sort((a, b) => a.end.localeCompare(b.end));
  if (annual.length < 2) return null;
  const prev = annual[annual.length - 2].val;
  const latest = annual[annual.length - 1].val;
  if (!prev) return null;
  return (latest - prev) / Math.abs(prev);
}

function buildLatestFiling(submissions: any) {
  const recent = submissions?.filings?.recent;
  if (!recent) return { type: '10-Q', date: 'n/a', summary: 'No recent filing data.' };
  const forms: string[] = recent.form || [];
  const dates: string[] = recent.filingDate || [];
  const index = forms.findIndex((form) => form === '10-K' || form === '10-Q');
  if (index === -1) return { type: forms[0] || '10-Q', date: dates[0] || 'n/a', summary: 'Recent filing.' };
  return {
    type: forms[index],
    date: dates[index] || 'n/a',
    summary: 'Recent filing.'
  };
}

async function fetchStooqDaily(symbol: string) {
  const parseCsv = (text: string) => {
    if (!text) return [];
    const trimmed = text.trim();
    if (!trimmed || trimmed.toLowerCase().includes('error')) return [];
    const lines = trimmed.split('\n').slice(1);
    return lines
      .map((line) => line.split(','))
      .filter((parts) => parts.length >= 6)
      .map((parts) => ({
        date: parts[0],
        close: Number(parts[4])
      }))
      .filter((entry) => Number.isFinite(entry.close));
  };

  const tryFetch = async (baseUrl: string, ticker: string) => {
    const url = `${baseUrl}?s=${ticker}&i=d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/csv'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    return parseCsv(text);
  };

  const sym = symbol.toLowerCase();
  const primary = await tryFetch('https://stooq.com/q/d/l/', `${sym}.us`);
  if (primary.length) return primary;
  const fallback = await tryFetch('https://stooq.com/q/d/l/', sym);
  if (fallback.length) return fallback;
  const altPrimary = await tryFetch('https://stooq.pl/q/d/l/', `${sym}.us`);
  if (altPrimary.length) return altPrimary;
  const altFallback = await tryFetch('https://stooq.pl/q/d/l/', sym);
  return altFallback;
}

const priceCache = new Map<string, Array<{ date: string; close: number }>>();
let cryptoSymbolCache: Set<string> | null = null;

async function isCryptoSymbol(symbol: string) {
  if (!cryptoSymbolCache) {
    try {
      const data = await readJson<{ symbols: string[] }>(cryptoListPath, { symbols: [] });
      cryptoSymbolCache = new Set((data.symbols || []).map((s) => s.toUpperCase()));
    } catch {
      cryptoSymbolCache = new Set();
    }
  }
  return cryptoSymbolCache.has(symbol.toUpperCase());
}

async function getPriceSeries(symbol: string) {
  const cached = priceCache.get(symbol);
  if (cached && cached.length > 1) return cached;
  const series = await fetchBestPriceSeries(symbol);
  priceCache.set(symbol, series);
  return series;
}

async function fetchFredSeries(seriesId: string) {
  if (!fredApiKey) return [];
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredApiKey}&file_type=json`;
  const data = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(url);
  return (data.observations || [])
    .map((obs) => ({ date: obs.date, value: Number(obs.value) }))
    .filter((obs) => Number.isFinite(obs.value));
}

async function readPriceCache(symbol: string) {
  try {
    const filePath = path.join(pricesDir, `${symbol.toUpperCase()}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as Array<{ date: string; close: number }>;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writePriceCache(symbol: string, series: Array<{ date: string; close: number }>) {
  await fs.mkdir(pricesDir, { recursive: true });
  const filePath = path.join(pricesDir, `${symbol.toUpperCase()}.json`);
  await fs.writeFile(filePath, JSON.stringify(series, null, 2));
}

function mergeSeries(
  a: Array<{ date: string; close: number }>,
  b: Array<{ date: string; close: number }>
) {
  const map = new Map<string, number>();
  a.forEach((row) => map.set(row.date, row.close));
  b.forEach((row) => map.set(row.date, row.close));
  return Array.from(map.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

async function fetchAlphaVantageDaily(symbol: string, isCrypto: boolean) {
  if (!alphaVantageKey) return [];
  const url = isCrypto
    ? `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${encodeURIComponent(
        symbol
      )}&market=USD&apikey=${alphaVantageKey}`
    : `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${alphaVantageKey}&outputsize=compact`;
  const res = await fetch(url);
  const text = await res.text();
  if (process.env.DEBUG_PRICE === 'true') {
    console.warn('AlphaVantage', symbol, res.status, text.slice(0, 200));
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const series = data?.['Time Series (Daily)'] || data?.['Time Series (Digital Currency Daily)'];
  if (!series) return [];
  return Object.entries(series)
    .map(([date, row]: any) => ({
      date,
      close: Number(
        row['4. close'] ||
          row['5. adjusted close'] ||
          row['4a. close (USD)'] ||
          row['4a. close (usd)']
      )
    }))
    .filter((entry) => Number.isFinite(entry.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchTwelveDataDaily(symbol: string, isCrypto: boolean) {
  if (!twelveDataKey) return [];
  const symbolParam = isCrypto ? `${symbol}/USD` : symbol;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbolParam
  )}&interval=1day&outputsize=200&apikey=${twelveDataKey}`;
  const res = await fetch(url);
  const text = await res.text();
  if (process.env.DEBUG_PRICE === 'true') {
    console.warn('TwelveData', symbolParam, res.status, text.slice(0, 200));
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const values = data?.values;
  if (!Array.isArray(values)) return [];
  return values
    .map((row: any) => ({ date: row.datetime, close: Number(row.close) }))
    .filter((entry) => Number.isFinite(entry.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeMassiveTicker(symbol: string) {
  if (symbol === 'BRK-B') return 'BRK.B';
  if (symbol === 'BRK-A') return 'BRK.A';
  return symbol;
}

async function fetchMassiveDaily(symbol: string, isCrypto: boolean) {
  if (!massiveApiKey) return [];
  const baseTicker = normalizeMassiveTicker(symbol);
  const massiveTicker = isCrypto ? `X:${baseTicker}USD` : baseTicker;
  const today = new Date();
  const fromDate = new Date(today.getTime() - 1000 * 60 * 60 * 24 * 365);
  const from = fromDate.toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(
    massiveTicker
  )}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${massiveApiKey}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${massiveApiKey}`
    }
  });
  const text = await res.text();
  if (process.env.DEBUG_PRICE === 'true') {
    console.warn('Massive', massiveTicker, res.status, text.slice(0, 200));
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((row: any) => ({
      date: new Date(Number(row.t)).toISOString().slice(0, 10),
      close: Number(row.c)
    }))
    .filter((entry: any) => Number.isFinite(entry.close))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
}

async function fetchBestPriceSeries(symbol: string) {
  const crypto = await isCryptoSymbol(symbol);
  try {
    const twelve = await fetchTwelveDataDaily(symbol, crypto);
    if (twelve.length > 1) {
      const cached = await readPriceCache(symbol);
      const merged = mergeSeries(cached, twelve);
      await writePriceCache(symbol, merged);
      return merged;
    }
  } catch {
    // ignore and fall back to alpha
  }

  try {
    if (shouldUseMassive()) {
      const massive = await fetchMassiveDaily(symbol, crypto);
      if (massive.length > 1) {
        const cached = await readPriceCache(symbol);
        const merged = mergeSeries(cached, massive);
        await writePriceCache(symbol, merged);
        return merged;
      }
    }
  } catch {
    // ignore and fall back to alpha
  }

  // Alpha Vantage fallback: throttle to avoid rate limits (1 req/sec free tier)
  if (shouldUseAlphaVantage()) {
    try {
      const alpha = await fetchAlphaVantageDaily(symbol, crypto);
      if (alpha.length > 1) {
        const cached = await readPriceCache(symbol);
        const merged = mergeSeries(cached, alpha);
        await writePriceCache(symbol, merged);
        return merged;
      }
    } catch {
      // ignore and fall back to cache
    }
  }

  try {
    const flatfile = await readFlatfileSeries(symbol);
    if (flatfile.length > 1) {
      const cached = await readPriceCache(symbol);
      const merged = mergeSeries(cached, flatfile);
      await writePriceCache(symbol, merged);
      return merged;
    }
  } catch {
    // ignore and fall back to cache
  }

  const cached = await readPriceCache(symbol);
  return cached;
}

let lastAlphaRequestAt = 0;
function shouldUseAlphaVantage() {
  const now = Date.now();
  if (now - lastAlphaRequestAt < 1100) return false;
  lastAlphaRequestAt = now;
  return true;
}

let lastMassiveRequestAt = 0;
function shouldUseMassive() {
  const now = Date.now();
  if (now - lastMassiveRequestAt < 600) return false;
  lastMassiveRequestAt = now;
  return true;
}

async function fetchProviderDebugMassive(symbol: string, isCrypto: boolean) {
  if (!massiveApiKey) return { ok: false, reason: 'missing key' };
  const baseTicker = normalizeMassiveTicker(symbol);
  const massiveTicker = isCrypto ? `X:${baseTicker}USD` : baseTicker;
  const today = new Date();
  const fromDate = new Date(today.getTime() - 1000 * 60 * 60 * 24 * 365);
  const from = fromDate.toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(
    massiveTicker
  )}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${massiveApiKey}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${massiveApiKey}`
      }
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      snippet: text.slice(0, 200)
    };
  } catch {
    return { ok: false, reason: 'fetch failed' };
  }
}

async function fetchProviderDebugAlpha(symbol: string, isCrypto: boolean) {
  if (!alphaVantageKey) return { ok: false, reason: 'missing key' };
  const url = isCrypto
    ? `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${encodeURIComponent(
        symbol
      )}&market=USD&apikey=${alphaVantageKey}`
    : `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${alphaVantageKey}&outputsize=compact`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      snippet: text.slice(0, 200)
    };
  } catch (err) {
    return { ok: false, reason: 'fetch failed' };
  }
}

async function fetchProviderDebugTwelve(symbol: string, isCrypto: boolean) {
  if (!twelveDataKey) return { ok: false, reason: 'missing key' };
  const symbolParam = isCrypto ? `${symbol}/USD` : symbol;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbolParam
  )}&interval=1day&outputsize=200&apikey=${twelveDataKey}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      snippet: text.slice(0, 200)
    };
  } catch (err) {
    return { ok: false, reason: 'fetch failed' };
  }
}

function pickExitDate(series: Array<{ date: string; close: number }>, entryDate: string) {
  const entryIndex = series.findIndex((row) => row.date >= entryDate);
  const exitIndex = Math.min(series.length - 1, entryIndex + 5);
  if (entryIndex === -1) return series[series.length - 1];
  return series[exitIndex] ?? series[series.length - 1];
}

async function computeRealizedPnL(
  outputs: Array<{ symbol: string; action: string; fulfilledAt: string }>,
  includeDebug = false
) {
  if (!outputs.length) {
    return includeDebug
      ? { avgReturn: 0, winRate: 0, cagr: 0, coverage: 0, totalDays: 0, debug: [] as any[] }
      : { avgReturn: 0, winRate: 0, cagr: 0, coverage: 0 };
  }

  const bySymbol = new Map<string, Array<{ action: string; date: string }>>();
  outputs.forEach((o) => {
    const list = bySymbol.get(o.symbol) || [];
    list.push({ action: o.action, date: o.fulfilledAt.slice(0, 10) });
    bySymbol.set(o.symbol, list);
  });

  const tradeReturns: number[] = [];
  const fallbackTradeReturns: number[] = [];
  let fallbackTotalDays = 0;
  let totalDailyReturn = 1;
  let totalDays = 0;
  let considered = 0;
  let priced = 0;
  const debug: Array<{ symbol: string; reason: string }> = [];

  for (const [symbol, signals] of bySymbol.entries()) {
    try {
      const series = await getPriceSeries(symbol);
      considered += 1;
      if (!series.length) {
        debug.push({ symbol, reason: 'no price series' });
        continue;
      }
      priced += 1;
      const sorted = signals.sort((a, b) => a.date.localeCompare(b.date));
      let position: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
      let lastIndex = 0;

      const findIndex = (date: string) => {
        let idx = series.findIndex((row, i) => i >= lastIndex && row.date >= date);
        if (idx === -1) {
          idx = series.length - 1;
        }
        if (idx < lastIndex) idx = lastIndex;
        return idx;
      };

      // Fallback mode for sparse intraday/same-day traffic:
      // compute per-signal forward returns over a short window.
      for (const signal of sorted) {
        if (signal.action !== 'POSITIVE' && signal.action !== 'NEGATIVE') continue;
        const entryIndex = series.findIndex((row) => row.date >= signal.date);
        if (entryIndex === -1) continue;
        const entry = series[entryIndex];
        const exit = pickExitDate(series, signal.date);
        if (!entry || !exit || !entry.close || !exit.close) continue;
        const raw = (exit.close - entry.close) / entry.close;
        const adjusted = signal.action === 'NEGATIVE' ? -raw : raw;
        fallbackTradeReturns.push(adjusted);
        const exitIndex = series.findIndex((row) => row.date === exit.date);
        if (exitIndex >= entryIndex) {
          fallbackTotalDays += Math.max(1, exitIndex - entryIndex);
        } else {
          fallbackTotalDays += 1;
        }
      }

      for (let i = 0; i < sorted.length; i += 1) {
        const signal = sorted[i];
        const idx = findIndex(signal.date);
        if (idx === -1) {
          debug.push({ symbol, reason: 'no price index for signal' });
          continue;
        }

        // accrue returns from lastIndex to idx for open position
        if (position !== 'FLAT' && idx > lastIndex) {
          for (let j = lastIndex + 1; j <= idx; j += 1) {
            const prev = series[j - 1]?.close;
            const curr = series[j]?.close;
            if (!prev || !curr) continue;
            const daily = curr / prev - 1;
            const adj = position === 'SHORT' ? -daily : daily;
            totalDailyReturn *= 1 + adj;
            totalDays += 1;
          }
        }

        // update position based on signal
        if (signal.action === 'POSITIVE') position = 'LONG';
        else if (signal.action === 'NEGATIVE') position = 'SHORT';
        else if (signal.action === 'NEUTRAL') position = 'FLAT';

        lastIndex = idx;
      }

      // close at last available price
      if (position !== 'FLAT') {
        if (lastIndex < series.length - 1) {
          for (let j = lastIndex + 1; j < series.length; j += 1) {
            const prev = series[j - 1]?.close;
            const curr = series[j]?.close;
            if (!prev || !curr) continue;
            const daily = curr / prev - 1;
            const adj = position === 'SHORT' ? -daily : daily;
            totalDailyReturn *= 1 + adj;
            totalDays += 1;
          }
        } else if (lastIndex > 0) {
          const prev = series[lastIndex - 1]?.close;
          const curr = series[lastIndex]?.close;
          if (prev && curr) {
            const daily = curr / prev - 1;
            const adj = position === 'SHORT' ? -daily : daily;
            totalDailyReturn *= 1 + adj;
            totalDays += 1;
          }
        }
      }

      // approximate trade return for win-rate via holding window
      const entry = series[findIndex(sorted[0]?.date || '')];
      const exit = series[series.length - 1];
      if (entry && exit) {
        const raw = (exit.close - entry.close) / entry.close;
        const direction = sorted[sorted.length - 1]?.action === 'NEGATIVE' ? -1 : 1;
        tradeReturns.push(raw * direction);
      } else {
        debug.push({ symbol, reason: 'missing entry/exit price' });
      }
    } catch {
      debug.push({ symbol, reason: 'price fetch failed' });
    }
  }

  if (!totalDays) {
    if (fallbackTradeReturns.length > 0) {
      const fallbackGrowth = fallbackTradeReturns.reduce((acc, value) => acc * (1 + value), 1);
      const fallbackDays = Math.max(fallbackTotalDays, 20);
      const fallbackYears = fallbackDays / 252;
      const fallbackAvg = fallbackTradeReturns.reduce((sum, value) => sum + value, 0) / fallbackTradeReturns.length;
      const fallbackWins = fallbackTradeReturns.filter((value) => value > 0).length;
      let fallbackCagr = fallbackYears > 0 ? Math.pow(fallbackGrowth, 1 / fallbackYears) - 1 : 0;
      if (!Number.isFinite(fallbackCagr) || fallbackCagr < -0.9 || fallbackCagr > 10) {
        fallbackCagr = Math.max(-0.9, Math.min(10, fallbackCagr));
      }
      return includeDebug
        ? {
            avgReturn: fallbackAvg,
            winRate: fallbackTradeReturns.length ? fallbackWins / fallbackTradeReturns.length : 0,
            cagr: fallbackCagr,
            coverage: considered ? priced / considered : 0,
            totalDays: fallbackDays,
            debug
          }
        : {
            avgReturn: fallbackAvg,
            winRate: fallbackTradeReturns.length ? fallbackWins / fallbackTradeReturns.length : 0,
            cagr: fallbackCagr,
            coverage: considered ? priced / considered : 0
          };
    }
    if (process.env.DEBUG_PERF === 'true') {
      console.warn('Perf debug: no totalDays', debug);
    }
    return includeDebug
      ? {
          avgReturn: 0,
          winRate: 0,
          cagr: 0,
          coverage: considered ? priced / considered : 0,
          totalDays,
          debug
        }
      : { avgReturn: 0, winRate: 0, cagr: 0, coverage: considered ? priced / considered : 0 };
  }
  const avgReturn = tradeReturns.length
    ? tradeReturns.reduce((sum, r) => sum + r, 0) / tradeReturns.length
    : 0;
  const wins = tradeReturns.filter((r) => r > 0).length;
  const winRate = tradeReturns.length ? wins / tradeReturns.length : 0;
  const effectiveDays = Math.max(totalDays, 20);
  const years = effectiveDays / 252;
  let cagr = years > 0 ? Math.pow(totalDailyReturn, 1 / years) - 1 : 0;
  // allow CAGR to surface even with short histories in demo mode
  if (!Number.isFinite(cagr) || cagr < -0.9 || cagr > 10) {
    if (process.env.DEBUG_PERF === 'true') {
      console.warn('Perf debug: clamped CAGR', { cagr, totalDays, debug });
    }
    cagr = Math.max(-0.9, Math.min(10, cagr));
  }
  if (process.env.DEBUG_PERF === 'true') {
    console.warn('Perf debug summary', { totalDays, cagr, winRate, avgReturn, debug });
  }
  if (Math.abs(cagr) < 1e-12 && fallbackTradeReturns.length > 0) {
    const fallbackGrowth = fallbackTradeReturns.reduce((acc, value) => acc * (1 + value), 1);
    const fallbackDays = Math.max(fallbackTotalDays, 20);
    const fallbackYears = fallbackDays / 252;
    let fallbackCagr = fallbackYears > 0 ? Math.pow(fallbackGrowth, 1 / fallbackYears) - 1 : 0;
    if (!Number.isFinite(fallbackCagr) || fallbackCagr < -0.9 || fallbackCagr > 10) {
      fallbackCagr = Math.max(-0.9, Math.min(10, fallbackCagr));
    }
    const fallbackAvg =
      fallbackTradeReturns.reduce((sum, value) => sum + value, 0) / fallbackTradeReturns.length;
    const fallbackWins = fallbackTradeReturns.filter((value) => value > 0).length;
    return includeDebug
      ? {
          avgReturn: fallbackAvg,
          winRate: fallbackTradeReturns.length ? fallbackWins / fallbackTradeReturns.length : 0,
          cagr: fallbackCagr,
          coverage: considered ? priced / considered : 0,
          totalDays: fallbackDays,
          debug
        }
      : {
          avgReturn: fallbackAvg,
          winRate: fallbackTradeReturns.length ? fallbackWins / fallbackTradeReturns.length : 0,
          cagr: fallbackCagr,
          coverage: considered ? priced / considered : 0
        };
  }
  return includeDebug
    ? { avgReturn, winRate, cagr, coverage: considered ? priced / considered : 0, totalDays, debug }
    : { avgReturn, winRate, cagr, coverage: considered ? priced / considered : 0 };
}

app.get('/api/perf-debug', async (req, res) => {
  try {
    const rawAgentId = typeof req.query.agentId === 'string' ? req.query.agentId : null;
    const agentId = rawAgentId && rawAgentId.toLowerCase() !== 'all' ? canonicalAgentId(rawAgentId) : null;
    const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = requestsStore.requests.filter((req) => {
      if (agentId && canonicalAgentId(req.agentId) !== agentId) return false;
      if (!req.outputProof) return false;
      const ts = Date.parse(req.fulfilledAt || req.createdAt || '');
      return Number.isFinite(ts) && ts >= cutoff;
    });
    const outputs = filtered
      .flatMap((req) => {
        const source = req.outputSummary ?? req.output;
        const list = Array.isArray(source?.outputs) ? source.outputs : [source];
        return list.map((entry: any) => ({
          symbol: entry?.symbol ?? 'AAPL',
          action: normalizeActionLabel(entry?.action),
          fulfilledAt: req.fulfilledAt ?? req.createdAt
        }));
      })
      .filter((entry) => entry.fulfilledAt);
    const perf = await computeRealizedPnL(outputs, true);
    res.json({ agentId: agentId || 'all', totalRequests: filtered.length, outputs: outputs.length, perf });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Perf debug failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/market', async (_req, res) => {
  try {
    const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'JPM'];
    const equities = await Promise.all(
      symbols.map(async (symbol) => {
        const series = await fetchStooqDaily(symbol);
        const latest = series[series.length - 1];
        return { symbol, date: latest?.date, close: latest?.close };
      })
    );
    const gold = await fetchFredSeries('GOLDAMGBD228NLBM');
    const oil = await fetchFredSeries('DCOILWTICO');
    res.json({
      equities,
      macro: {
        gold: gold.slice(-5),
        oil: oil.slice(-5)
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Market fetch failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/validate-models', async (_req, res) => {
  try {
    const checks = [
      { agentId: 'alpha-signal', prompt: 'Should I buy HD this month?' },
      { agentId: 'edgar-scout', prompt: 'EDGAR on GOOGL and MSFT' },
      { agentId: 'macro-sentiment', prompt: 'Silver and housing stocks outlook' },
      { agentId: 'crypto-quant', prompt: 'BTC ETH SOL' }
    ];
    const results = [];
    for (const check of checks) {
      const output = await simulateModel({ agentId: check.agentId, prompt: check.prompt, requestId: 'validate' });
      const outputs = Array.isArray(output?.outputs) ? output.outputs : [output];
      const symbols = outputs.map((entry: any) => entry?.symbol).filter(Boolean);
      const priceSeries = await Promise.all(
        symbols.map(async (symbol: string) => {
          if (check.agentId === 'crypto-quant') {
            return { symbol, points: 0, ok: false, reason: 'crypto price feed not configured' };
          }
          try {
            const series = await getPriceSeries(symbol);
            return { symbol, points: series.length, ok: series.length > 1 };
          } catch (err) {
            return { symbol, points: 0, ok: false, reason: 'price fetch failed' };
          }
        })
      );
      results.push({
        agentId: check.agentId,
        prompt: check.prompt,
        symbols,
        priceSeries
      });
    }
    res.json({ timestamp: new Date().toISOString(), models: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/price-check', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol' });
  }
  const crypto = await isCryptoSymbol(symbol);
  const debug = String(req.query.debug || '') === '1';
  const results: Record<string, any> = {};
  try {
    const alpha = await fetchAlphaVantageDaily(symbol, crypto);
    results.alpha = { points: alpha.length, ok: alpha.length > 1 };
  } catch (err) {
    results.alpha = { ok: false, error: 'fetch failed' };
  }
  try {
    const twelve = await fetchTwelveDataDaily(symbol, crypto);
    results.twelve = { points: twelve.length, ok: twelve.length > 1 };
  } catch (err) {
    results.twelve = { ok: false, error: 'fetch failed' };
  }
  try {
    const massive = await fetchMassiveDaily(symbol, crypto);
    results.massive = { points: massive.length, ok: massive.length > 1 };
  } catch (err) {
    results.massive = { ok: false, error: 'fetch failed' };
  }
  try {
    const flatfile = await readFlatfileSeries(symbol);
    results.flatfile = { points: flatfile.length, ok: flatfile.length > 1 };
  } catch (err) {
    results.flatfile = { ok: false, error: 'read failed' };
  }
  const cached = await readPriceCache(symbol);
  results.cache = { points: cached.length, ok: cached.length > 1 };
  const response: any = {
    symbol,
    crypto,
    results,
    env: {
      alphaKey: Boolean(alphaVantageKey),
      twelveKey: Boolean(twelveDataKey),
      massiveKey: Boolean(massiveApiKey)
    }
  };
  if (debug) {
    response.debug = {
      alpha: await fetchProviderDebugAlpha(symbol, crypto),
      twelve: await fetchProviderDebugTwelve(symbol, crypto),
      massive: await fetchProviderDebugMassive(symbol, crypto)
    };
  }
  res.json(response);
});

app.get('/api/supported-symbols', async (_req, res) => {
  const edgar = await readJson<Record<string, any>>(edgarPath, {});
  const sp500 = await readJson<{ tickers: Array<{ symbol: string; sector: string; momentum: number }> }>(sp500Path, {
    tickers: []
  });
  const crypto = await readJson<{ symbols: string[] }>(cryptoPath, { symbols: [] });
  const symbolSet = new Set<string>();
  Object.keys(edgar || {}).forEach((symbol) => symbolSet.add(symbol.toUpperCase()));
  sp500.tickers.forEach((entry) => symbolSet.add(entry.symbol.toUpperCase()));
  crypto.symbols.forEach((symbol) => symbolSet.add(symbol.toUpperCase()));
  const symbols = Array.from(symbolSet).sort();
  const coverage = await Promise.all(
    symbols.slice(0, 200).map(async (symbol) => {
      const series = await readPriceCache(symbol);
      return { symbol, points: series.length };
    })
  );
  res.json({
    count: symbols.length,
    symbols,
    cacheSample: coverage
  });
});

app.get('/api/data-status', async (_req, res) => {
  const edgar = await readJson<Record<string, any>>(edgarPath, {});
  const sp500 = await readJson<{ tickers: Array<{ symbol: string; sector: string; momentum: number }> }>(sp500Path, {
    tickers: []
  });
  const crypto = await readJson<{ symbols: string[] }>(cryptoPath, { symbols: [] });
  const symbolSet = new Set<string>();
  Object.keys(edgar || {}).forEach((symbol) => symbolSet.add(symbol.toUpperCase()));
  sp500.tickers.forEach((entry) => symbolSet.add(entry.symbol.toUpperCase()));
  crypto.symbols.forEach((symbol) => symbolSet.add(symbol.toUpperCase()));
  const symbols = Array.from(symbolSet);
  let priced = 0;
  for (const symbol of symbols) {
    const series = await readPriceCache(symbol);
    if (series.length > 1) priced += 1;
  }
  res.json({
    totalSymbols: symbols.length,
    pricedSymbols: priced,
    coverage: symbols.length ? priced / symbols.length : 0
  });
});

app.get('/api/price-coverage', async (_req, res) => {
  const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const coverage = await Promise.all(
    data.agents.map(async (agent) => {
      const agentRequests = requestsStore.requests.filter((req) => canonicalAgentId(req.agentId) === agent.id);
      const attested = agentRequests.filter((req) => req.outputProof);
      const recentOutputs = attested
        .filter((req) => {
          const ts = Date.parse(req.fulfilledAt || req.createdAt || '');
          return Number.isFinite(ts) && ts >= cutoff;
        })
        .flatMap((req) => {
          const source = req.outputSummary ?? req.output;
          const list = Array.isArray(source?.outputs) ? source.outputs : [source];
          return list.map((entry: any) => ({
            symbol: entry?.symbol ?? 'AAPL',
            action: normalizeActionLabel(entry?.action),
            fulfilledAt: req.fulfilledAt ?? req.createdAt
          }));
        })
        .filter((entry) => entry.fulfilledAt);
      const perf = await computeRealizedPnL(recentOutputs);
      return { agentId: agent.id, coverage30d: perf.coverage };
    })
  );
  res.json({ coverage });
});
app.get('/api/flatfiles/status', async (req, res) => {
  const state = await readJson<any>(massiveFlatfilesStatePath, {});
  res.json({
    lastRun: state.lastRun || null,
    results: state.results || null,
    stocks: state.stocks || null,
    crypto: state.crypto || null
  });
});

app.post('/api/flatfiles/sync', async (req, res) => {
  try {
    const results = await syncMassiveFlatfiles();
    const state = await readJson<any>(massiveFlatfilesStatePath, {});
    state.lastRun = new Date().toISOString();
    state.results = results;
    await fs.mkdir(massiveFlatfilesDir, { recursive: true });
    await writeJson(massiveFlatfilesStatePath, state);
    res.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Flatfile sync failed';
    res.status(500).json({ ok: false, error: message });
  }
});

app.get('/api/flatfiles/debug', async (_req, res) => {
  try {
    const client = createMassiveS3Client();
    if (!client) {
      throw new Error('Missing Massive S3 credentials');
    }
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const prefixes = {
      stocks: `${massiveFlatfilesStocksPrefix}/${y}/${m}/`,
      crypto: `${massiveFlatfilesCryptoPrefix}/${y}/${m}/`
    };
    const listPrefix = async (prefix: string) => {
      try {
        const list = await client.send(
          new ListObjectsV2Command({
            Bucket: massiveS3Bucket,
            Prefix: prefix,
            MaxKeys: 10
          })
        );
        const keys =
          list.Contents?.map((obj) => obj.Key).filter((key): key is string => Boolean(key)) ?? [];
        return { ok: true, prefix, keys };
      } catch (err) {
        return { ok: false, prefix, error: err instanceof Error ? err.message : String(err) };
      }
    };
    const stocks = await listPrefix(prefixes.stocks);
    const crypto = await listPrefix(prefixes.crypto);
    res.json({
      endpoint: massiveS3Endpoint,
      bucket: massiveS3Bucket,
      forcePathStyle: massiveS3ForcePathStyle,
      insecure: massiveS3Insecure,
      prefixes,
      stocks,
      crypto
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Flatfile debug failed';
    res.status(400).json({ error: message });
  }
});

function pickTickersFromPrompt(prompt: string, tickers: string[], allowUnknown = false) {
  const aliasMap: Record<string, string> = {
    GOOG: 'GOOGL',
    'BRK.B': 'BRK-B',
    'BRK/A': 'BRK-A',
    BRKB: 'BRK-B',
    BRKA: 'BRK-A'
  };
  const nameMap: Record<string, string> = {
    apple: 'AAPL',
    microsoft: 'MSFT',
    nvidia: 'NVDA',
    alphabet: 'GOOGL',
    google: 'GOOGL',
    amazon: 'AMZN',
    meta: 'META',
    tesla: 'TSLA',
    netflix: 'NFLX',
    homedepot: 'HD',
    'home depot': 'HD',
    palantir: 'PLTR',
    'palantir technologies': 'PLTR',
    broadcom: 'AVGO',
    salesforce: 'CRM',
    oracle: 'ORCL',
    adobe: 'ADBE',
    paypal: 'PYPL',
    intel: 'INTC',
    amd: 'AMD'
  };
  const stopwords = new Set([
    'A',
    'I',
    'AN',
    'THE',
    'AND',
    'OR',
    'OF',
    'FOR',
    'TO',
    'IN',
    'ON',
    'WITH',
    'AT',
    'FROM',
    'BY',
    'AS',
    'IF',
    'BUT',
    'NOT',
    'IS',
    'ARE',
    'AM',
    'BE',
    'WAS',
    'WERE',
    'DO',
    'DID',
    'DOES',
    'THIS',
    'THAT',
    'THESE',
    'THOSE',
    'WHAT',
    'WHEN',
    'WHERE',
    'WHY',
    'HOW',
    'WHICH',
    'WHO',
    'WHOM',
    'ABOUT',
    'STOCK',
    'STOCKS',
    'PRICE',
    'PRICES',
    'SIGNAL',
    'ALPHA',
    'MACRO',
    'EDGAR',
    'MODEL',
    'TRADE',
    'TRADING',
    'TODAY',
    'TOMORROW',
    'NOW',
    'LATER',
    'PLEASE',
    'POSITIVE',
    'NEGATIVE',
    'NEUTRAL',
    'CALL',
    'PUT',
    'GOOD',
    'BAD',
    'YES',
    'NO',
    'MORE',
    'LESS',
    'MANY',
    'MUCH',
    'OUR',
    'YOUR',
    'THEIR',
    'HIS',
    'HER',
    'ITS',
    'ALL',
    'ANY',
    'SOME',
    'SHOULD',
    'WILL',
    'WOULD',
    'CAN',
    'COULD',
    'MAY',
    'MIGHT'
  ]);
  const lower = prompt.toLowerCase();
  const staticNameHits = Object.keys(nameMap)
    .filter((key) => lower.includes(key))
    .map((key) => nameMap[key]);
  const dynamicNameHits = pickTickersFromNames(prompt, 3);
  const upperTokens = prompt.match(/\$?[A-Z]{1,5}(\.[A-Z])?/g) || [];
  const cleaned = upperTokens
    .map((token) => token.replace('$', '').toUpperCase())
    .filter((token) => !stopwords.has(token));
  const mapped = cleaned.map((token) => (tickers.includes(token) ? token : aliasMap[token] || token));
  const matched = mapped.filter((token) => tickers.includes(token));
  const combined = Array.from(new Set([...staticNameHits, ...dynamicNameHits, ...matched]));
  if (allowUnknown) {
    const explicit = mapped.filter((token) => token.length >= 1);
    return explicit.length ? Array.from(new Set([...staticNameHits, ...dynamicNameHits, ...explicit])) : [];
  }
  const filtered = combined.filter((token) => tickers.includes(token));
  return filtered.length ? filtered : [];
}

function pickTopEdgarSymbols(edgarData: Record<string, any>, limit = 3) {
  const ranked = Object.entries(edgarData)
    .map(([symbol, entry]) => ({
      symbol,
      growth: typeof entry?.profitGrowth === 'number' ? entry.profitGrowth : 0
    }))
    .sort((a, b) => b.growth - a.growth);
  return ranked.slice(0, limit).map((entry) => entry.symbol);
}

function classifyAction(score: number, band = 0.12) {
  if (score >= 0.5 + band) return 'POSITIVE';
  if (score <= 0.5 - band) return 'NEGATIVE';
  return 'NEUTRAL';
}

async function simulateModel({ agentId, prompt, requestId }: { agentId: string; prompt: string; requestId: string }) {
  const edgar = await readJson<Record<string, any>>(edgarPath, {});
  const sp500 = await readJson<{ tickers: Array<{ symbol: string; sector: string; momentum: number }> }>(sp500Path, {
    tickers: []
  });
  const macro = await readJson<{ goldTrend: string; correlations: Record<string, number> }>(macroPath, {
    goldTrend: 'flat',
    correlations: {}
  });
  const crypto = await readJson<{ symbols: string[] }>(cryptoPath, { symbols: [] });

  const tickers = Object.keys(edgar);
  const sp500Tickers = sp500.tickers.map((entry) => entry.symbol);
  const universe = Array.from(new Set([...tickers, ...sp500Tickers]));
  const cryptoUniverse = crypto.symbols.length ? crypto.symbols : ['BTC', 'ETH', 'SOL'];
  const lowerPrompt = prompt.toLowerCase();
  const goldTrend = macro?.goldTrend ?? 'flat';
  const commodityMap: Record<string, string> = {
    gold: 'GLD',
    xau: 'GLD',
    oil: 'USO',
    wti: 'USO',
    silver: 'SLV',
    xag: 'SLV'
  };
  const thematicMap: Record<string, string[]> = {
    housing: ['XHB', 'ITB'],
    homebuilder: ['XHB', 'ITB'],
    mortgage: ['ITB'],
    'real estate': ['XLRE'],
    reit: ['XLRE'],
    banks: ['KBE', 'KRE'],
    financials: ['XLF'],
    energy: ['XLE'],
    oil: ['XLE'],
    metals: ['XME'],
    semis: ['SMH'],
    chips: ['SMH'],
    tech: ['XLK'],
    utilities: ['XLU'],
    rates: ['TLT', 'IEF'],
    treasury: ['TLT', 'IEF']
  };
  const commodityKey = Object.keys(commodityMap).find((key) => lowerPrompt.includes(key));
  const rankingPrompt = /(highest|top|best|rank|strongest|most bullish|highest confidence|best pick|top pick)/i.test(
    prompt
  );
  const lowestPrompt = /(lowest|worst|bottom|weakest|most bearish|lowest confidence|worst pick|sell)/i.test(prompt);
  const requested = pickTickersFromPrompt(
    prompt,
    agentId === 'crypto-quant' ? cryptoUniverse : universe,
    true
  );
  const themeKeys = Object.keys(thematicMap).filter((key) => lowerPrompt.includes(key));
  const thematicSymbols = Array.from(new Set(themeKeys.flatMap((key) => thematicMap[key])));
  const themeLabel = themeKeys.length ? themeKeys[0] : null;
  const symbols = requested.length
    ? requested
    : agentId === 'crypto-quant'
      ? cryptoUniverse.slice(0, 3)
      : commodityKey
        ? [commodityMap[commodityKey]]
        : thematicSymbols.length
          ? thematicSymbols
          : universe.slice(0, 3);

  const scoreRanked = (direction: 'top' | 'bottom' = 'top') => {
    if (agentId === 'edgar-scout') {
      const ranked = Object.entries(edgar)
        .map(([symbol, entry]) => ({
          symbol,
          growth: typeof entry?.profitGrowth === 'number' ? entry.profitGrowth : 0
        }))
        .sort((a, b) => b.growth - a.growth)
        .map((entry) => entry.symbol);
      if (ranked.length <= 3) return ranked;
      return direction === 'bottom' ? ranked.slice(-3) : ranked.slice(0, 3);
    }
    if (agentId === 'alpha-signal') {
      const rankingUniverse = sp500.tickers.length >= 10 ? sp500.tickers : universe.map((symbol) => ({ symbol, momentum: 0.5 }));
      const ranked = rankingUniverse
        .map((entry) => {
          const seed = `${requestId}:${agentId}:${entry.symbol}`;
          const score = 0.7 * (entry.momentum ?? 0.5) + 0.3 * seededScore(seed);
          return { symbol: entry.symbol, score };
        })
        .sort((a, b) => (direction === 'bottom' ? a.score - b.score : b.score - a.score));
      const list = ranked.slice(0, 3);
      return list.map((r) => r.symbol);
    }
    if (agentId === 'macro-sentiment') {
      const rankingUniverse = sp500.tickers.length >= 10 ? sp500.tickers : universe.map((symbol) => ({ symbol, sector: 'Unknown', momentum: 0.5 }));
      const ranked = rankingUniverse
        .map((entry) => {
          const sector = entry.sector || 'Unknown';
          const sectorCorr = macro.correlations?.[sector] ?? 0;
          const macroBias = goldTrend === 'up' ? 0.55 : 0.45;
          const macroScore = Math.min(1, Math.max(0, macroBias + sectorCorr * 0.3));
          const score = Math.min(1, Math.max(0, 0.6 * macroScore + 0.4 * (entry.momentum ?? 0.5)));
          return { symbol: entry.symbol, score };
        })
        .sort((a, b) => (direction === 'bottom' ? a.score - b.score : b.score - a.score));
      const list = ranked.slice(0, 3);
      return list.map((r) => r.symbol);
    }
    if (agentId === 'crypto-quant') {
      const ranked = cryptoUniverse
        .map((symbol) => ({ symbol, score: seededScore(`${requestId}:${agentId}:${symbol}`) }))
        .sort((a, b) => (direction === 'bottom' ? a.score - b.score : b.score - a.score));
      const list = ranked.slice(0, 3);
      return list.map((r) => r.symbol);
    }
    return symbols;
  };

  const shouldRank = (rankingPrompt || lowestPrompt) && !requested.length;
  const forcedAction = shouldRank ? (lowestPrompt ? 'NEGATIVE' : 'POSITIVE') : null;
  const selectedSymbols = shouldRank
    ? scoreRanked(lowestPrompt ? 'bottom' : 'top')
    : agentId === 'edgar-scout'
      ? requested.length
        ? requested
        : pickTopEdgarSymbols(edgar, 3)
      : symbols;

  const outputs = await Promise.all(
    selectedSymbols.map(async (symbol) => {
      const seed = `${requestId}:${agentId}:${symbol}`;
      const baseScore = seededScore(seed);
      const filing =
        edgar[symbol]?.latestFiling ?? { type: '10-Q', date: '2025-10-30', summary: 'No filing data loaded.' };
      const highlights = edgar[symbol]?.highlights ?? ['No EDGAR highlights loaded.'];
      let priceMomentum = 0.5;
      let lookbackReturn: number | null = null;
      let momentumSource = 'price series (20d vs 60d)';
      try {
        const series = await getPriceSeries(symbol);
        if (series.length >= 60) {
          const recent = series.slice(-20);
          const mid = series.slice(-60, -20);
          const recentAvg = recent.reduce((sum, r) => sum + r.close, 0) / recent.length;
          const midAvg = mid.reduce((sum, r) => sum + r.close, 0) / mid.length;
          priceMomentum = Math.min(1, Math.max(0, (recentAvg - midAvg) / midAvg + 0.5));
          lookbackReturn = (recentAvg - midAvg) / midAvg;
        } else if (series.length >= 40) {
          const recent = series.slice(-20);
          const mid = series.slice(-40, -20);
          const recentAvg = recent.reduce((sum, r) => sum + r.close, 0) / recent.length;
          const midAvg = mid.reduce((sum, r) => sum + r.close, 0) / mid.length;
          priceMomentum = Math.min(1, Math.max(0, (recentAvg - midAvg) / midAvg + 0.5));
          lookbackReturn = (recentAvg - midAvg) / midAvg;
          momentumSource = 'price series (20d vs 40d)';
        } else if (series.length >= 20) {
          const recent = series.slice(-10);
          const mid = series.slice(-20, -10);
          const recentAvg = recent.reduce((sum, r) => sum + r.close, 0) / recent.length;
          const midAvg = mid.reduce((sum, r) => sum + r.close, 0) / mid.length;
          priceMomentum = Math.min(1, Math.max(0, (recentAvg - midAvg) / midAvg + 0.5));
          lookbackReturn = (recentAvg - midAvg) / midAvg;
          momentumSource = 'price series (10d vs 20d)';
        } else if (series.length >= 2) {
          const start = series[0].close;
          const end = series[series.length - 1].close;
          lookbackReturn = (end - start) / start;
          priceMomentum = Math.min(1, Math.max(0, lookbackReturn + 0.5));
          momentumSource = 'price series (full range)';
        }
      } catch {
        priceMomentum = sp500.tickers.find((entry) => entry.symbol === symbol)?.momentum ?? 0.55;
        momentumSource = 'sample momentum';
      }

      if (agentId === 'alpha-signal') {
        const score = 0.7 * priceMomentum + 0.3 * baseScore;
        const action = forcedAction ?? classifyAction(score);
        return {
          symbol,
          action,
          confidence: Number((0.6 + score * 0.35).toFixed(2)),
          rationale: [
            `Price momentum (${momentumSource}): ${priceMomentum.toFixed(2)}`,
            lookbackReturn === null
              ? 'Lookback return: unavailable'
              : `Lookback return: ${(lookbackReturn * 100).toFixed(1)}%`,
            `Short-term drift signal: ${(baseScore * 100).toFixed(1)}%`
          ]
        };
      }

      if (agentId === 'edgar-scout') {
        let profitGrowth = 0;
        let revenueGrowth = 0;
        let profitSource = 'EDGAR profit growth (1y)';
        let revenueSource = 'EDGAR revenue growth (1y)';
        let latestFiling = { type: '10-Q', date: 'n/a', summary: 'No recent filing data.' };
        let highlightsLocal: string[] = [];
        let hasSecData = false;
        try {
          const cikMap = await getTickerCikMap();
          const cik = cikMap.get(symbol);
          if (cik) {
            const facts = await getCompanyFacts(cik);
            const submissions = await getCompanySubmissions(cik);
            latestFiling = buildLatestFiling(submissions);
            const netIncome = facts?.facts?.['us-gaap']?.NetIncomeLoss?.units?.USD;
            const revenues = facts?.facts?.['us-gaap']?.Revenues?.units?.USD;
            const incomeYoY = extractYoY(netIncome);
            const revenueYoY = extractYoY(revenues);
            if (incomeYoY !== null) profitGrowth = incomeYoY;
            if (revenueYoY !== null) revenueGrowth = revenueYoY;
            hasSecData = incomeYoY !== null || revenueYoY !== null;
            highlightsLocal = [
              `Net income YoY: ${(profitGrowth * 100).toFixed(1)}%`,
              `Revenue YoY: ${(revenueGrowth * 100).toFixed(1)}%`
            ];
          } else {
            profitSource = 'No CIK match';
            revenueSource = 'No CIK match';
          }
        } catch (err) {
          profitSource = 'EDGAR fetch failed';
          revenueSource = 'EDGAR fetch failed';
        }

        const score = Math.min(1, Math.max(0, 0.6 * profitGrowth + 0.4 * priceMomentum));
        const action = forcedAction ?? classifyAction(score);
        let priceSeries: Array<{ date: string; close: number }> = [];
        let hasPrice = false;
        let priceSeriesSource = symbol;
        try {
          const series = await getPriceSeries(symbol);
          priceSeries = series.slice(-30);
          hasPrice = series.length > 1;
        } catch {
          // ignore price failures
        }

        if (!hasPrice) {
          for (const proxy of ['SPY', 'QQQ', 'AAPL']) {
            try {
              const proxySeries = await getPriceSeries(proxy);
              if (proxySeries.length > 1) {
                priceSeries = proxySeries.slice(-30);
                hasPrice = true;
                priceSeriesSource = proxy;
                break;
              }
            } catch {
              // ignore proxy price failures
            }
          }
        }

        if (!hasSecData) {
          try {
            const sample = await readJson<Record<string, any>>(edgarPath, {});
            const fallback = sample?.[symbol];
            if (fallback) {
              profitGrowth = typeof fallback.profitGrowth === 'number' ? fallback.profitGrowth : profitGrowth;
              revenueGrowth = typeof fallback.revenueGrowth === 'number' ? fallback.revenueGrowth : revenueGrowth;
              latestFiling = fallback.latestFiling || latestFiling;
              highlightsLocal = Array.isArray(fallback.highlights) ? fallback.highlights : highlightsLocal;
              profitSource = 'EDGAR sample (fallback)';
              revenueSource = 'EDGAR sample (fallback)';
              hasSecData = true;
            }
          } catch {
            // ignore sample fallback failures
          }
        }

        if (!hasSecData) {
          const cachedKey = `last_edgar_${symbol.toUpperCase()}`;
          const cached = await readEdgarCache<any>(cachedKey, Infinity);
          if (cached) {
            return cached;
          }
          const missing: string[] = [];
          if (!hasSecData) missing.push('SEC data');
          throw new Error(`EDGAR Scout requires ${missing.join(' and ')}.`);
        }
        const payload = {
          symbol,
          action,
          confidence: Number((0.6 + score * 0.3).toFixed(2)),
          rationale: [
            `${symbol} ${latestFiling.type} on ${latestFiling.date}: ${latestFiling.summary}`,
            `${profitSource}: ${(profitGrowth * 100).toFixed(1)}%`,
            `${revenueSource}: ${(revenueGrowth * 100).toFixed(1)}%`,
            `Price reaction strength: ${priceMomentum.toFixed(2)}`,
            hasPrice
              ? `Price series source: ${priceSeriesSource}`
              : 'Price series unavailable; using filing + momentum-only signal'
          ],
          highlights: highlightsLocal,
          priceSeries
        };
        await writeEdgarCache(`last_edgar_${symbol.toUpperCase()}`, payload);
        return payload;
      }

      if (agentId === 'crypto-quant') {
        const score = 0.65 * priceMomentum + 0.35 * baseScore;
        const action = forcedAction ?? classifyAction(score);
        const rsi = Math.round(40 + score * 40);
        const trend = score > 0.6 ? 'uptrend' : score < 0.4 ? 'downtrend' : 'range';
        return {
          symbol,
          action,
          confidence: Number((0.55 + score * 0.35).toFixed(2)),
          rationale: [
            `Trend regime: ${trend}`,
            `RSI proxy: ${rsi}`,
            `Momentum score: ${priceMomentum.toFixed(2)}`
          ]
        };
      }

      const sectorOverrides: Record<string, string> = {
        PG: 'Consumer Staples',
        HD: 'Consumer Discretionary',
        LOW: 'Consumer Discretionary',
        TGT: 'Consumer Staples',
        WMT: 'Consumer Staples',
        COST: 'Consumer Staples',
        XHB: 'Consumer Discretionary',
        ITB: 'Consumer Discretionary',
        XLRE: 'Real Estate',
        XLF: 'Financials',
        KBE: 'Financials',
        KRE: 'Financials',
        XLE: 'Energy',
        XME: 'Materials',
        SMH: 'Technology',
        XLK: 'Technology',
        XLU: 'Utilities',
        TLT: 'Rates',
        IEF: 'Rates',
        GLD: 'Commodities',
        SLV: 'Commodities',
        USO: 'Commodities'
      };
      const sector =
        sp500.tickers.find((entry) => entry.symbol === symbol)?.sector ??
        sectorOverrides[symbol] ??
        'Industrials';
      const sectorCorr = macro.correlations[sector] ?? -0.2;
      let goldTrend = macro.goldTrend;
      let oilTrend = 'flat';
      try {
        const gold = await fetchFredSeries('GOLDAMGBD228NLBM');
        if (gold.length >= 30) {
          const short = gold.slice(-10).reduce((sum, r) => sum + r.value, 0) / 10;
          const long = gold.slice(-30).reduce((sum, r) => sum + r.value, 0) / 30;
          goldTrend = short > long ? 'up' : 'down';
        }
        const oil = await fetchFredSeries('DCOILWTICO');
        if (oil.length >= 30) {
          const short = oil.slice(-10).reduce((sum, r) => sum + r.value, 0) / 10;
          const long = oil.slice(-30).reduce((sum, r) => sum + r.value, 0) / 30;
          oilTrend = short > long ? 'up' : 'down';
        }
      } catch {
        // ignore macro fetch issues
      }
      const macroBias = goldTrend === 'up' ? 0.55 : 0.45;
      const macroScore = Math.min(1, Math.max(0, macroBias + sectorCorr * 0.3));
      const score = Math.min(1, Math.max(0, 0.65 * macroScore + 0.35 * priceMomentum));
      const action = forcedAction ?? classifyAction(score, 0.05);
      return {
        symbol,
        action,
        confidence: Number((0.55 + score * 0.35).toFixed(2)),
        rationale: [
          `Gold trend: ${goldTrend} · Oil trend: ${oilTrend}`,
          `Sector correlation (${sector}): ${sectorCorr.toFixed(2)}`,
          themeLabel ? `Theme focus: ${themeLabel}` : 'Macro-regime filter applied'
        ]
      };
    })
  );

  return { outputs };
}

async function callExternalModel(agent: any, payload: any) {
  if (!agent?.modelEndpoint) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent.modelAuth) {
    headers.Authorization = `Bearer ${agent.modelAuth}`;
  }
  const res = await fetch(agent.modelEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Model endpoint failed: ${res.status} ${error}`);
  }
  const data = await res.json();
  return data.output || data;
}

function validateModelResponse(payload: any) {
  const normalized =
    payload && typeof payload === 'object' && Array.isArray(payload.outputs)
      ? payload
      : { outputs: [payload] };
  const outputs = normalized.outputs || [];
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error('Model response missing outputs array.');
  }
  const first = outputs[0];
  if (!first?.symbol || !first?.action) {
    throw new Error('Model response must include symbol and action.');
  }
  return normalized;
}

async function createIntentCore(input: {
  agentId: string;
  prompt: string;
  requester?: string;
  useCredits?: boolean;
}) {
  const { agentId, prompt, requester, useCredits } = input;
  if (!agentId || typeof agentId !== 'string') throw new Error('Missing agentId');
  const normalizedAgentId = canonicalAgentId(agentId);
  if (!normalizedAgentId) throw new Error('Missing agentId');
  if (!prompt || typeof prompt !== 'string') throw new Error('Missing prompt');
  if (containsProhibitedPersonalContext(prompt)) {
    throw new Error('Prompt includes personal financial context. Please remove personal details.');
  }
  const sanitizedPrompt = sanitizePrompt(prompt);

  const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
  const agent = data.agents.find((entry) => entry.id === normalizedAgentId);
  if (!agent) throw new Error('Unknown agent');
  if (agent.disabled) {
    throw new Error('Agent is disabled by the platform');
  }

  let quotedPrice: number | null = null;
  if (agent.modelEndpoint) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (agent.modelAuth) {
        headers.Authorization = `Bearer ${agent.modelAuth}`;
      }
      const quoteRes = await fetch(agent.modelEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'price',
          agentId,
          prompt: sanitizedPrompt
        })
      });
      if (quoteRes.ok) {
        const quoteData = await quoteRes.json();
        const maybePrice = Number(quoteData?.priceMina ?? quoteData?.price);
        if (Number.isFinite(maybePrice) && maybePrice > 0) {
          quotedPrice = maybePrice;
        }
      }
    } catch {
      quotedPrice = null;
    }
  }

  const requestId = crypto.randomUUID();
  const accessToken = crypto.randomBytes(24).toString('base64url');
  const createdAt = new Date().toISOString();
  const requesterValue = useCredits ? 'CREDITS' : requester ?? '';
  const requestHash = hashToField(`${normalizedAgentId}:${sanitizedPrompt}:${createdAt}:${requesterValue}`);
  const agentIdHash = hashToField(normalizedAgentId);

  const leaf = computeLeaf(requestHash, agentIdHash);
  const { index, newRoot, witness } = await commitLeaf(leaf);

  const oracleKey = getOracleKey();
  const oraclePk = oracleKey.toPublicKey();
  const signature = Signature.create(oracleKey, [requestHash, agentIdHash, newRoot]);

  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const priceMina = quotedPrice ?? agent.priceMina;
  requestsStore.requests.unshift({
    id: requestId,
    agentId: normalizedAgentId,
    prompt: sanitizedPrompt,
    requester: requesterValue || null,
    useCredits: Boolean(useCredits),
    createdAt,
    status: 'AWAITING_PAYMENT',
    priceMina,
    treasuryPublicKey: agent.treasuryPublicKey ?? null,
    accessTokenHash: hashAccessToken(accessToken),
    requestHash: requestHash.toJSON(),
    agentIdHash: agentIdHash.toJSON(),
    merkleRoot: newRoot.toJSON(),
    merkleIndex: index,
    merkleWitness: witness
  });
  await writeJson(requestsPath, requestsStore);

  return {
    requestId,
    priceMina,
    accessToken,
    payload: {
      requestHash: requestHash.toJSON(),
      agentIdHash: agentIdHash.toJSON(),
      oraclePublicKey: oraclePk.toBase58(),
      signature: signature.toJSON(),
      merkleRoot: newRoot.toJSON(),
      priceMina,
      treasuryPublicKey: agent.treasuryPublicKey ?? null,
      merkleIndex: index,
      merkleWitness: witness
    }
  };
}

async function fulfillCore(input: {
  requestId: string;
  txHash?: string;
  creditTxHash?: string;
  accessToken?: string;
}) {
  const { requestId, txHash, creditTxHash, accessToken } = input;
  if (!requestId) throw new Error('Missing requestId');

  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const request = requestsStore.requests.find((entry) => entry.id === requestId);
  if (!request) throw new Error('Request not found');
  if (request.accessTokenHash) {
    const tokenMatch = accessToken && request.accessTokenHash === hashAccessToken(accessToken);
    if (!tokenMatch) {
      const unauthorizedError = new Error('Unauthorized');
      (unauthorizedError as any).statusCode = 403;
      throw unauthorizedError;
    }
  }
  const demoMode = process.env.DEMO_MODE !== 'false';
  if (!demoMode && !txHash && !creditTxHash) {
    throw new Error('On-chain payment or credits transaction required before fulfillment');
  }

  if (request.status === 'FULFILLED') {
    if (request.outputEncrypted) {
      const key = await getOutputEncryptionKey();
      const decrypted = decryptPayload(request.outputEncrypted, key);
      return {
        requestId,
        agentId: request.agentId,
        output: decrypted,
        status: request.status,
        outputProof: request.outputProof
      };
    }
    return {
      requestId,
      agentId: request.agentId,
      output: request.output,
      status: request.status,
      outputProof: request.outputProof
    };
  }

  let output;
  try {
    const requestAgentId = canonicalAgentId(request.agentId);
    const agentsStore = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
    const agentEntry = agentsStore.agents.find((agent) => agent.id === requestAgentId);
    output =
      (await callExternalModel(agentEntry, {
        requestId: request.id,
        agentId: requestAgentId,
        prompt: request.prompt,
        requester: request.useCredits ? 'credits:anonymous' : request.requester,
        requestHash: request.requestHash
      })) ||
      (await simulateModel({
        agentId: requestAgentId,
        prompt: request.prompt,
        requestId: request.id
      }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model failed';
    throw new Error(message);
  }

  const cleanedOutput = sanitizeModelOutput(output);
  const normalizedOutputRaw =
    cleanedOutput && typeof cleanedOutput === 'object' && Array.isArray((cleanedOutput as any).outputs)
      ? cleanedOutput
      : { outputs: [cleanedOutput] };
  const normalizedOutput = normalizeOutputActions(normalizedOutputRaw);
  const outputSummary = {
    outputs: (normalizedOutput.outputs || []).map((entry: any) => ({
      symbol: entry?.symbol ?? 'N/A',
      action: entry?.action ?? 'NEUTRAL',
      confidence: entry?.confidence ?? null
    }))
  };
  const outputString = stableStringify(normalizedOutput);
  const outputHash = hashToField(outputString);
  const outputLeaf = computeOutputLeaf(Field.fromJSON(request.requestHash), outputHash);
  const outputCommit = await commitOutputLeaf(outputLeaf);
  const oracleKey = getOracleKey();
  const oraclePk = oracleKey.toPublicKey();
  const outputSignature = Signature.create(oracleKey, [
    Field.fromJSON(request.requestHash),
    outputHash,
    outputCommit.newRoot
  ]);

  const outputKey = await getOutputEncryptionKey();
  const encryptedOutput = encryptPayload(normalizedOutput, outputKey);
  const ipfsResult = await uploadEncryptedToIpfs({
    requestId: request.id,
    outputHash: outputHash.toJSON(),
    encrypted: encryptedOutput
  });

  request.status = 'FULFILLED';
  request.txHash = txHash ?? request.txHash ?? 'mock';
  if (creditTxHash) {
    request.creditTxHash = creditTxHash;
  }
  request.output = null;
  request.outputSummary = outputSummary;
  request.outputEncrypted = encryptedOutput;
  if (ipfsResult?.cid) {
    request.outputCid = ipfsResult.cid;
    request.outputGateway = ipfsResult.gateway;
  }
  request.outputProof = {
    requestHash: request.requestHash,
    outputHash: outputHash.toJSON(),
    oraclePublicKey: oraclePk.toBase58(),
    signature: outputSignature.toJSON(),
    merkleRoot: outputCommit.newRoot.toJSON(),
    merkleIndex: outputCommit.index,
    merkleWitness: outputCommit.witness
  };
  request.fulfilledAt = new Date().toISOString();

  await writeJson(requestsPath, requestsStore);

  return {
    requestId,
    agentId: request.agentId,
    output,
    status: request.status,
    outputProof: request.outputProof,
    outputCid: ipfsResult?.cid || null,
    outputGateway: ipfsResult?.gateway || null
  };
}

function parseFeePayer(body: any): string {
  const feePayer = body?.feePayer;
  if (!feePayer || typeof feePayer !== 'string') {
    throw new Error('Missing feePayer');
  }
  return feePayer;
}

function toAcpOutput(output: any) {
  const normalized = normalizeOutputActions(output);
  const outputs = Array.isArray(normalized?.outputs) ? normalized.outputs : [];
  return {
    outputs: outputs.map((entry: any) => ({
      symbol: String(entry?.symbol ?? 'N/A'),
      action: normalizeAcpAction(entry?.action),
      confidence: Number(entry?.confidence ?? 0),
      rationale: Array.isArray(entry?.rationale) ? entry.rationale.map((r: any) => String(r)) : []
    }))
  };
}

app.get('/api/config', (_req, res) => {
  const network = getNetwork();
  res.json({
    demoMode: process.env.DEMO_MODE !== 'false',
    networkId: network.networkId,
    hasGraphql: Boolean(network.graphql),
    treasury: resolveTreasuryKey(),
    relayerPublicKey: getRelayerPublicKey(),
    platformFeeMina,
    creditsMinDeposit
  });
});

app.get('/.well-known/acp-capabilities.json', async (_req, res) => {
  const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
  const activeAgents = data.agents.filter((agent) => !agent.disabled);
  const services = activeAgents.map((agent) => ({
    protocol: acpProtocol,
    version: acpVersion,
    serviceId: agent.id,
    name: agent.name,
    pricing: {
      defaultFeeMina: Number(agent.priceMina || 0),
      supportsDynamicFee: Boolean(agent.modelEndpoint)
    },
    paymentModes: ['pay_per_request', 'credits'],
    privacy: {
      encryptedOutput: true,
      publicAttestation: true
    },
    attestation: {
      chain: 'zeko-testnet',
      contract: getZkappPublicKey() || null
    }
  }));
  res.json({
    protocol: acpProtocol,
    version: acpVersion,
    services
  });
});

app.post('/acp/intent', async (req, res) => {
  try {
    const { serviceId, prompt, requester, paymentMode } = req.body ?? {};
    const useCredits = paymentMode === 'credits';
    const result = await createIntentCore({
      agentId: String(serviceId || ''),
      prompt: String(prompt || ''),
      requester,
      useCredits
    });
    res.json({
      protocol: acpProtocol,
      version: acpVersion,
      requestId: result.requestId,
      serviceId,
      paymentMode: useCredits ? 'credits' : 'pay_per_request',
      accessToken: result.accessToken,
      payment: {
        amountMina: result.priceMina,
        payload: result.payload
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ACP intent failed';
    res.status(400).json({ error: message });
  }
});

app.post('/acp/fulfill', async (req, res) => {
  try {
    const { requestId, txHash, creditTxHash, accessToken } = req.body ?? {};
    const fulfilled = await fulfillCore({ requestId, txHash, creditTxHash, accessToken });
    const acpOutput = toAcpOutput(fulfilled.output);
    res.json({
      protocol: acpProtocol,
      version: acpVersion,
      requestId: fulfilled.requestId,
      serviceId: fulfilled.agentId ?? null,
      status: fulfilled.status === 'FULFILLED' ? 'completed' : 'failed',
      outputHash: fulfilled.outputProof?.outputHash ?? null,
      output: acpOutput,
      attestation: fulfilled.outputProof
        ? {
            txHash: null,
            chain: 'zeko-testnet',
            contract: getZkappPublicKey() || null
          }
        : null
    });
  } catch (err) {
    if (err instanceof Error && (err as any).statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'ACP fulfill failed';
    res.status(400).json({ error: message });
  }
});


app.get('/api/agents', async (_req, res) => {
  const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
  const activeAgents = data.agents.filter((agent) => !agent.disabled);
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const agents = await Promise.all(
    activeAgents.map(async (agent) => {
      const defaultSources: Record<string, string> = {
        'alpha-signal': 'S&P 500 price momentum + earnings drift',
        'edgar-scout': 'SEC EDGAR filings + price series',
        'macro-sentiment': 'Sector ETFs + gold/oil macro + price series',
        'crypto-quant': 'Top 500 crypto universe + price series'
      };
      const agentRequests = requestsStore.requests.filter((req) => canonicalAgentId(req.agentId) === agent.id);
      const attested = agentRequests.filter((req) => req.outputProof);
      const recent = agentRequests.filter((req) => {
        const ts = Date.parse(req.createdAt || '');
        return Number.isFinite(ts) && ts >= cutoff;
      });
      const recentOutputs = attested
        .filter((req) => {
          const ts = Date.parse(req.fulfilledAt || req.createdAt || '');
          return Number.isFinite(ts) && ts >= cutoff;
        })
        .flatMap((req) => {
          const source = req.outputSummary ?? req.output;
          const list = Array.isArray(source?.outputs) ? source.outputs : [source];
          return list.map((entry: any) => ({
            symbol: entry?.symbol ?? 'AAPL',
            action: normalizeActionLabel(entry?.action),
            fulfilledAt: req.fulfilledAt ?? req.createdAt
          }));
        })
        .filter((entry) => entry.fulfilledAt);
      const perf30d = await computeRealizedPnL(recentOutputs);
      let statusComputed = agent.status;
      if (attested.length >= 3) {
        statusComputed = 'LIVE';
      } else if (attested.length === 0) {
        statusComputed = 'PENDING';
      } else {
        statusComputed = 'BETA';
      }
      const createdAt = agent.createdAt ? Date.parse(agent.createdAt) : NaN;
      const newCutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
      const isNew = Number.isFinite(createdAt) ? createdAt >= newCutoff : false;
      return {
        ...agent,
        statusComputed,
        outputAttested: attested.length,
        callsLast30d: recent.length,
        cagr30d: perf30d.cagr,
        coverage30d: perf30d.coverage,
        dataSources: agent.dataSources || defaultSources[agent.id] || 'Custom model',
        isNew
      };
    })
  );
  res.json({ agents });
});

app.post('/api/admin/agents/:id/disable', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!adminToken || token !== adminToken) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const agentId = req.params.id;
    const { reason } = req.body ?? {};
    const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
    const agent = data.agents.find((entry) => entry.id === agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    agent.disabled = true;
    agent.disabledReason = reason || 'Policy violation';
    agent.disabledAt = new Date().toISOString();
    await writeJson(agentsPath, data);
    res.json({ ok: true, agentId, disabled: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Disable failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/admin/seed-requests', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!adminToken || token !== adminToken) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await ensureSeedData();
    const requestsFile = path.join(dataDir, 'requests.json');
    let count = 0;
    try {
      const raw = await fs.readFile(requestsFile, 'utf-8');
      const parsed = JSON.parse(raw);
      count = Array.isArray(parsed?.requests) ? parsed.requests.length : 0;
    } catch {
      // ignore
    }
    res.json({ ok: true, requestsSeeded: count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Seed requests failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/admin/migrate-requests-seed', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!adminToken || token !== adminToken) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const force = Boolean(req.body?.force);
    const dryRun = Boolean(req.body?.dryRun);
    const result = await mergeSeedRequests({
      onlyIfMissingNonAlpha: !force,
      dryRun
    });
    await logRequestStats('admin-migrate');
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Seed migration failed';
    res.status(400).json({ error: message });
  }
});


app.get('/api/leaderboard', async (_req, res) => {
  const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const stats = await Promise.all(
    data.agents.map(async (agent) => {
      const agentRequests = requestsStore.requests.filter((req) => canonicalAgentId(req.agentId) === agent.id);
      const fulfilled = agentRequests.filter((req) => req.status === 'FULFILLED');
      const attested = fulfilled.filter((req) => req.outputProof);
      const recent = agentRequests.filter((req) => {
        const ts = Date.parse(req.createdAt || '');
        return Number.isFinite(ts) && ts >= cutoff;
      });
      const recentOutputs = attested
        .filter((req) => {
          const ts = Date.parse(req.fulfilledAt || req.createdAt || '');
          return Number.isFinite(ts) && ts >= cutoff;
        })
        .flatMap((req) => {
          const source = req.outputSummary ?? req.output;
          const list = Array.isArray(source?.outputs) ? source.outputs : [source];
          return list.map((entry: any) => ({
            symbol: entry?.symbol ?? 'AAPL',
            action: normalizeActionLabel(entry?.action),
            fulfilledAt: req.fulfilledAt ?? req.createdAt
          }));
        })
        .filter((entry) => entry.fulfilledAt);
      const perf = await computeRealizedPnL(recentOutputs);
      const eligible = attested.length >= 3;
      return {
        id: agent.id,
        name: agent.name,
        successRate: agent.successRate,
        popularity: agent.popularity,
        totalRequests: agentRequests.length,
        fulfilled: fulfilled.length,
        outputAttested: attested.length,
        callsLast30d: recent.length,
        avgReturn: perf.avgReturn,
        winRate: perf.winRate,
        cagr30d: perf.cagr,
        coverage30d: perf.coverage,
        eligible
      };
    })
  );
  res.json({ leaderboard: stats });
});

app.get('/api/proofs', async (_req, res) => {
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const proofs = requestsStore.requests
    .filter((req) => req.outputProof)
    .map((req) => ({
      requestId: req.id,
      agentId: req.agentId,
      createdAt: req.createdAt,
      fulfilledAt: req.fulfilledAt,
      requestHash: req.requestHash,
      outputHash: req.outputProof.outputHash,
      merkleRoot: req.outputProof.merkleRoot
    }))
    .slice(0, 50);
  res.json({ proofs });
});

app.post('/api/agent-intent', async (req, res) => {
  try {
    const {
      name,
      tagline,
      priceMina,
      description,
      ownerPublicKey,
      treasuryPublicKey,
      modelEndpoint,
      modelAuth,
      hostingType
    } = req.body ?? {};
    if (!name || !tagline) throw new Error('Missing name or tagline');
    if (!ownerPublicKey) throw new Error('Missing owner public key');
    if (modelEndpoint && !modelAuth) {
      throw new Error('Auth token required for model endpoint');
    }

    const data = await readJson<{ agents: any[] }>(agentsPath, { agents: [] });
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (data.agents.some((agent) => agent.id === id)) {
      throw new Error('Agent id already exists');
    }

    const agentIdHash = hashToField(id);
    const ownerHash = hashToField(ownerPublicKey);
    const treasuryKey = treasuryPublicKey || ownerPublicKey;
    const treasuryHash = hashToField(treasuryKey);
    const stakeAmount = Field.from(stakeRequired);
    const leaf = computeAgentLeaf(agentIdHash, ownerHash, treasuryHash, stakeAmount);
    const { index, newRoot, witness } = await commitAgentLeaf(leaf);

    const oracleKey = getOracleKey();
    const oraclePk = oracleKey.toPublicKey();
    const signature = Signature.create(oracleKey, [
      agentIdHash,
      ownerHash,
      treasuryHash,
      stakeAmount,
      newRoot
    ]);

    data.agents.push({
      id,
      name,
      tagline,
      priceMina: Number(priceMina || 0.1),
      successRate: 0.5,
      popularity: 0,
      privacy: 'hashed prompts + on-chain attestations',
      description: description || 'Community agent',
      status: 'PENDING',
      ownerPublicKey,
      treasuryPublicKey: treasuryKey,
      modelEndpoint: modelEndpoint || null,
      hostingType: hostingType || 'custom',
      modelAuth: modelAuth || null,
      createdAt: new Date().toISOString(),
      stakeRequired: stakeRequired,
      agentHash: agentIdHash.toJSON(),
      merkleRoot: newRoot.toJSON(),
      merkleIndex: index,
      merkleWitness: witness
    });
    await writeJson(agentsPath, data);

    res.json({
      id,
      payload: {
        agentIdHash: agentIdHash.toJSON(),
        ownerHash: ownerHash.toJSON(),
        treasuryHash: treasuryHash.toJSON(),
        stakeAmount: stakeAmount.toJSON(),
        oraclePublicKey: oraclePk.toBase58(),
        signature: signature.toJSON(),
        merkleRoot: newRoot.toJSON(),
        merkleIndex: index,
        merkleWitness: witness,
        stakeRequired,
        tokenAddress: tzekoTokenAddress
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create agent intent';
    res.status(400).json({ error: message });
  }
});

app.post('/api/agent-test', async (req, res) => {
  try {
    const { modelEndpoint, modelAuth } = req.body ?? {};
    if (!modelEndpoint) {
      throw new Error('Missing model endpoint');
    }
    const payload = {
      requestId: `test_${Date.now()}`,
      agentId: 'test-agent',
      prompt: 'Should I buy Palantir?',
      requester: 'B62qtest',
      requestHash: crypto.createHash('sha256').update(String(Date.now())).digest('hex')
    };
    const agent = { modelEndpoint, modelAuth };
    const output = await callExternalModel(agent, payload);
    const normalized = validateModelResponse(output);
    const sample = normalized.outputs[0];
    res.json({ ok: true, sample });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model test failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/credits/deposit-intent', async (req, res) => {
  try {
    const { ownerPublicKey, amountMina } = req.body ?? {};
    if (!ownerPublicKey) throw new Error('Missing ownerPublicKey');
    const depositAmount = Number(amountMina ?? creditsMinDeposit);
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      throw new Error('Invalid deposit amount');
    }
    if (depositAmount < creditsMinDeposit) {
      throw new Error(`Minimum deposit is ${creditsMinDeposit} MINA`);
    }
    const ownerHash = hashToField(ownerPublicKey);
    const amountField = Field.from(Math.round(depositAmount * 1e9));
    const direction = Field.from(1);
    const leaf = computeCreditsLeaf(ownerHash, amountField, direction);
    const commit = await commitCreditsLeaf(leaf);
    const nullifierRoot = await getCurrentNullifierRoot();
    const { oraclePk, signature } = signCreditsUpdate(commit.newRoot, nullifierRoot);
    const ledger = await readCreditsLedger();
    ledger.pending = ledger.pending || {};
    let balanceBefore: string | null = null;
    try {
      const zkappPublicKey = getZkappPublicKey();
      if (zkappPublicKey) {
        const account = await fetchAccount({ publicKey: PublicKey.fromBase58(zkappPublicKey) });
        const balance = account?.account?.balance?.toString?.();
        if (balance) balanceBefore = balance;
      }
    } catch {
      balanceBefore = null;
    }
    const pendingKey = `${ownerPublicKey}:${commit.newRoot.toJSON()}`;
    ledger.pending[pendingKey] = {
      ownerPublicKey,
      amountMina: depositAmount,
      creditsRoot: commit.newRoot.toJSON(),
      nullifierRoot: nullifierRoot.toJSON(),
      balanceBefore,
      createdAt: new Date().toISOString()
    };
    await writeCreditsLedger(ledger);

    res.json({
      ownerPublicKey,
      balanceMina: ledger.balances[ownerPublicKey] || 0,
      payload: {
        creditsRoot: commit.newRoot.toJSON(),
        nullifierRoot: nullifierRoot.toJSON(),
        oraclePublicKey: oraclePk.toBase58(),
        signature: signature.toJSON(),
        depositMina: depositAmount,
        creditsMinDeposit
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credits deposit intent failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/credits/spend-intent', async (req, res) => {
  try {
    const { ownerPublicKey, requestId, amountMina } = req.body ?? {};
    if (!ownerPublicKey) throw new Error('Missing ownerPublicKey');
    if (!requestId) throw new Error('Missing requestId');
    const spendAmount = Number(amountMina);
    if (!Number.isFinite(spendAmount) || spendAmount <= 0) {
      throw new Error('Invalid spend amount');
    }
    const ledger = await readCreditsLedger();
    const current = ledger.balances[ownerPublicKey] || 0;
    if (current < spendAmount) {
      throw new Error('Insufficient credits balance');
    }
    const ownerHash = hashToField(ownerPublicKey);
    const nonceHash = hashToField(String(requestId));
    const nullifierKey = `${ownerHash.toJSON()}:${nonceHash.toJSON()}`;
    const nullifiers = await readNullifierSet();
    if (nullifiers.nullifiers[nullifierKey]) {
      const slashAmount = Math.min(current, spendAmount);
      ledger.balances[ownerPublicKey] = Math.max(0, current - slashAmount);
      ledger.slashes = ledger.slashes || [];
      ledger.slashes.push({
        ownerPublicKey,
        requestId,
        reason: 'double-spend',
        amountMina: slashAmount,
        timestamp: new Date().toISOString()
      });
      await writeCreditsLedger(ledger);
      throw new Error(`Double-spend detected. Slashed ${slashAmount.toFixed(2)} MINA.`);
    }
    nullifiers.nullifiers[nullifierKey] = {
      timestamp: new Date().toISOString(),
      amountMina: spendAmount
    };
    await writeNullifierSet(nullifiers);

    const nullifierLeaf = computeNullifierLeaf(ownerHash, nonceHash);
    const nullifierCommit = await commitNullifierLeaf(nullifierLeaf);
    const amountField = Field.from(Math.round(spendAmount * 1e9));
    const direction = Field.from(0);
    const creditsCommit = await commitCreditsLeaf(computeCreditsLeaf(ownerHash, amountField, direction));

  const platformFee = Number(platformFeeMina || 0);
    const { oraclePk, signature } = signCreditsUpdate(
      creditsCommit.newRoot,
      nullifierCommit.newRoot,
      amountField,
      Field.from(Math.round(platformFee * 1e9))
    );

    ledger.balances[ownerPublicKey] = Math.max(0, current - spendAmount);
    await writeCreditsLedger(ledger);

    const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
    const request = requestsStore.requests.find((entry) => entry.id === requestId);
    if (request) {
      request.creditsSpentMina = spendAmount;
      request.creditsOwner = ownerPublicKey;
      request.status = 'AWAITING_CREDITS_TX';
      await writeJson(requestsPath, requestsStore);
    }

    const spendTo = request?.treasuryPublicKey || resolveTreasuryKey();
    if (!spendTo) {
      throw new Error('Missing model treasury for credits spend');
    }

    const relayerPayee = getRelayerPublicKey() || platformTreasuryKey;

    res.json({
      ownerPublicKey,
      balanceMina: ledger.balances[ownerPublicKey],
      payload: {
        creditsRoot: creditsCommit.newRoot.toJSON(),
        nullifierRoot: nullifierCommit.newRoot.toJSON(),
        oraclePublicKey: oraclePk.toBase58(),
        signature: signature.toJSON(),
        depositMina: 0,
        spendTo,
        spendAmountMina: spendAmount,
        platformAmountMina: platformFee,
        platformPayee: relayerPayee
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credits spend intent failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/credits/confirm', async (req, res) => {
  try {
    const { ownerPublicKey, creditsRoot, txHash } = req.body ?? {};
    if (!ownerPublicKey || !creditsRoot || !txHash) {
      throw new Error('Missing ownerPublicKey, creditsRoot, or txHash');
    }
    let confirmed = false;
    try {
      const txStatus = await fetchTransactionStatus(txHash);
      confirmed = Boolean(txStatus && txStatus !== 'PENDING' && txStatus !== 'UNKNOWN');
    } catch {
      confirmed = false;
    }
    const ledger = await readCreditsLedger();
    const pendingKey = `${ownerPublicKey}:${creditsRoot}`;
    const pending = ledger.pending?.[pendingKey];
    if (!pending) {
      throw new Error('No pending credits for this deposit');
    }
    if (!confirmed) {
      try {
        const zkappPublicKey = getZkappPublicKey();
        if (zkappPublicKey && pending.balanceBefore) {
          const account = await fetchAccount({ publicKey: PublicKey.fromBase58(zkappPublicKey) });
          const after = account?.account?.balance?.toString?.();
          if (after) {
            const beforeNano = BigInt(pending.balanceBefore);
            const afterNano = BigInt(after);
            const diff = afterNano - beforeNano;
            const expected = BigInt(Math.round(Number(pending.amountMina) * 1e9));
            if (diff >= expected) {
              confirmed = true;
            }
          }
        }
      } catch {
        confirmed = false;
      }
    }
    if (!confirmed) {
      throw new Error('Credits transaction not yet confirmed on-chain');
    }
    ledger.balances[ownerPublicKey] = (ledger.balances[ownerPublicKey] || 0) + pending.amountMina;
    ledger.pending = ledger.pending || {};
    delete ledger.pending[pendingKey];
    ledger.confirms = ledger.confirms || [];
    ledger.confirms.push({
      ownerPublicKey,
      creditsRoot,
      txHash,
      amountMina: pending.amountMina,
      confirmedAt: new Date().toISOString()
    });
    await writeCreditsLedger(ledger);
    res.json({ ok: true, balanceMina: ledger.balances[ownerPublicKey] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credits confirm failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/credits/balance', async (req, res) => {
  try {
    const ownerPublicKey = String(req.query.ownerPublicKey || '');
    if (!ownerPublicKey) {
      throw new Error('Missing ownerPublicKey');
    }
    const ledger = await readCreditsLedger();
    const balance = ledger.balances[ownerPublicKey] || 0;
    res.json({ ownerPublicKey, balanceMina: balance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credits balance lookup failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/edgar', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const data = await readJson<Record<string, any>>(edgarPath, {});
  if (!symbol || !data[symbol]) {
    return res.status(404).json({ error: 'Symbol not found in sample dataset.' });
  }
  return res.json(data[symbol]);
});

app.post('/api/intent', async (req, res) => {
  try {
    const { agentId, prompt, requester, useCredits } = req.body ?? {};
    const result = await createIntentCore({ agentId, prompt, requester, useCredits });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create intent';
    res.status(400).json({ error: message });
  }
});

app.post('/api/tx', async (req, res) => {
  try {
    const { payload } = req.body ?? {};
    const feePayer = parseFeePayer(req.body);
    const result = await buildUnsignedTx(payload, feePayer);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transaction build failed';
    res.status(400).json({ error: message });
  }
});


app.post('/api/output-tx', async (req, res) => {
  try {
    const { payload } = req.body ?? {};
    const feePayer = parseFeePayer(req.body);
    const result = await buildUnsignedOutputTx(payload, feePayer);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transaction build failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/credits-tx', async (req, res) => {
  try {
    const { payload } = req.body ?? {};
    const feePayer = parseFeePayer(req.body);
    const result = await buildUnsignedCreditsTx(payload, feePayer);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credits transaction build failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/output-attest-submit', async (req, res) => {
  try {
    const { payload } = req.body ?? {};
    const result = await buildAndSendOutputTxWithSponsor(payload);
    res.json({ hash: result.hash || 'submitted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Output attest submit failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/credits-spend-submit', async (req, res) => {
  try {
    const { payload } = req.body ?? {};
    const result = await buildAndSendCreditsTxWithSponsor(payload);
    res.json({ hash: result.hash || 'submitted' });
  } catch (err) {
    console.error('credits-spend-submit failed:', err);
    const message = err instanceof Error ? err.message : 'Credits spend submit failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/agent-stake-tx', async (req, res) => {
  try {
    const { payload, feePayer } = req.body ?? {};
    if (!feePayer || typeof feePayer !== 'string') {
      throw new Error('Missing feePayer');
    }
    const network = getNetwork();
    if (!network.graphql) {
      throw new Error('ZEKO_GRAPHQL env var not set');
    }
    const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
    const zkappPublicKey = getZkappPublicKey();
    if (!zkappPublicKey || !zkappPrivateKey) {
      throw new Error('ZKAPP_PUBLIC_KEY and ZKAPP_PRIVATE_KEY must be set');
    }
    const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
    if (derived !== zkappPublicKey) {
      throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
    }

    await ensureContractCompiled();
    const networkInstance = Mina.Network({
      networkId: network.networkId as any,
      mina: network.graphql,
      archive: network.graphql
    });
    Mina.setActiveInstance(networkInstance);

    const fee = process.env.TX_FEE ?? '100000000';
    const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
    const zkapp = new AgentRequestContract(zkappAddress);
    const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
    if (zkappAccount.error) {
      throw new Error('ZkApp account not found on-chain');
    }

    const agentIdHash = Field.fromJSON(payload.agentIdHash);
    const ownerHash = Field.fromJSON(payload.ownerHash);
    const treasuryHash = Field.fromJSON(payload.treasuryHash);
    const stakeAmountField = Field.fromJSON(payload.stakeAmount);
    let oraclePk: PublicKey;
    try {
      oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
    } catch {
      throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
    }
    let signature: Signature;
    try {
      signature = Signature.fromJSON(payload.signature as any);
    } catch {
      throw new Error('Invalid signature payload (base58 parse failed)');
    }
    const newRoot = Field.fromJSON(payload.merkleRoot);

    let feePayerPk: PublicKey;
    try {
      feePayerPk = PublicKey.fromBase58(feePayer);
    } catch {
      throw new Error(`Invalid feePayer public key: ${redactKey(feePayer)}`);
    }

    const tx = await Mina.transaction({ sender: feePayerPk, fee }, async () => {
      await zkapp.registerAgent(agentIdHash, ownerHash, treasuryHash, stakeAmountField, oraclePk, signature, newRoot);
    });

    // Non-magic fee payer handling: remove nonce precondition and require full commitment
    const feePayerUpdate = (tx as any).feePayer;
    if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
      feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
    }
    if (feePayerUpdate?.body) {
      feePayerUpdate.body.useFullCommitment = Bool(true);
    }

    await tx.prove();
    const txJson = tx.toJSON() as any;
    res.json({ tx: txJson, fee, networkId: network.networkId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent stake transaction failed';
    res.status(400).json({ error: message });
  }
});


app.post('/api/fulfill', async (req, res) => {
  try {
    const { requestId, txHash, creditTxHash, accessToken } = req.body ?? {};
    const result = await fulfillCore({ requestId, txHash, creditTxHash, accessToken });
    res.json(result);
  } catch (err) {
    if (err instanceof Error && (err as any).statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Fulfillment failed';
    res.status(400).json({ error: message });
  }
});


app.post('/api/status', async (req, res) => {
  try {
    const { hash } = req.body ?? {};
    if (!hash) throw new Error('Missing hash');
    if (!process.env.ZEKO_GRAPHQL) {
      throw new Error('ZEKO_GRAPHQL not configured');
    }
    const networkId = process.env.ZEKO_NETWORK_ID ?? 'zeko';
    const network = Mina.Network({
      networkId: networkId as any,
      mina: process.env.ZEKO_GRAPHQL,
      archive: process.env.ZEKO_GRAPHQL
    });
    Mina.setActiveInstance(network);
    const status = await fetchTransactionStatus(hash);
    res.json({ status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status check failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/requests/:id', async (req, res) => {
  const requestId = req.params.id;
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const request = requestsStore.requests.find((entry) => entry.id === requestId);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  if (!request.accessTokenHash) {
    return res.json(request);
  }
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const accessToken = bearer || String(req.query.accessToken || '');
  const hasToken = accessToken && request.accessTokenHash === hashAccessToken(accessToken);
  if (!hasToken) {
    const redacted = { ...request };
    redacted.output = null;
    redacted.outputEncrypted = Boolean(request.outputEncrypted);
    return res.status(403).json({ error: 'Unauthorized', request: redacted });
  }
  if (request.outputEncrypted) {
    try {
      const key = await getOutputEncryptionKey();
      const decrypted = decryptPayload(request.outputEncrypted, key);
      return res.json({ ...request, output: decrypted });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to decrypt output' });
    }
  }
  return res.json(request);
});

app.post('/api/requests/:id/challenge', async (req, res) => {
  const requestId = req.params.id;
  const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
  const request = requestsStore.requests.find((entry) => entry.id === requestId);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  if (!request.requester) {
    return res.status(400).json({ error: 'Request has no requester public key' });
  }
  const nonce = crypto.randomBytes(8).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const message = `Zeko AI Marketplace\nRequest:${requestId}\nNonce:${nonce}\nExpires:${expiresAt}`;
  request.authChallenge = { message, expiresAt };
  await writeJson(requestsPath, requestsStore);
  res.json({ message, expiresAt });
});

app.post('/api/requests/:id/reveal', async (req, res) => {
  try {
    const requestId = req.params.id;
    const { publicKey, signature } = req.body ?? {};
    if (!publicKey || !signature) {
      return res.status(400).json({ error: 'Missing publicKey or signature' });
    }
    const requestsStore = await readJson<{ requests: any[] }>(requestsPath, { requests: [] });
    const request = requestsStore.requests.find((entry) => entry.id === requestId);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!request.requester) {
      return res.status(400).json({ error: 'Request has no requester public key' });
    }
    if (request.requester !== publicKey) {
      return res.status(403).json({ error: 'Public key does not match requester' });
    }
    const challenge = request.authChallenge;
    if (!challenge || !challenge.message || !challenge.expiresAt) {
      return res.status(400).json({ error: 'No active challenge' });
    }
    if (Date.now() > challenge.expiresAt) {
      return res.status(400).json({ error: 'Challenge expired' });
    }
    const valid = verifySignedMessage(publicKey, signature, challenge.message);
    if (!valid) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
    if (request.outputEncrypted) {
      const key = await getOutputEncryptionKey();
      const decrypted = decryptPayload(request.outputEncrypted, key);
      return res.json({ ...request, output: decrypted });
    }
    return res.json(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reveal failed';
    res.status(400).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Zeko AI Marketplace running on http://localhost:${port}`);
  console.log(`PRECOMPILE_ZKAPP=${String(precompileZkapp)} DEBUG_TX_TIMING=${String(debugTxTiming)}`);
});

ensureMassiveFlatfilesFresh();
ensureSymbolIndexFresh();
if (precompileZkapp) {
  ensureContractCompiled().catch((err) => {
    console.warn('Precompile failed:', err instanceof Error ? err.message : err);
  });
}

(async () => {
  try {
    await ensureSeedData();
    const migration = await mergeSeedRequests({ onlyIfMissingNonAlpha: true });
    if (migration.added > 0) {
      console.log(`[startup] merged ${migration.added} seeded requests for missing non-alpha history`);
    }
    await logRequestStats('startup');
  } catch (err) {
    console.warn('Startup data init failed:', err instanceof Error ? err.message : err);
  }
})();
