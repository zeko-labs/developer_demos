import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const SEPOLIA_ZEKO_GRAPHQL = 'https://sepolia.zeko.io/graphql';
function isSepoliaGraphqlEndpoint(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && url.hostname === 'sepolia.zeko.io' && url.pathname === '/graphql';
  } catch {
    return false;
  }
}

const CONFIGURED_ZEKO_GRAPHQL = String(process.env.ZEKO_GRAPHQL || '').trim();
const ZEKO_GRAPHQL = isSepoliaGraphqlEndpoint(CONFIGURED_ZEKO_GRAPHQL)
  ? CONFIGURED_ZEKO_GRAPHQL
  : SEPOLIA_ZEKO_GRAPHQL;
const CONFIGURED_ZEKO_NETWORK_ID = String(process.env.ZEKO_NETWORK_ID || '').trim();
const ZEKO_NETWORK_ID = isSepoliaGraphqlEndpoint(ZEKO_GRAPHQL)
  ? 'testnet'
  : CONFIGURED_ZEKO_NETWORK_ID || 'zeko';
const ZEKO_TX_GRAPHQL_ENV = isSepoliaGraphqlEndpoint(process.env.ZEKO_TX_GRAPHQL) ? process.env.ZEKO_TX_GRAPHQL : '';
const ZEKO_ARCHIVE_GRAPHQL = isSepoliaGraphqlEndpoint(process.env.ZEKO_ARCHIVE_GRAPHQL) ? process.env.ZEKO_ARCHIVE_GRAPHQL : '';
const ZEKO_ARCHIVE_RELAY_GRAPHQL = isSepoliaGraphqlEndpoint(process.env.ZEKO_ARCHIVE_RELAY_GRAPHQL)
  ? process.env.ZEKO_ARCHIVE_RELAY_GRAPHQL
  : '';
const ZEKO_TX_GRAPHQL =
  ZEKO_TX_GRAPHQL_ENV ||
  ZEKO_ARCHIVE_RELAY_GRAPHQL ||
  ZEKO_ARCHIVE_GRAPHQL ||
  ZEKO_GRAPHQL;
const DEFAULT_NATIVE_TOKEN_ID = 'wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf';
const DEFAULT_SZEKO_TOKEN_ID = 'xpAptwG79jEStACsCv9C6yXUBmKbvurUo8GsTPYapn9QWB5zE5';
const DEFAULT_MARKET_DEFINITIONS = [
  {
    symbol: 'sETH/sZEKO',
    baseAsset: 'sETH',
    quoteAsset: 'sZEKO',
    baseTokenId: DEFAULT_NATIVE_TOKEN_ID,
    quoteTokenId: DEFAULT_SZEKO_TOKEN_ID,
    referencePrice: 12
  }
];
const DEFAULT_ASSET_DECIMALS = { SETH: 9, SZEKO: 9 };
const DEFAULT_TOKEN_CONTRACT_ADDRESSES = {
  SETH: '',
  SZEKO: 'B62qpCuSDoTuL8dUcNfuoLoas8A77gRHJTp4WVe5NF2phXbQUNwNZ3W'
};
const pairs = new Map();
const marketsById = new Map();
const marketsByTokenKey = new Map();

const accounts = new Map();
const orders = new Map();
const books = new Map();
const publicTape = [];
const privateFillsByOrder = new Map();
const orderIssuedNotes = new Map();
const notes = new Map();
const spentNullifiers = new Set();
const sequencingReceiptsByCommitment = new Map();
const privateStateJournal = [];
const poolTotals = {};
const withdrawals = [];
const activityEvents = [];
const frontendFeeLedger = new Map();
const protocolFeeBalances = {};
const participantWallets = new Map();
const depositIntents = new Map();
const ACTIVITY_PRIVACY_MODE = String(process.env.ACTIVITY_PRIVACY_MODE || 'redacted').trim().toLowerCase();
const OPERATOR_ACTIVITY_REDACTION_ENABLED = ACTIVITY_PRIVACY_MODE !== 'verbose';
const WALLET_HASH_SALT = process.env.WALLET_HASH_SALT || 'shadowbook-demo-salt';
const DARKPOOL_HOST = process.env.DARKPOOL_HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const AUTO_RUN_BACKGROUND_WORKERS = String(process.env.AUTO_RUN_BACKGROUND_WORKERS || 'false').toLowerCase() === 'true';
const AUTO_RUN_PROOF_WORKER = String(process.env.AUTO_RUN_PROOF_WORKER || String(AUTO_RUN_BACKGROUND_WORKERS)).toLowerCase() === 'true';
const AUTO_RUN_SETTLEMENT_WORKER = String(process.env.AUTO_RUN_SETTLEMENT_WORKER || String(AUTO_RUN_BACKGROUND_WORKERS)).toLowerCase() === 'true';
const ZKAPP_COMMIT_MAX_OLD_SPACE_MB = Math.max(
  0,
  Number.parseInt(process.env.ZKAPP_COMMIT_MAX_OLD_SPACE_MB || '4096', 10) || 4096
);
const BACKGROUND_WORKER_RESTART_DELAY_MS = Math.max(
  1000,
  Number.parseInt(process.env.BACKGROUND_WORKER_RESTART_DELAY_MS || '3000', 10) || 3000
);
const PROOF_WORKER_API_KEY = String(process.env.PROOF_WORKER_API_KEY || '').trim();
const ZEKO_FAUCET_COMMAND = String(process.env.ZEKO_FAUCET_COMMAND || 'npx -y @zeko-labs/faucet-cli').trim();
const ZEKO_FAUCET_GITHUB_TOKEN = String(
  process.env.ZEKO_FAUCET_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
).trim();
const REAL_FUNDS_MODE = true;
// Secure mode is design-only here. Do not label this runtime operator-confidential
// until an encrypted matcher and attested execution boundary are wired in.
const SECURE_MODE_IMPLEMENTED = false;
const ONCHAIN_SYNC_TTL_MS = Number.parseInt(process.env.ONCHAIN_SYNC_TTL_MS || '60000', 10);
function normalizeAssetMapKey(value) {
  return String(value || '').trim().toUpperCase();
}

function parseUpperNumberMap(jsonRaw, fallback) {
  const result = { ...fallback };
  try {
    const parsed = JSON.parse(jsonRaw || '{}');
    for (const [key, value] of Object.entries(parsed || {})) {
      if (!key) continue;
      const normalized = normalizeAssetMapKey(key);
      const numeric = Number(value);
      if (Number.isFinite(numeric)) result[normalized] = numeric;
    }
  } catch {}
  return result;
}

function parseUpperStringMap(jsonRaw, fallback) {
  const result = { ...fallback };
  try {
    const parsed = JSON.parse(jsonRaw || '{}');
    for (const [key, value] of Object.entries(parsed || {})) {
      if (!key || typeof value !== 'string') continue;
      result[normalizeAssetMapKey(key)] = value.trim();
    }
  } catch {}
  return result;
}

function parseSupportedAssetPairs(jsonRaw) {
  try {
    const parsed = JSON.parse(jsonRaw || '[]');
    if (!Array.isArray(parsed)) return null;
    const normalized = parsed
      .map((entry) => {
        const symbol = typeof entry?.symbol === 'string' ? entry.symbol.trim() : '';
        const baseAsset = typeof entry?.baseAsset === 'string' ? entry.baseAsset.trim() : '';
        const quoteAsset = typeof entry?.quoteAsset === 'string' ? entry.quoteAsset.trim() : '';
        if (!symbol || !baseAsset || !quoteAsset) return null;
        const referencePrice = Number(entry?.referencePrice);
        return {
          symbol,
          baseAsset,
          quoteAsset,
          baseTokenId: typeof entry?.baseTokenId === 'string' ? entry.baseTokenId.trim() : '',
          quoteTokenId: typeof entry?.quoteTokenId === 'string' ? entry.quoteTokenId.trim() : '',
          referencePrice: Number.isFinite(referencePrice) ? referencePrice : 1
        };
      })
      .filter(Boolean);
    return normalized.length ? normalized : null;
  } catch {
    return null;
  }
}

async function deriveTokenIdFromAddress(tokenAddress58) {
  const address = String(tokenAddress58 || '').trim();
  if (!address) return '';
  const [{ PublicKey, TokenId }] = await Promise.all([import('o1js')]);
  return TokenId.toBase58(TokenId.derive(PublicKey.fromBase58(address)));
}

const ASSET_DECIMALS = (() => {
  return parseUpperNumberMap(process.env.ASSET_DECIMALS_JSON || '{}', DEFAULT_ASSET_DECIMALS);
})();
const TOKEN_CONTRACT_ADDRESSES = (() => {
  return parseUpperStringMap(process.env.TOKEN_CONTRACT_ADDRESSES_JSON || '{}', DEFAULT_TOKEN_CONTRACT_ADDRESSES);
})();
const MAKER_API_KEY = process.env.MAKER_API_KEY || 'demo-maker-key';
const SERVER_BUILD_ID = 'matcher-debug-v3';
const TAKER_FEE_BPS = Number.parseFloat(process.env.TAKER_FEE_BPS || '5');
const FRONTEND_FEE_SHARE_BPS = Number.parseFloat(process.env.FRONTEND_FEE_SHARE_BPS || '3000');
const MARKET_ORDER_SLIPPAGE_BPS = Number.parseFloat(process.env.MARKET_ORDER_SLIPPAGE_BPS || '100');
const GTC_ORDER_EXPIRY_MS = Number.parseInt(process.env.GTC_ORDER_EXPIRY_MS || '0', 10);
const SETTLEMENT_PROCEEDS_AS_NOTES =
  String(process.env.SETTLEMENT_PROCEEDS_AS_NOTES || String(!process.env.RENDER)).toLowerCase() === 'true';
const ORDER_RECEIPT_SECRET = process.env.ORDER_RECEIPT_SECRET || 'shadowbook-receipt-secret';

const WALLET_NETWORK_CONFIG = {
  key: 'zekoEthereumSepolia',
  label: 'Zeko Ethereum Sepolia',
  networkId: ZEKO_NETWORK_ID,
  graphqlUrl: ZEKO_GRAPHQL,
  chainType: 'zeko-on-ethereum'
};
const INTERNAL_SERVICE_SECRET = String(process.env.INTERNAL_SERVICE_SECRET || ORDER_RECEIPT_SECRET || 'shadowbook-internal-service').trim();
const EARLY_ACCESS_COOKIE_NAME = String(process.env.EARLY_ACCESS_COOKIE_NAME || 'shadowbook_access').trim() || 'shadowbook_access';
const EARLY_ACCESS_COOKIE_SECRET = String(process.env.EARLY_ACCESS_COOKIE_SECRET || ORDER_RECEIPT_SECRET || 'shadowbook-access-secret');
const EARLY_ACCESS_CODES = Array.from(
  new Set(
    String(process.env.EARLY_ACCESS_CODES || '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
);
const EARLY_ACCESS_GATE_ENABLED =
  String(process.env.EARLY_ACCESS_GATE_ENABLED || 'false').toLowerCase() === 'true';
const AUTO_SETTLEMENT = String(process.env.AUTO_SETTLEMENT || 'false').toLowerCase() === 'true';
const AUTO_SETTLEMENT_INTERVAL_MS = Number.parseInt(process.env.AUTO_SETTLEMENT_INTERVAL_MS || '5000', 10);
const ENABLE_LOCAL_SETTLEMENT = String(process.env.ENABLE_LOCAL_SETTLEMENT || 'false').toLowerCase() === 'true';
const ORDER_STATE_ENCRYPTION_KEY = process.env.ORDER_STATE_ENCRYPTION_KEY || '';
const RESET_OPEN_ORDERS_ON_BOOT =
  String(process.env.RESET_OPEN_ORDERS_ON_BOOT || 'false').toLowerCase() === 'true';
const BOOK_ANCHOR_INTERVAL_MS = Number.parseInt(process.env.BOOK_ANCHOR_INTERVAL_MS || '0', 10);
const DA_MODE = String(process.env.DA_MODE || 'http-json').trim().toLowerCase();
const DA_ENDPOINT = process.env.DA_ENDPOINT || '';
const DA_BEARER_TOKEN = process.env.DA_BEARER_TOKEN || '';
const DA_REQUIRE_ENCRYPTION = String(process.env.DA_REQUIRE_ENCRYPTION || 'true').toLowerCase() === 'true';
const DA_INCLUDE_ORDER_SNAPSHOT = String(process.env.DA_INCLUDE_ORDER_SNAPSHOT || 'false').toLowerCase() === 'true';
const DA_ENCRYPTION_KEY = process.env.DA_ENCRYPTION_KEY || ORDER_STATE_ENCRYPTION_KEY || ORDER_RECEIPT_SECRET;
const ZEKO_DA_NETWORK = process.env.ZEKO_DA_NETWORK || 'zeko:testnet';
const ZEKO_DA_APP_ID = process.env.ZEKO_DA_APP_ID || 'shadowbook';
const ZEKO_DA_SCHEMA = process.env.ZEKO_DA_SCHEMA || 'shadowbook.da.v1';
const VAULT_DEPOSIT_ADDRESS = process.env.VAULT_DEPOSIT_ADDRESS || '';
const REQUIRE_ONCHAIN_DEPOSIT_TX =
  String(process.env.REQUIRE_ONCHAIN_DEPOSIT_TX || 'true').toLowerCase() === 'true';
const ALLOW_WALLET_TX_HASH_FALLBACK =
  String(process.env.ALLOW_WALLET_TX_HASH_FALLBACK || 'true').toLowerCase() === 'true';
const TX_FEE = String(process.env.TX_FEE || '200000').trim();
const SEQUENCER_FEE_MODE = String(process.env.SEQUENCER_FEE_MODE || 'static').trim().toLowerCase();
const ZEKO_SETTLEMENT_GRAPHQL = isSepoliaGraphqlEndpoint(process.env.ZEKO_SETTLEMENT_GRAPHQL)
  ? process.env.ZEKO_SETTLEMENT_GRAPHQL
  : ZEKO_GRAPHQL;
const ZKAPP_PUBLIC_KEY = process.env.ZKAPP_PUBLIC_KEY || '';
const OPERATOR_PUBLIC_KEY = process.env.OPERATOR_PUBLIC_KEY || '';
const OPERATOR_PANEL_ALLOWED_WALLET = String(process.env.OPERATOR_PANEL_ALLOWED_WALLET || '').trim();
const OPERATOR_PANEL_ADMIN_KEY = String(process.env.OPERATOR_PANEL_ADMIN_KEY || '').trim();
const SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS =
  String(process.env.SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS || 'true').toLowerCase() === 'true';
const SEQUENCER_PUBLIC_KEY = OPERATOR_PUBLIC_KEY || VAULT_DEPOSIT_ADDRESS || '';
const SETTLEMENT_PAYOUT_COMMAND = String(process.env.SETTLEMENT_PAYOUT_COMMAND || '').trim();
const SETTLEMENT_BATCH_MAX_TRADES = Math.max(1, Number.parseInt(process.env.SETTLEMENT_BATCH_MAX_TRADES || '8', 10) || 8);
const SETTLEMENT_BATCH_MAX_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.SETTLEMENT_BATCH_MAX_DELAY_MS || '10000', 10) || 10000
);
const PRIVATE_STATE_BATCH_MAX_EVENTS = Math.max(16, SETTLEMENT_BATCH_MAX_TRADES * 8);
const settlementBatches = [];
const usedOperatorAuthNonces = new Map();
let nextSettlementBatchId = 1;
let settlementBatchesPath = null;
let engineStatePath = null;
let auditLogPath = null;
let earlyAccessStatePath = null;
let auditHeadHash = 'genesis';
let auditWriteChain = Promise.resolve();
let engineStateWriteChain = Promise.resolve();
let earlyAccessWriteChain = Promise.resolve();
let fungibleTokenCompilePromise = null;
const auditTrail = [];
let auditGapDetected = false;
let auditGapIndex = null;
let auditGapExpectedPrevHash = null;
let auditGapActualPrevHash = null;
let lastAnchoredBookHash = null;
let nextOrderSequenceNumber = 1;
const usedDepositTxHashes = new Set();
const usedSettlementPayoutTxHashes = new Set();
const earlyAccessState = {
  allowedIps: {},
  usedCodes: {}
};
const startedAtUnixMs = now();
const engineMetrics = {
  orderAcceptedCount: 0,
  orderRejectedCount: 0,
  cancelCount: 0,
  fillCount: 0,
  matchCallCount: 0,
  matchLastMs: 0,
  matchMaxMs: 0,
  matchTotalMs: 0,
  lastOrderAtUnixMs: null,
  lastFillAtUnixMs: null
};

function now() {
  return Date.now();
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeIpAddress(rawIp) {
  const value = String(rawIp || '').trim();
  if (!value) return '';
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  return value;
}

function getRequestIp(req) {
  const forwarded = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
  const candidate = forwarded.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  return normalizeIpAddress(candidate);
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const cookies = {};
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.split('=');
    const key = String(name || '').trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join('=').trim());
  }
  return cookies;
}

function makeEarlyAccessCodeHash(code) {
  return sha256Hex(`shadowbook-early-access:${String(code || '').trim()}`);
}

function signEarlyAccessCookie(ip) {
  const payload = `${normalizeIpAddress(ip)}|${EARLY_ACCESS_COOKIE_SECRET}`;
  const signature = sha256Hex(payload);
  return `${normalizeIpAddress(ip)}.${signature}`;
}

function verifyEarlyAccessCookie(cookieValue, ip) {
  const token = String(cookieValue || '').trim();
  if (!token || !token.includes('.')) return false;
  const [tokenIp, signature] = token.split('.', 2);
  const expected = signEarlyAccessCookie(tokenIp);
  if (expected !== `${tokenIp}.${signature}`) return false;
  return normalizeIpAddress(tokenIp) === normalizeIpAddress(ip);
}

function buildEarlyAccessCookieHeader(ip) {
  return `${EARLY_ACCESS_COOKIE_NAME}=${encodeURIComponent(signEarlyAccessCookie(ip))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000`;
}

function getEarlyAccessCodeInventory() {
  const map = new Map();
  for (const code of EARLY_ACCESS_CODES) {
    map.set(makeEarlyAccessCodeHash(code), code);
  }
  return map;
}

function isEarlyAccessAllowed(req) {
  if (!EARLY_ACCESS_GATE_ENABLED) return true;
  const internalKey = String(req.headers['x-internal-service-key'] || '').trim();
  if (INTERNAL_SERVICE_SECRET && internalKey === INTERNAL_SERVICE_SECRET) return true;
  const ip = getRequestIp(req);
  const cookies = parseCookies(req);
  if (ip && earlyAccessState.allowedIps[ip]) return true;
  if (verifyEarlyAccessCookie(cookies[EARLY_ACCESS_COOKIE_NAME], ip)) return true;
  return false;
}

function isProtectedAppPath(pathname) {
  return (
    pathname === '/darkpool' ||
    pathname === '/partner' ||
    pathname.startsWith('/api/darkpool/')
  );
}

function makeMarketId(baseTokenId, quoteTokenId) {
  return `mkt_${sha256Hex(`${baseTokenId}|${quoteTokenId}`).slice(0, 24)}`;
}

function tokenPairKey(baseTokenId, quoteTokenId) {
  return `${baseTokenId}|${quoteTokenId}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function computeNoteNullifier(noteHash, ownerAccountId) {
  return sha256Hex(`note-nullifier:${String(noteHash || '')}:${String(ownerAccountId || '')}`);
}

function deriveSymmetricKey(raw) {
  if (!raw) return null;
  return createHash('sha256').update(String(raw), 'utf8').digest();
}

function encryptJson(value, rawKey) {
  const key = deriveSymmetricKey(rawKey);
  if (!key) return { mode: 'plain', payload: value };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    mode: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

function decryptJson(value, rawKey) {
  if (!value || value.mode === 'plain') return value?.payload ?? value;
  if (value.mode !== 'aes-256-gcm') throw new Error('unsupported engine state encryption mode');
  const key = deriveSymmetricKey(rawKey);
  if (!key) throw new Error('ORDER_STATE_ENCRYPTION_KEY required to decrypt engine state');
  const iv = Buffer.from(String(value.iv || ''), 'base64');
  const tag = Buffer.from(String(value.tag || ''), 'base64');
  const data = Buffer.from(String(value.data || ''), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

function createAuditEntry(eventType, payload) {
  const entry = {
    id: randomUUID(),
    eventType,
    payload,
    createdAtUnixMs: now(),
    prevHash: auditHeadHash
  };
  entry.hash = sha256Hex(stableStringify(entry));
  return entry;
}

function recordAuditEvent(eventType, payload) {
  const auditPayload = OPERATOR_ACTIVITY_REDACTION_ENABLED
    ? {
        privacy: 'operator-redacted',
        commitment: sha256Hex(`${eventType}:${stableStringify(payload || {})}`)
      }
    : payload;
  const entry = createAuditEntry(eventType, auditPayload);
  auditHeadHash = entry.hash;
  auditTrail.unshift(entry);
  if (auditTrail.length > 5000) auditTrail.pop();
  if (auditLogPath) {
    const line = `${JSON.stringify(entry)}\n`;
    auditWriteChain = auditWriteChain.then(() => appendFile(auditLogPath, line, 'utf8')).catch(() => {});
  }
  return entry;
}

function storedActivityDetails(type, details = {}) {
  if (!OPERATOR_ACTIVITY_REDACTION_ENABLED) return details;
  return {
    privacy: 'operator-redacted',
    commitment: sha256Hex(`${type}:${stableStringify(details || {})}`)
  };
}

async function loadAuditHeadFromFile() {
  if (!auditLogPath) return;
  try {
    const raw = await readFile(auditLogPath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (!lines.length) return;
    const tail = lines.slice(-Math.min(lines.length, 1000));
    const chronological = [];
    for (const line of tail) {
      try {
        chronological.push(JSON.parse(line));
      } catch {
      }
    }
    if (!chronological.length) return;

    let startIndex = 0;
    auditGapDetected = false;
    auditGapIndex = null;
    auditGapExpectedPrevHash = null;
    auditGapActualPrevHash = null;
    for (let i = chronological.length - 1; i > 0; i -= 1) {
      const current = chronological[i];
      const prev = chronological[i - 1];
      const clone = {
        id: current.id,
        eventType: current.eventType,
        payload: current.payload,
        createdAtUnixMs: current.createdAtUnixMs,
        prevHash: current.prevHash
      };
      const expectedHash = sha256Hex(stableStringify(clone));
      if (current.hash !== expectedHash || current.prevHash !== prev.hash) {
        startIndex = i;
        auditGapDetected = true;
        auditGapIndex = i;
        auditGapExpectedPrevHash = prev.hash || null;
        auditGapActualPrevHash = current.prevHash || null;
        break;
      }
    }

    const validSuffix = chronological.slice(startIndex);
    const latest = validSuffix[validSuffix.length - 1] || null;
    auditTrail.length = 0;
    for (const entry of [...validSuffix].reverse()) {
      auditTrail.push(entry);
    }
    if (latest?.hash) auditHeadHash = String(latest.hash);
  } catch {
  }
}

function createOrderReceipt(order, participant) {
  const issuedAtUnixMs = now();
  const payload = {
    orderId: order.id,
    participant,
    commitment: order.commitment,
    pair: order.pair,
    side: order.side,
    limitPrice: order.limitPrice,
    quantity: order.quantity,
    timeInForce: order.timeInForce,
    frontendId: order.frontendId || null,
    orderCreatedAtUnixMs: order.createdAtUnixMs,
    issuedAtUnixMs
  };
  const signature = sha256Hex(`${ORDER_RECEIPT_SECRET}|${stableStringify(payload)}`);
  return {
    ...payload,
    signature,
    algorithm: 'sha256'
  };
}

function createSequencingReceipt(order, participant) {
  const issuedAtUnixMs = now();
  const sequenceNumber = nextOrderSequenceNumber++;
  const timestampBucketUnixMs = Math.floor(issuedAtUnixMs / 10000) * 10000;
  const payload = {
    orderId: order.id,
    participant,
    commitment: order.commitment,
    pair: order.pair,
    side: order.side,
    sequenceNumber,
    operatorPublicKey: SEQUENCER_PUBLIC_KEY || null,
    timestampBucketUnixMs,
    issuedAtUnixMs
  };
  const signature = sha256Hex(`${ORDER_RECEIPT_SECRET}|sequencing|${stableStringify(payload)}`);
  const receipt = {
    ...payload,
    signature,
    algorithm: 'sha256'
  };
  const receiptHash = sha256Hex(stableStringify(receipt));
  const stored = {
    ...receipt,
    receiptHash
  };
  sequencingReceiptsByCommitment.set(order.commitment, stored);
  order.sequenceNumber = sequenceNumber;
  order.sequencingReceiptHash = receiptHash;
  appendPrivateStateJournalEntry({
    kind: 'sequencing_receipt',
    receiptHash,
    orderId: order.id,
    participant,
    commitment: order.commitment,
    pair: order.pair,
    side: order.side,
    sequenceNumber,
    operatorPublicKey: stored.operatorPublicKey,
    timestampBucketUnixMs,
    issuedAtUnixMs
  });
  ensurePrivateStateBatch('sequencing_receipt', participant).catch(() => {});
  return stored;
}

function verifyAuditChain(entriesNewestFirst) {
  const chronological = [...entriesNewestFirst].reverse();
  for (let i = 0; i < chronological.length; i += 1) {
    const entry = chronological[i];
    const clone = {
      id: entry.id,
      eventType: entry.eventType,
      payload: entry.payload,
      createdAtUnixMs: entry.createdAtUnixMs,
      prevHash: entry.prevHash
    };
    const expectedHash = sha256Hex(stableStringify(clone));
    if (i > 0 && entry.prevHash !== chronological[i - 1].hash) return false;
    if (entry.hash !== expectedHash) return false;
  }
  return true;
}

function getAuditChainStatus(entriesNewestFirst) {
  const chronological = [...entriesNewestFirst].reverse();
  for (let i = 0; i < chronological.length; i += 1) {
    const entry = chronological[i];
    const clone = {
      id: entry.id,
      eventType: entry.eventType,
      payload: entry.payload,
      createdAtUnixMs: entry.createdAtUnixMs,
      prevHash: entry.prevHash
    };
    const expectedHash = sha256Hex(stableStringify(clone));
    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        breakIndex: i,
        reason: 'hash_mismatch',
        expectedHash,
        actualHash: entry.hash || null
      };
    }
    if (i > 0 && entry.prevHash !== chronological[i - 1].hash) {
      return {
        valid: false,
        breakIndex: i,
        reason: 'prev_hash_mismatch',
        expectedPrevHash: chronological[i - 1].hash || null,
        actualPrevHash: entry.prevHash || null
      };
    }
  }
  return {
    valid: true,
    breakIndex: null,
    reason: null
  };
}

function startManagedBackgroundProcess(name, command, envOverrides = {}) {
  let child = null;
  let stopped = false;

  const start = () => {
    if (stopped) return;
    console.log(`[background:${name}] starting: ${command}`);
    child = spawn(command, {
      cwd: projectRoot,
      shell: true,
      env: {
        ...process.env,
        ...envOverrides
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      const text = String(chunk).trimEnd();
      if (text) console.log(`[background:${name}] ${text}`);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trimEnd();
      if (text) console.error(`[background:${name}] ${text}`);
    });
    child.on('exit', (code, signal) => {
      const outcome = signal ? `signal=${signal}` : `code=${code}`;
      console.warn(`[background:${name}] exited (${outcome})`);
      child = null;
      if (!stopped) {
        setTimeout(start, BACKGROUND_WORKER_RESTART_DELAY_MS);
      }
    });
  };

  start();
  return () => {
    stopped = true;
    if (child && !child.killed) child.kill('SIGTERM');
  };
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function requirePositiveNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be a positive number`);
  return value;
}

function requireMakerAuth(req) {
  const key = String(req.headers['x-maker-key'] || '');
  if (!key || key !== MAKER_API_KEY) {
    throw new Error('maker auth failed');
  }
}

function requireProofWorkerAuth(req) {
  if (!PROOF_WORKER_API_KEY) {
    throw new Error('proof worker api key is not configured');
  }
  const key = String(req.headers['x-proof-worker-key'] || '').trim();
  if (!key || key !== PROOF_WORKER_API_KEY) {
    throw new Error('proof worker auth failed');
  }
}

function deriveBlindedAccountId(bodyOrQuery) {
  const wallet = typeof bodyOrQuery.wallet === 'string' ? bodyOrQuery.wallet.trim() : '';
  if (wallet.length > 0) {
    const accountId = `acct_${sha256Hex(`${WALLET_HASH_SALT}:${wallet.toLowerCase()}`).slice(0, 16)}`;
    participantWallets.set(accountId, wallet);
    return accountId;
  }
  const participant = typeof bodyOrQuery.participant === 'string' ? bodyOrQuery.participant.trim().toLowerCase() : '';
  if (participant.length >= 3) return `legacy_${participant}`;
  throw new Error('wallet is required (or legacy participant >= 3 chars)');
}

function getPair(value) {
  const pair = requireString(value, 'pair').toUpperCase();
  const config = pairs.get(pair);
  if (!config) throw new Error(`unsupported pair ${pair}`);
  return config;
}

function getPairConfigBySymbol(pairSymbol) {
  const symbol = String(pairSymbol || '').trim();
  if (!symbol) return null;
  for (const config of pairs.values()) {
    if (config.symbol === symbol) return config;
  }
  return null;
}

function canonicalAssetKey(asset) {
  return normalizeAssetMapKey(asset);
}

function getKnownAssetConfigs() {
  const seen = new Set();
  const result = [];
  for (const market of pairs.values()) {
    const baseKey = `${market.baseAsset}|${market.baseTokenId}`;
    if (!seen.has(baseKey)) {
      seen.add(baseKey);
      result.push({ asset: market.baseAsset, tokenId: market.baseTokenId });
    }
    const quoteKey = `${market.quoteAsset}|${market.quoteTokenId}`;
    if (!seen.has(quoteKey)) {
      seen.add(quoteKey);
      result.push({ asset: market.quoteAsset, tokenId: market.quoteTokenId });
    }
  }
  return result;
}

function getAssetConfig(asset) {
  const key = canonicalAssetKey(asset);
  return getKnownAssetConfigs().find((entry) => canonicalAssetKey(entry.asset) === key) || null;
}

function isNativeAsset(asset) {
  const config = typeof asset === 'string' ? getAssetConfig(asset) : asset;
  if (!config?.asset) return false;
  return !String(TOKEN_CONTRACT_ADDRESSES[canonicalAssetKey(config.asset)] || '').trim();
}

function convertFromOnchainUnits(asset, rawTotal) {
  const n = Number(rawTotal || 0);
  const assetKey = canonicalAssetKey(asset);
  const decimals = Number.isFinite(ASSET_DECIMALS[assetKey]) ? ASSET_DECIMALS[assetKey] : 9;
  return n / 10 ** decimals;
}

function decimalToRawUnitsString(amount, decimals) {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error(`invalid amount ${amount}`);
  }
  const safeDecimals = Math.max(0, Number(decimals) || 0);
  const fixed = Number(amount).toFixed(safeDecimals);
  const [whole, frac = ''] = fixed.split('.');
  const fracPadded = frac.padEnd(safeDecimals, '0').slice(0, safeDecimals);
  const raw = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
  if (!raw || raw === '0') throw new Error(`invalid raw amount from ${amount}`);
  return raw;
}

function rawNanoToMinaString(raw) {
  const digits = String(raw ?? '').trim();
  if (!/^\d+$/.test(digits)) throw new Error(`invalid raw fee ${raw}`);
  const whole = digits.length > 9 ? digits.slice(0, -9) : '0';
  const frac = digits.padStart(10, '0').slice(-9).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function parseRawFeeInt(value) {
  const digits = String(value ?? '').trim();
  if (!/^\d+$/.test(digits)) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getSuggestedSequencerFeeRaw() {
  const fallback = parseRawFeeInt(TX_FEE) || 200000;
  if (SEQUENCER_FEE_MODE !== 'dynamic') {
    return {
      feeRaw: String(fallback),
      fee: rawNanoToMinaString(fallback),
      source: 'configured-static'
    };
  }
  try {
    const data = await graphqlRequest(
      `query {
        pooledZkappCommands { feePayer { fee } }
        pooledUserCommands { feePayer { fee } }
      }`
    );
    const pooled = [
      ...(Array.isArray(data?.pooledZkappCommands) ? data.pooledZkappCommands : []),
      ...(Array.isArray(data?.pooledUserCommands) ? data.pooledUserCommands : [])
    ];
    const fees = pooled
      .map((entry) => parseRawFeeInt(entry?.feePayer?.fee))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!fees.length) {
      return {
        feeRaw: String(fallback),
        fee: rawNanoToMinaString(fallback),
        source: 'configured-fallback'
      };
    }
    const p75 = fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))];
    const suggested = Math.max(fallback, p75);
    return {
      feeRaw: String(suggested),
      fee: rawNanoToMinaString(suggested),
      source: 'sequencer-mempool-p75'
    };
  } catch {
    return {
      feeRaw: String(fallback),
      fee: rawNanoToMinaString(fallback),
      source: 'configured-fallback'
    };
  }
}

async function doesOnchainTokenAccountExist(publicKey, tokenId) {
  const variants = [
    {
      name: 'account(token)',
      query: 'query($publicKey:String!,$token:String!){ account(publicKey:$publicKey, token:$token) { publicKey token } }',
      variables: { publicKey, token: tokenId }
    },
    {
      name: 'account(tokenId)',
      query: 'query($publicKey:String!,$tokenId:String!){ account(publicKey:$publicKey, tokenId:$tokenId) { publicKey token } }',
      variables: { publicKey, tokenId }
    }
  ];
  let lastError = null;
  for (const variant of variants) {
    try {
      const data = await graphqlRequest(variant.query, variant.variables);
      if ('account' in (data || {})) {
        return Boolean(data?.account);
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return false;
}

async function buildVaultDepositTransaction({ wallet, tokenId, amount, memo, feeRaw }) {
  if (!ZEKO_GRAPHQL) throw new Error('ZEKO_GRAPHQL is required');
  if (!VAULT_DEPOSIT_ADDRESS) throw new Error('VAULT_DEPOSIT_ADDRESS is required');
  const { Mina, PublicKey, UInt64, UInt32, Bool, AccountUpdate, fetchAccount } = await import('o1js');
  const { FungibleToken } = await import('mina-fungible-token');
  const sender = PublicKey.fromBase58(requireString(wallet, 'wallet'));
  const recipient = PublicKey.fromBase58(VAULT_DEPOSIT_ADDRESS);
  const assetConfig = resolveKnownAsset({ tokenId });
  const assetKey = canonicalAssetKey(assetConfig.asset);
  const nativeAsset = isNativeAsset(assetConfig);
  const tokenAddress58 = TOKEN_CONTRACT_ADDRESSES[assetKey];
  if (!nativeAsset && !tokenAddress58) {
    throw new Error(`missing token contract address for ${assetKey}; set TOKEN_CONTRACT_ADDRESSES_JSON in .env`);
  }
  const network = Mina.Network({
    networkId: ZEKO_NETWORK_ID,
    mina: ZEKO_GRAPHQL,
    archive: ZEKO_ARCHIVE_GRAPHQL || ZEKO_GRAPHQL
  });
  Mina.setActiveInstance(network);
  await fetchAccount({ publicKey: sender });
  if (nativeAsset) {
    const recipientAccount = await fetchAccount({ publicKey: recipient });
    const recipientNeedsAccount = !recipientAccount?.account;
    const tx = await Mina.transaction(
      {
        sender,
        fee: UInt64.from(requireString(feeRaw || TX_FEE, 'feeRaw')),
        memo
      },
      async () => {
        if (recipientNeedsAccount) {
          AccountUpdate.fundNewAccount(sender, 1);
        }
        const payer = AccountUpdate.createSigned(sender);
        payer.send({ to: recipient, amount: UInt64.from(requireString(amount, 'amount')) });
      }
    );
    const feePayerUpdate = tx.feePayer;
    if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
      feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
    }
    if (feePayerUpdate?.body) {
      feePayerUpdate.body.useFullCommitment = Bool(true);
    }
    await tx.prove();
    return {
      transaction: tx.toJSON(),
      receiverNeedsAccount: recipientNeedsAccount,
      receiverNeedsTokenAccount: false,
      nativeAsset: true
    };
  }
  const tokenAddress = PublicKey.fromBase58(tokenAddress58);
  const token = new FungibleToken(tokenAddress);
  if (!fungibleTokenCompilePromise) fungibleTokenCompilePromise = FungibleToken.compile();
  await fungibleTokenCompilePromise;
  const recipientNeedsTokenAccount = !(await doesOnchainTokenAccountExist(VAULT_DEPOSIT_ADDRESS, assetConfig.tokenId));
  const tx = await Mina.transaction(
    {
      sender,
      fee: UInt64.from(requireString(feeRaw || TX_FEE, 'feeRaw')),
      memo
    },
    async () => {
      if (recipientNeedsTokenAccount) {
        AccountUpdate.fundNewAccount(sender, 1);
      }
      await token.transfer(sender, recipient, UInt64.from(requireString(amount, 'amount')));
    }
  );
  const feePayerUpdate = tx.feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }
  await tx.prove();
  return {
    transaction: tx.toJSON(),
    receiverNeedsTokenAccount: recipientNeedsTokenAccount,
    nativeAsset: false
  };
}

async function buildTokenTransferTransaction({ wallet, recipient, tokenId, amount, memo, feeRaw }) {
  if (!ZEKO_GRAPHQL) throw new Error('ZEKO_GRAPHQL is required');
  const { Mina, PublicKey, UInt64, UInt32, Bool, AccountUpdate, fetchAccount } = await import('o1js');
  const { FungibleToken } = await import('mina-fungible-token');
  const sender = PublicKey.fromBase58(requireString(wallet, 'wallet'));
  const receiver = PublicKey.fromBase58(requireString(recipient, 'recipient'));
  if (sender.toBase58() === receiver.toBase58()) throw new Error('recipient must differ from sender');
  const assetConfig = resolveKnownAsset({ tokenId });
  const assetKey = canonicalAssetKey(assetConfig.asset);
  if (isNativeAsset(assetConfig)) throw new Error('token transfer widget only supports fungible tokens');
  const tokenAddress58 = TOKEN_CONTRACT_ADDRESSES[assetKey];
  if (!tokenAddress58) throw new Error(`missing token contract address for ${assetKey}`);
  const network = Mina.Network({
    networkId: ZEKO_NETWORK_ID,
    mina: ZEKO_GRAPHQL,
    archive: ZEKO_ARCHIVE_GRAPHQL || ZEKO_GRAPHQL
  });
  Mina.setActiveInstance(network);
  await fetchAccount({ publicKey: sender });
  if (!(await doesOnchainTokenAccountExist(sender.toBase58(), assetConfig.tokenId))) {
    throw new Error(`sender has no ${assetConfig.asset} token account`);
  }
  const tokenAddress = PublicKey.fromBase58(tokenAddress58);
  const token = new FungibleToken(tokenAddress);
  if (!fungibleTokenCompilePromise) fungibleTokenCompilePromise = FungibleToken.compile();
  await fungibleTokenCompilePromise;
  const recipientNeedsTokenAccount = !(await doesOnchainTokenAccountExist(receiver.toBase58(), assetConfig.tokenId));
  const tx = await Mina.transaction(
    {
      sender,
      fee: UInt64.from(requireString(feeRaw || TX_FEE, 'feeRaw')),
      memo
    },
    async () => {
      if (recipientNeedsTokenAccount) {
        AccountUpdate.fundNewAccount(sender, 1);
      }
      await token.transfer(sender, receiver, UInt64.from(requireString(amount, 'amount')));
    }
  );
  const feePayerUpdate = tx.feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }
  await tx.prove();
  return {
    transaction: tx.toJSON(),
    receiverNeedsTokenAccount: recipientNeedsTokenAccount,
    nativeAsset: false
  };
}

function getDefaultPairSymbol() {
  return Array.from(pairs.values())[0]?.symbol || DEFAULT_MARKET_DEFINITIONS[0]?.symbol || '';
}

async function graphqlRequest(query, variables = {}, endpoint = ZEKO_GRAPHQL) {
  if (!endpoint) throw new Error('ZEKO_GRAPHQL is required for real funds mode');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const responseText = await response.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    const detail = responseText.replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(`graphql http ${response.status} returned non-JSON${detail ? `: ${detail}` : ''}`);
  }
  if (!response.ok) throw new Error(`graphql http ${response.status}`);
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message || String(e)).join('; '));
  }
  return json.data || {};
}

async function submitSignedZkappCommand(zkappCommandInput) {
  if (!zkappCommandInput || typeof zkappCommandInput !== 'object') {
    throw new Error('zkappCommandInput is required');
  }
  if (typeof zkappCommandInput.memo !== 'string' || !zkappCommandInput.memo.trim()) {
    throw new Error('signed zkApp command memo is required');
  }
  const query = `mutation sendZkapp($zkappCommandInput: ZkappCommandInput!) {
    sendZkapp(input: { zkappCommand: $zkappCommandInput }) {
      zkapp {
        hash
        id
        failureReason { failures }
      }
    }
  }`;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await graphqlRequest(query, { zkappCommandInput });
      const zkapp = data?.sendZkapp?.zkapp;
      const failures = zkapp?.failureReason?.failures;
      if (Array.isArray(failures) && failures.length) {
        throw new Error(`sendZkapp failed: ${JSON.stringify(failures)}`);
      }
      const hash = typeof zkapp?.hash === 'string' ? zkapp.hash : '';
      if (!hash) throw new Error('sendZkapp returned no hash');
      return { hash, id: zkapp?.id || null };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/graphql http (502|503|504|520)/i.test(message) || attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError || new Error('sendZkapp submission failed');
}

function validateSignedZkappCommandCoverage(zkappCommandInput) {
  const missing = [];
  const updates = Array.isArray(zkappCommandInput?.accountUpdates) ? zkappCommandInput.accountUpdates : [];
  for (let i = 0; i < updates.length; i += 1) {
    const update = updates[i];
    const kind = update?.body?.authorizationKind || {};
    const auth = update?.authorization || {};
    if (kind?.isSigned && !auth?.signature) {
      missing.push({
        index: i,
        publicKey: update?.body?.publicKey || null,
        tokenId: update?.body?.tokenId || null,
        callDepth: update?.body?.callDepth ?? null
      });
    }
  }
  if (missing.length) {
    throw new Error(
      `signed zkapp is missing account update signatures: ${JSON.stringify(missing)}`
    );
  }
}

function resolveTxGraphqlEndpoints() {
  return Array.from(
    new Set(
      [
        ZEKO_TX_GRAPHQL,
        ZEKO_ARCHIVE_RELAY_GRAPHQL,
        ZEKO_ARCHIVE_GRAPHQL,
        ZEKO_GRAPHQL
      ]
        .map((e) => String(e || '').trim())
        .filter(Boolean)
    )
  );
}

async function fetchTxByHashDetailed(txHash) {
  const variants = [
    {
      name: 'transaction(hash)',
      query:
        'query($hash:String!){ transaction(hash:$hash){ hash from to amount token memo fee blockHeight dateTime canonical } }'
    },
    {
      name: 'transactionStatus',
      query:
        'query($hash:String!){ transactionStatus(payment:$hash){ hash from to amount token memo fee blockHeight dateTime status } }'
    }
  ];
  const attempts = [];
  const endpoints = resolveTxGraphqlEndpoints();
  for (const endpoint of endpoints) {
    for (const v of variants) {
      try {
        const data = await graphqlRequest(v.query, { hash: txHash }, endpoint);
        const tx = data?.transaction || data?.transactionStatus || null;
        if (tx && (tx.hash || tx.from || tx.to)) {
          attempts.push({ name: `${v.name}@${endpoint}`, ok: true, result: 'tx_found' });
          return { ok: true, tx, attempts };
        }
        attempts.push({ name: `${v.name}@${endpoint}`, ok: false, error: 'tx_not_found' });
      } catch (error) {
        attempts.push({
          name: `${v.name}@${endpoint}`,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return { ok: false, tx: null, attempts, error: 'transaction lookup failed' };
}

function extractTransactionsFromGraphqlData(data) {
  if (!data || typeof data !== 'object') return [];
  const tryKeys = ['transactions', 'payments', 'userCommands'];
  for (const key of tryKeys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.nodes)) return value.nodes;
      if (Array.isArray(value.edges)) return value.edges.map((e) => e?.node).filter(Boolean);
      if (Array.isArray(value.items)) return value.items;
    }
  }
  return [];
}

async function fetchRecentTransactionsByWallet(wallet, limit = 40) {
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const variants = [
    {
      name: 'transactions(publicKey)',
      query:
        'query($publicKey:String!,$limit:Int!){ transactions(publicKey:$publicKey, limit:$limit){ hash from to amount token memo dateTime } }',
      variables: { publicKey: wallet, limit: safeLimit }
    },
    {
      name: 'transactions(query.from)',
      query:
        'query($publicKey:String!,$limit:Int!){ transactions(query:{from:$publicKey}, limit:$limit){ hash from to amount token memo dateTime } }',
      variables: { publicKey: wallet, limit: safeLimit }
    },
    {
      name: 'payments(publicKey)',
      query:
        'query($publicKey:String!,$limit:Int!){ payments(publicKey:$publicKey, limit:$limit){ hash from to amount token memo dateTime } }',
      variables: { publicKey: wallet, limit: safeLimit }
    }
  ];
  const attempts = [];
  const endpoints = resolveTxGraphqlEndpoints();
  for (const endpoint of endpoints) {
    for (const variant of variants) {
      try {
        const data = await graphqlRequest(variant.query, variant.variables, endpoint);
        const txs = extractTransactionsFromGraphqlData(data);
        if (Array.isArray(txs) && txs.length >= 0) {
          attempts.push({ name: `${variant.name}@${endpoint}`, ok: true, count: txs.length });
          if (txs.length > 0) return { ok: true, txs, attempts };
        }
        attempts.push({ name: `${variant.name}@${endpoint}`, ok: false, error: 'no transactions in response shape' });
      } catch (error) {
        attempts.push({
          name: `${variant.name}@${endpoint}`,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return { ok: false, txs: [], attempts, error: 'unable to fetch recent wallet transactions' };
}

function parseTxUnixMs(tx) {
  const raw = tx?.dateTime || tx?.timestamp || null;
  if (!raw) return null;
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function isMissingGraphqlFieldError(errorText) {
  const text = String(errorText || '').toLowerCase();
  return (
    text.includes("is not defined on type 'query'") ||
    (text.includes('cannot query field') && text.includes('on type "query"')) ||
    (text.includes('cannot query field') && text.includes("on type 'query'"))
  );
}

async function verifyOnchainDepositTx({ txHash, wallet, tokenId, amount }) {
  if (!txHash || typeof txHash !== 'string') throw new Error('deposit tx hash is required');
  if (!VAULT_DEPOSIT_ADDRESS) throw new Error('VAULT_DEPOSIT_ADDRESS is required to verify note mint deposit tx');
  const looked = await fetchTxByHashDetailed(txHash.trim());
  if (!looked.ok || !looked.tx) {
    const attempts = looked.attempts || [];
    const lookupUnavailable = attempts.length > 0 && attempts.every((a) =>
      isMissingGraphqlFieldError(a?.error)
    );
    if (lookupUnavailable && ALLOW_WALLET_TX_HASH_FALLBACK) {
      return {
        ok: true,
        txHash: txHash.trim(),
        tx: {
          hash: txHash.trim(),
          from: wallet,
          to: VAULT_DEPOSIT_ADDRESS,
          amount,
          token: tokenId || null
        },
        txUnixMs: null,
        unverified: true,
        verificationMode: 'wallet-hash-fallback'
      };
    }
    const detail = (looked.attempts || []).map((a) => `${a.name}:${a.ok ? a.result : a.error}`).join(' | ');
    throw new Error(
      `unable to verify deposit tx hash (${detail || looked.error || 'unknown'}). ` +
      `If your main endpoint lacks tx fields, set ZEKO_TX_GRAPHQL to an indexer/graphql endpoint that supports tx lookup by hash.`
    );
  }
  const tx = looked.tx;
  const from = String(tx.from || '').trim();
  const to = String(tx.to || '').trim();
  const token = String(tx.token || tx.tokenId || '').trim();
  const rawAmount = Number(tx.amount || 0);
  if (!from || !to) throw new Error('deposit tx missing from/to fields');
  if (from !== wallet) throw new Error(`deposit tx sender mismatch: expected ${wallet}, got ${from}`);
  if (to !== VAULT_DEPOSIT_ADDRESS) throw new Error(`deposit tx recipient mismatch: expected ${VAULT_DEPOSIT_ADDRESS}, got ${to}`);
  if (tokenId && token && token !== tokenId) throw new Error(`deposit tx token mismatch: expected ${tokenId}, got ${token}`);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) throw new Error('deposit tx amount invalid');
  if (rawAmount + 1e-9 < amount) {
    throw new Error(`deposit tx amount too low: ${rawAmount} < required ${amount}`);
  }
  return {
    ok: true,
    txHash: String(tx.hash || txHash).trim(),
    tx,
    txUnixMs: parseTxUnixMs(tx),
    unverified: false,
    verificationMode: 'onchain-query'
  };
}

async function findLatestEligibleDepositTx({ wallet, tokenId, amount }) {
  if (!VAULT_DEPOSIT_ADDRESS) throw new Error('VAULT_DEPOSIT_ADDRESS is required');
  const recent = await fetchRecentTransactionsByWallet(wallet, 60);
  if (!recent.ok) {
    const attempts = recent.attempts || [];
    const unsupported = attempts.every((a) =>
      isMissingGraphqlFieldError(a?.error)
    );
    if (unsupported) {
      throw new Error(
        'wallet transaction-list query is unavailable on this endpoint; provide txHash directly (manual or wallet-captured)'
      );
    }
    const detail = attempts.map((a) => `${a.name}:${a.ok ? a.count : a.error}`).join(' | ');
    throw new Error(`unable to query wallet transactions (${detail || recent.error || 'unknown'})`);
  }
  const candidates = [];
  for (const tx of recent.txs || []) {
    const txHash = String(tx?.hash || '').trim();
    const from = String(tx?.from || '').trim();
    const to = String(tx?.to || '').trim();
    const token = String(tx?.token || tx?.tokenId || '').trim();
    const txAmount = Number(tx?.amount || 0);
    if (!txHash || !from || !to) continue;
    if (usedDepositTxHashes.has(txHash)) continue;
    if (from !== wallet) continue;
    if (to !== VAULT_DEPOSIT_ADDRESS) continue;
    if (tokenId && token && token !== tokenId) continue;
    if (!Number.isFinite(txAmount) || txAmount + 1e-9 < amount) continue;
    const txUnixMs = parseTxUnixMs(tx) || 0;
    candidates.push({ txHash, txAmount, txUnixMs, tx });
  }
  candidates.sort((a, b) => b.txUnixMs - a.txUnixMs || b.txAmount - a.txAmount);
  if (!candidates.length) throw new Error('no eligible recent deposit tx found for wallet/token/amount');
  return candidates[0];
}

function getLinkedWalletForParticipant(participant) {
  const fromMap = participantWallets.get(participant);
  if (fromMap && String(fromMap).trim()) return String(fromMap).trim();
  const account = getAccount(participant);
  const fromAccount = typeof account.__wallet === 'string' ? account.__wallet.trim() : '';
  if (fromAccount) return fromAccount;
  throw new Error(`wallet linkage missing for participant ${participant}`);
}

function tokenIdForAsset(pairConfig, assetKey) {
  const asset = canonicalAssetKey(assetKey);
  if (asset === canonicalAssetKey(pairConfig.baseAsset)) return pairConfig.baseTokenId;
  if (asset === canonicalAssetKey(pairConfig.quoteAsset)) return pairConfig.quoteTokenId;
  return null;
}

function computeSettlementPayouts(fills) {
  const payoutsByKey = new Map();
  for (const fill of fills || []) {
    if (!fill) continue;
    const items = [
      {
        participant: fill.buyParticipant,
        wallet: fill.buyWallet,
        asset: fill.baseAsset,
        tokenId: fill.baseTokenId,
        amount: Number(fill.buyReceiveBase || 0)
      },
      {
        participant: fill.sellParticipant,
        wallet: fill.sellWallet,
        asset: fill.quoteAsset,
        tokenId: fill.quoteTokenId,
        amount: Number(fill.sellReceiveQuote || 0)
      }
    ];
    for (const p of items) {
      if (!p.wallet || !p.tokenId || !Number.isFinite(p.amount) || p.amount <= 1e-9) continue;
      const key = `${p.wallet}|${p.tokenId}`;
      const cur = payoutsByKey.get(key) || {
        participant: p.participant,
        wallet: p.wallet,
        asset: canonicalAssetKey(p.asset),
        tokenId: p.tokenId,
        amount: 0
      };
      cur.amount += p.amount;
      payoutsByKey.set(key, cur);
    }
  }
  return Array.from(payoutsByKey.values())
    .map((p) => ({ ...p, amount: Number(p.amount.toFixed(9)) }))
    .filter((p) => p.amount > 1e-9);
}

function mergeSettlementPayouts(existingPayouts, additionalPayouts) {
  const payoutsByKey = new Map();
  const ingest = (items) => {
    for (const item of items || []) {
      if (!item) continue;
      const amount = Number(item.amount || 0);
      if (!item.wallet || !item.tokenId || !Number.isFinite(amount) || amount <= 1e-9) continue;
      const key = `${item.wallet}|${item.tokenId}`;
      const current = payoutsByKey.get(key) || {
        participant: item.participant || null,
        wallet: item.wallet,
        asset: canonicalAssetKey(item.asset),
        tokenId: item.tokenId,
        amount: 0
      };
      current.amount += amount;
      if (!current.participant && item.participant) current.participant = item.participant;
      payoutsByKey.set(key, current);
    }
  };
  ingest(existingPayouts);
  ingest(additionalPayouts);
  return Array.from(payoutsByKey.values())
    .map((p) => ({ ...p, amount: Number(p.amount.toFixed(9)) }))
    .filter((p) => p.amount > 1e-9);
}

function issueSettlementProceedsNotes(batch) {
  if (!batch || batch.batchType !== 'trade_settlement') return [];
  const issued = [];
  for (const payout of Array.isArray(batch.payouts) ? batch.payouts : []) {
    const participant = typeof payout?.participant === 'string' ? payout.participant.trim() : '';
    const asset = canonicalAssetKey(payout?.asset);
    const amount = Number(payout?.amount || 0);
    if (!participant || !asset || !Number.isFinite(amount) || amount <= 1e-9) continue;
    const note = issueNote(asset, amount, 'trade_settlement_proceeds', null, participant);
    if (!note) continue;
    issued.push({
      participant,
      asset,
      amount: Number(amount.toFixed(9)),
      noteHash: note.noteHash
    });
  }
  return issued;
}

async function verifyOnchainPayoutTx({ txHash, wallet, tokenId, amount }) {
  if (!txHash || typeof txHash !== 'string') throw new Error('payout tx hash is required');
  if (!VAULT_DEPOSIT_ADDRESS) throw new Error('VAULT_DEPOSIT_ADDRESS is required to verify settlement payout tx');
  const looked = await fetchTxByHashDetailed(txHash.trim());
  if (!looked.ok || !looked.tx) {
    const attempts = looked.attempts || [];
    const lookupUnavailable = attempts.length > 0 && attempts.every((a) =>
      isMissingGraphqlFieldError(a?.error)
    );
    if (lookupUnavailable && ALLOW_WALLET_TX_HASH_FALLBACK) {
      return {
        ok: true,
        txHash: txHash.trim(),
        tx: {
          hash: txHash.trim(),
          from: VAULT_DEPOSIT_ADDRESS,
          to: wallet,
          amount,
          token: tokenId || null
        },
        txUnixMs: null,
        unverified: true,
        verificationMode: 'wallet-hash-fallback'
      };
    }
    const detail = (looked.attempts || []).map((a) => `${a.name}:${a.ok ? a.result : a.error}`).join(' | ');
    throw new Error(`unable to verify payout tx hash (${detail || looked.error || 'unknown'})`);
  }
  const tx = looked.tx;
  const from = String(tx.from || '').trim();
  const to = String(tx.to || '').trim();
  const token = String(tx.token || tx.tokenId || '').trim();
  const rawAmount = Number(tx.amount || 0);
  if (!from || !to) throw new Error('payout tx missing from/to fields');
  if (from !== VAULT_DEPOSIT_ADDRESS) throw new Error(`payout tx sender mismatch: expected ${VAULT_DEPOSIT_ADDRESS}, got ${from}`);
  if (to !== wallet) throw new Error(`payout tx recipient mismatch: expected ${wallet}, got ${to}`);
  if (tokenId && token && token !== tokenId) throw new Error(`payout tx token mismatch: expected ${tokenId}, got ${token}`);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) throw new Error('payout tx amount invalid');
  if (rawAmount + 1e-9 < amount) throw new Error(`payout tx amount too low: ${rawAmount} < required ${amount}`);
  return {
    ok: true,
    txHash: String(tx.hash || txHash).trim(),
    tx,
    txUnixMs: parseTxUnixMs(tx),
    unverified: false,
    verificationMode: 'onchain-query'
  };
}

async function fetchOnchainTokenBalanceDetailed(wallet, tokenId) {
  const attempts = [];
  const queries = [
    {
      name: 'account(token)',
      query:
        'query($publicKey:String!,$token:String!){ account(publicKey:$publicKey, token:$token) { balance { total } } }',
      variables: { publicKey: wallet, token: tokenId }
    },
    {
      name: 'account(tokenId)',
      query:
        'query($publicKey:String!,$tokenId:String!){ account(publicKey:$publicKey, tokenId:$tokenId) { balance { total } } }',
      variables: { publicKey: wallet, tokenId }
    }
  ];

  for (const item of queries) {
    try {
      const data = await graphqlRequest(item.query, item.variables);
      const total = data?.account?.balance?.total;
      if (total !== undefined && total !== null) {
        attempts.push({ name: item.name, ok: true, result: 'balance.total' });
        return { ok: true, total: String(total), attempts };
      }
      if (data?.account === null || data?.account === undefined) {
        attempts.push({ name: item.name, ok: true, result: 'account_missing' });
        return { ok: true, total: '0', attempts };
      }
      attempts.push({ name: item.name, ok: false, error: 'missing balance.total in response shape' });
    } catch (error) {
      attempts.push({
        name: item.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ok: false,
    total: null,
    attempts,
    error: `unable to fetch on-chain balance for token ${tokenId}`
  };
}

async function readDepositIntentBalances(intent) {
  const [walletBalance, vaultBalance] = await Promise.all([
    fetchOnchainTokenBalanceDetailed(intent.wallet, intent.tokenId),
    fetchOnchainTokenBalanceDetailed(VAULT_DEPOSIT_ADDRESS, intent.tokenId)
  ]);
  if (!walletBalance.ok || !vaultBalance.ok) {
    const detail = [walletBalance, vaultBalance]
      .filter((entry) => !entry.ok)
      .map((entry) => entry.error || 'balance lookup failed')
      .join(' | ');
    throw new Error(detail || 'unable to read deposit intent balances');
  }
  return {
    walletRaw: String(walletBalance.total || '0'),
    vaultRaw: String(vaultBalance.total || '0')
  };
}

async function createDepositIntent({ wallet, asset, tokenId, amount }) {
  if (!VAULT_DEPOSIT_ADDRESS) throw new Error('VAULT_DEPOSIT_ADDRESS is required for deposit recovery');
  const resolved = resolveKnownAsset({ asset, tokenId });
  const canonical = canonicalAssetKey(resolved.asset);
  const decimals = Number.isFinite(ASSET_DECIMALS[canonical]) ? ASSET_DECIMALS[canonical] : 9;
  const rawAmount = decimalToRawUnitsString(amount, decimals);
  const before = await readDepositIntentBalances({ wallet, tokenId: resolved.tokenId });
  const intentId = randomUUID();
  const intent = {
    intentId,
    wallet,
    asset: canonical,
    tokenId: resolved.tokenId,
    amount,
    rawAmount,
    beforeWalletRaw: before.walletRaw,
    beforeVaultRaw: before.vaultRaw,
    createdAtUnixMs: now(),
    expiresAtUnixMs: now() + 10 * 60 * 1000,
    status: 'pending',
    note: null
  };
  depositIntents.set(intentId, intent);
  queueEngineStatePersist();
  return {
    ok: true,
    intentId,
    asset: canonical,
    tokenId: resolved.tokenId,
    amount,
    expiresAtUnixMs: intent.expiresAtUnixMs,
    confirmationModel: 'zeko-sequencer-balance-delta'
  };
}

async function recoverDepositIntent(intentId) {
  const intent = depositIntents.get(intentId);
  if (!intent) throw new Error('deposit intent not found or expired');
  if (intent.status === 'claimed' && intent.note) {
    const accountId = deriveBlindedAccountId({ wallet: intent.wallet });
    return {
      ok: true,
      recovered: true,
      pending: false,
      intentId,
      accountId,
      note: intent.note,
      participantBalances: accountBalanceSnapshot(accountId),
      verificationMode: 'zeko-balance-delta-recovery'
    };
  }
  if (intent.status === 'claiming') {
    return {
      ok: true,
      recovered: false,
      pending: true,
      intentId,
      status: 'claiming',
      verificationMode: 'zeko-balance-delta-recovery'
    };
  }
  if (intent.status === 'canceled') {
    return {
      ok: true,
      recovered: false,
      pending: false,
      intentId,
      status: 'canceled',
      verificationMode: 'zeko-balance-delta-recovery'
    };
  }
  if (Number(intent.expiresAtUnixMs || 0) <= now()) {
    depositIntents.delete(intentId);
    queueEngineStatePersist();
    throw new Error('deposit intent expired; do not resend without checking the vault balance');
  }

  const current = await readDepositIntentBalances(intent);
  const beforeWallet = BigInt(intent.beforeWalletRaw);
  const beforeVault = BigInt(intent.beforeVaultRaw);
  const currentWallet = BigInt(current.walletRaw);
  const currentVault = BigInt(current.vaultRaw);
  const rawAmount = BigInt(intent.rawAmount);
  const walletDelta = beforeWallet - currentWallet;
  const vaultDelta = currentVault - beforeVault;
  const walletMatched = isNativeAsset(intent.asset) ? walletDelta >= rawAmount : walletDelta === rawAmount;
  const vaultMatched = vaultDelta === rawAmount;

  if (!walletMatched || !vaultMatched) {
    return {
      ok: true,
      recovered: false,
      pending: true,
      intentId,
      status: 'waiting_for_zeko',
      walletDeltaRaw: walletDelta.toString(),
      vaultDeltaRaw: vaultDelta.toString(),
      expectedRawAmount: intent.rawAmount,
      verificationMode: 'zeko-balance-delta-recovery'
    };
  }

  const accountId = deriveBlindedAccountId({ wallet: intent.wallet });
  intent.status = 'claiming';
  queueEngineStatePersist();
  let note;
  try {
    await syncParticipantFromOnchain(accountId, intent.wallet);
    note = issueNote(intent.asset, intent.amount, 'onchain-backed-deposit-recovered', null, accountId);
    if (!note) throw new Error('unable to issue recovered deposit note');
    intent.status = 'claimed';
    intent.claimedAtUnixMs = now();
    intent.note = note;
    intent.walletAfterRaw = current.walletRaw;
    intent.vaultAfterRaw = current.vaultRaw;
    queueEngineStatePersist();
  } catch (error) {
    intent.status = 'pending';
    queueEngineStatePersist();
    throw error;
  }
  return {
    ok: true,
    recovered: true,
    pending: false,
    intentId,
    accountId,
    note,
    asset: intent.asset,
    tokenId: intent.tokenId,
    verifiedDepositTx: null,
    verificationMode: 'zeko-balance-delta-recovery',
    participantBalances: accountBalanceSnapshot(accountId),
    poolTotals
  };
}

function cancelDepositIntent(intentId) {
  const intent = depositIntents.get(intentId);
  if (!intent) return { ok: true, canceled: false, intentId };
  if (intent.status === 'claimed' && intent.note) {
    throw new Error('cannot cancel a deposit intent after a note was issued');
  }
  intent.status = 'canceled';
  intent.canceledAtUnixMs = now();
  queueEngineStatePersist();
  return { ok: true, canceled: true, intentId, status: 'canceled' };
}

function hasOpenOrdersForAccount(accountId) {
  return Array.from(orders.values()).some(
    (o) =>
      o.participant === accountId &&
      o.status !== 'FILLED' &&
      o.status !== 'CANCELED' &&
      o.remaining > 1e-9
  );
}

function reservedByAssetForAccount(accountId) {
  const reserved = {};
  for (const order of orders.values()) {
    if (!order || order.participant !== accountId) continue;
    if (order.status === 'FILLED' || order.status === 'CANCELED' || order.remaining <= 1e-9) continue;
    const pair = getPairConfigBySymbol(order.pair);
    if (!pair) continue;
    if (order.reservedQuoteRemaining > 1e-9) {
      const quoteAsset = canonicalAssetKey(pair.quoteAsset);
      reserved[quoteAsset] = Number(reserved[quoteAsset] || 0) + Number(order.reservedQuoteRemaining || 0);
    }
    if (order.reservedBaseRemaining > 1e-9) {
      const baseAsset = canonicalAssetKey(pair.baseAsset);
      reserved[baseAsset] = Number(reserved[baseAsset] || 0) + Number(order.reservedBaseRemaining || 0);
    }
  }
  return reserved;
}

function outstandingNotesByAssetForAccount(accountId) {
  const reserved = {};
  for (const note of notes.values()) {
    if (!note || note.ownerAccountId !== accountId) continue;
    if (note.spentAtUnixMs !== null) continue;
    const asset = canonicalAssetKey(note.asset);
    reserved[asset] = Number(reserved[asset] || 0) + Number(note.amount || 0);
  }
  return reserved;
}

async function syncParticipantFromOnchain(accountId, wallet) {
  const assets = getKnownAssetConfigs();
  const account = getAccount(accountId);
  const onchainTotals = account.__onchainTotals && typeof account.__onchainTotals === 'object' ? account.__onchainTotals : {};

  for (const entry of assets) {
    const fetched = await fetchOnchainTokenBalanceDetailed(wallet, entry.tokenId);
    if (!fetched.ok || fetched.total === null) {
      const sample = (fetched.attempts || []).map((a) => `${a.name}:${a.ok ? a.result : a.error}`).join(' | ');
      throw new Error(`${fetched.error || `unable to fetch ${entry.asset}`} (${sample || 'no attempts'})`);
    }
    const rawTotal = fetched.total;
    const asset = canonicalAssetKey(entry.asset);
    const total = convertFromOnchainUnits(entry.asset, rawTotal);
    // Trading is note-backed. Wallet sync should mirror actual on-chain wallet balances only.
    account[asset] = total;
    onchainTotals[asset] = total;
  }
  account.__wallet = wallet;
  account.__onchainTotals = onchainTotals;
  account.__lastOnchainSyncUnixMs = now();
  return {
    ...accountBalanceSnapshot(accountId),
    syncedAtUnixMs: account.__lastOnchainSyncUnixMs,
    balances: {
      ...(account.__onchainTotals || {}),
      __wallet: account.__wallet || null,
      __lastOnchainSyncUnixMs: account.__lastOnchainSyncUnixMs || null,
      __onchainTotals: account.__onchainTotals || {}
    }
  };
}

function scheduleParticipantOnchainResync(accountId, wallet, reason = 'background') {
  const retryDelaysMs = [2000, 6000, 12000, 20000];
  for (const delayMs of retryDelaysMs) {
    setTimeout(async () => {
      try {
        await syncParticipantFromOnchain(accountId, wallet);
        queueEngineStatePersist();
        console.log(`[wallet-sync:${reason}] synced ${wallet} for participant ${accountId} after ${delayMs}ms`);
      } catch (error) {
        console.warn(
          `[wallet-sync:${reason}] retry failed for ${wallet} after ${delayMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }, delayMs);
  }
}

async function getOnchainDiagnostics(wallet) {
  const assets = getKnownAssetConfigs();
  const diagnostics = [];
  for (const entry of assets) {
    const result = await fetchOnchainTokenBalanceDetailed(wallet, entry.tokenId);
    diagnostics.push({
      asset: entry.asset,
      tokenId: entry.tokenId,
      ok: result.ok,
      rawTotal: result.total,
      convertedTotal: result.total === null ? null : convertFromOnchainUnits(entry.asset, result.total),
      attempts: result.attempts || [],
      error: result.ok ? null : result.error || 'unknown'
    });
  }
  return diagnostics;
}

function resolveMarket(input) {
  const marketIdRaw = typeof input?.marketId === 'string' ? input.marketId.trim() : '';
  if (marketIdRaw) {
    const byId = marketsById.get(marketIdRaw);
    if (!byId) throw new Error(`unsupported marketId ${marketIdRaw}`);
    return byId;
  }

  const baseTokenIdRaw = typeof input?.baseTokenId === 'string' ? input.baseTokenId.trim() : '';
  const quoteTokenIdRaw = typeof input?.quoteTokenId === 'string' ? input.quoteTokenId.trim() : '';
  if (baseTokenIdRaw && quoteTokenIdRaw) {
    const byTokens = marketsByTokenKey.get(tokenPairKey(baseTokenIdRaw, quoteTokenIdRaw));
    if (!byTokens) throw new Error('unsupported token pair');
    return byTokens;
  }

  return getPair(input?.pair);
}

function resolveKnownAsset(input) {
  const assets = getKnownAssetConfigs();
  const byTokenId = new Map();
  const byAsset = new Map();
  for (const entry of assets) {
    byTokenId.set(String(entry.tokenId), entry);
    byAsset.set(canonicalAssetKey(entry.asset), entry);
  }

  const tokenIdRaw = typeof input?.tokenId === 'string' ? input.tokenId.trim() : '';
  if (tokenIdRaw) {
    const hit = byTokenId.get(tokenIdRaw);
    if (!hit) throw new Error(`unsupported tokenId ${tokenIdRaw}`);
    return { asset: canonicalAssetKey(hit.asset), tokenId: hit.tokenId };
  }

  const assetRaw = typeof input?.asset === 'string' ? input.asset.trim() : '';
  if (assetRaw) {
    const hit = byAsset.get(canonicalAssetKey(assetRaw));
    if (!hit) throw new Error(`unsupported asset ${assetRaw}`);
    return { asset: canonicalAssetKey(hit.asset), tokenId: hit.tokenId };
  }
  throw new Error('asset or tokenId is required');
}

function normalizeSide(value) {
  const side = String(value || '').trim().toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') throw new Error('side must be BUY or SELL');
  return side;
}

function normalizeTif(value) {
  const tif = String(value || 'GTC').trim().toUpperCase();
  if (tif !== 'GTC' && tif !== 'IOC') throw new Error('timeInForce must be GTC or IOC');
  return tif;
}

function normalizeOrderType(value) {
  const orderType = String(value || 'LIMIT').trim().toUpperCase();
  if (orderType !== 'LIMIT' && orderType !== 'MARKET') throw new Error('orderType must be LIMIT or MARKET');
  return orderType;
}

function normalizeFundingMode(value) {
  const mode = String(value || 'wallet').trim().toLowerCase();
  if (mode !== 'wallet' && mode !== 'hybrid' && mode !== 'note-only') {
    throw new Error('fundingMode must be wallet, hybrid, or note-only');
  }
  return mode;
}

function normalizeFundingNoteHashes(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('fundingNoteHashes must be an array');
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function canonicalOrderAuthorizationPayload(payload) {
  return stableStringify({
    wallet: requireString(payload.wallet, 'wallet'),
    marketId: requireString(payload.marketId, 'marketId'),
    baseTokenId: requireString(payload.baseTokenId, 'baseTokenId'),
    quoteTokenId: requireString(payload.quoteTokenId, 'quoteTokenId'),
    side: normalizeSide(payload.side),
    orderType: normalizeOrderType(payload.orderType),
    timeInForce: normalizeTif(payload.timeInForce),
    limitPrice:
      payload.limitPrice === null || payload.limitPrice === undefined
        ? null
        : requirePositiveNumber(Number(payload.limitPrice), 'limitPrice'),
    quantity: requirePositiveNumber(Number(payload.quantity), 'quantity'),
    fundingNoteHashes: normalizeFundingNoteHashes(payload.fundingNoteHashes),
    visibility: payload.visibility === 'private' ? 'private' : 'public',
    frontendId: payload.frontendId ? normalizeFrontendId(payload.frontendId) : null,
    nonce: requireString(payload.nonce, 'nonce'),
    expiresAtUnixMs: Number.parseInt(String(payload.expiresAtUnixMs || ''), 10)
  });
}

function canonicalOperatorAuthorizationPayload(payload) {
  return stableStringify({
    scope: 'operator-panel',
    action: requireString(payload.action, 'action'),
    wallet: requireString(payload.wallet, 'wallet'),
    nonce: requireString(payload.nonce, 'nonce'),
    expiresAtUnixMs: Number.parseInt(String(payload.expiresAtUnixMs || ''), 10)
  });
}

async function validateOrderAuthorization({ wallet, market, side, orderType, timeInForce, limitPrice, quantity, fundingNoteHashes, visibility, frontendId, authorization }) {
  if (!authorization || typeof authorization !== 'object') {
    throw new Error('wallet-signed order authorization is required');
  }
  const authWallet = requireString(
    authorization.publicKey || authorization.address || authorization.wallet || '',
    'orderAuthorization.publicKey'
  );
  if (authWallet !== wallet) throw new Error('order authorization wallet mismatch');
  const expectedPayload = canonicalOrderAuthorizationPayload({
    wallet,
    marketId: market.marketId,
    baseTokenId: market.baseTokenId,
    quoteTokenId: market.quoteTokenId,
    side,
    orderType,
    timeInForce,
    limitPrice,
    quantity,
    fundingNoteHashes,
    visibility,
    frontendId,
    nonce: authorization.nonce,
    expiresAtUnixMs: authorization.expiresAtUnixMs
  });
  const providedPayload = requireString(authorization.payload, 'orderAuthorization.payload');
  if (providedPayload !== expectedPayload) throw new Error('order authorization payload mismatch');
  const expiresAtUnixMs = Number.parseInt(String(authorization.expiresAtUnixMs || ''), 10);
  if (!Number.isFinite(expiresAtUnixMs)) throw new Error('order authorization expiry is invalid');
  const currentNow = now();
  if (expiresAtUnixMs < currentNow) throw new Error('order authorization expired');
  const nonce = requireString(authorization.nonce, 'orderAuthorization.nonce');
  pruneExpiredOrderAuthNonces(currentNow);
  if (usedOrderAuthNonces.has(nonce)) throw new Error('order authorization nonce already used');
  const signature = await normalizeAuthorizationSignature(
    authorization.signature ??
    authorization.signatureBase58 ??
    authorization.rawSignature ??
    authorization.signedData ??
    null
  );
  const signer = await getMinaSignerClient();
  const isValid = signer.verifyMessage({
    data: providedPayload,
    signature,
    publicKey: authWallet
  });
  if (!isValid) throw new Error('order authorization signature is invalid');
  return {
    wallet: authWallet,
    payload: providedPayload,
    nonce,
    expiresAtUnixMs,
    signature
  };
}

let minaSignerClientPromise = null;
let o1jsRuntimePromise = null;
const usedOrderAuthNonces = new Map();

async function getMinaSignerClient() {
  if (!minaSignerClientPromise) {
    const o1jsEntry = require.resolve('o1js');
    const signerPath = path.join(path.dirname(o1jsEntry), 'mina-signer', 'mina-signer.js');
    minaSignerClientPromise = import(pathToFileURL(signerPath).href).then((mod) => {
      const Client = mod.default;
      // Zeko Sepolia uses the Mina testnet signing domain for wallet messages.
      // `zeko:testnet` is the chain/network identifier, not the mina-signer domain.
      const networkId = String(ZEKO_NETWORK_ID || 'testnet').trim().toLowerCase() === 'mainnet'
        ? 'mainnet'
        : 'testnet';
      return new Client({ network: networkId });
    });
  }
  return minaSignerClientPromise;
}

async function getO1jsRuntime() {
  if (!o1jsRuntimePromise) {
    o1jsRuntimePromise = import('o1js');
  }
  return o1jsRuntimePromise;
}

async function normalizeAuthorizationSignature(signatureLike) {
  if (typeof signatureLike === 'string' && signatureLike.trim()) {
    const { Signature } = await getO1jsRuntime();
    const parsed = Signature.fromBase58(signatureLike.trim());
    return {
      field: String(parsed.r?.toJSON?.() ?? parsed.r),
      scalar: String(parsed.s?.toJSON?.() ?? parsed.s)
    };
  }
  if (!signatureLike || typeof signatureLike !== 'object') {
    throw new Error('order authorization signature must be present');
  }
  const candidate =
    signatureLike.signature ??
    signatureLike.signedData ??
    signatureLike.data?.signature ??
    signatureLike.data?.signedData ??
    signatureLike;
  if (typeof candidate === 'string' && candidate.trim()) {
    const { Signature } = await getO1jsRuntime();
    const parsed = Signature.fromBase58(candidate.trim());
    return {
      field: String(parsed.r?.toJSON?.() ?? parsed.r),
      scalar: String(parsed.s?.toJSON?.() ?? parsed.s)
    };
  }
  const field = candidate?.field ?? candidate?.r ?? candidate?.R ?? null;
  const scalar = candidate?.scalar ?? candidate?.s ?? candidate?.S ?? null;
  if (field === null || field === undefined || scalar === null || scalar === undefined) {
    throw new Error('order authorization signature format is unsupported');
  }
  return {
    field: String(field),
    scalar: String(scalar)
  };
}

function pruneExpiredOrderAuthNonces(currentNow = now()) {
  for (const [nonce, expiresAtUnixMs] of usedOrderAuthNonces.entries()) {
    if (!Number.isFinite(expiresAtUnixMs) || expiresAtUnixMs < currentNow) {
      usedOrderAuthNonces.delete(nonce);
    }
  }
}

function pruneExpiredOperatorAuthNonces(currentNow = now()) {
  for (const [nonce, expiresAtUnixMs] of usedOperatorAuthNonces.entries()) {
    if (!Number.isFinite(expiresAtUnixMs) || expiresAtUnixMs < currentNow) {
      usedOperatorAuthNonces.delete(nonce);
    }
  }
}

async function validateOperatorPanelAuthorization(action, authorization) {
  if (!authorization || typeof authorization !== 'object') {
    throw new Error('operator authorization is required');
  }
  const authWallet = requireString(
    authorization.publicKey || authorization.address || authorization.wallet || '',
    'operatorAuthorization.publicKey'
  );
  if (OPERATOR_PANEL_ALLOWED_WALLET && authWallet !== OPERATOR_PANEL_ALLOWED_WALLET) {
    throw new Error(`operator panel is restricted to wallet ${OPERATOR_PANEL_ALLOWED_WALLET}`);
  }
  const expectedPayload = canonicalOperatorAuthorizationPayload({
    action,
    wallet: authWallet,
    nonce: authorization.nonce,
    expiresAtUnixMs: authorization.expiresAtUnixMs
  });
  const providedPayload = requireString(authorization.payload, 'operatorAuthorization.payload');
  if (providedPayload !== expectedPayload) throw new Error('operator authorization payload mismatch');
  const expiresAtUnixMs = Number.parseInt(String(authorization.expiresAtUnixMs || ''), 10);
  if (!Number.isFinite(expiresAtUnixMs)) throw new Error('operator authorization expiry is invalid');
  const currentNow = now();
  if (expiresAtUnixMs < currentNow) throw new Error('operator authorization expired');
  const nonce = requireString(authorization.nonce, 'operatorAuthorization.nonce');
  pruneExpiredOperatorAuthNonces(currentNow);
  if (usedOperatorAuthNonces.has(nonce)) throw new Error('operator authorization nonce already used');
  const signature =
    authorization.signature ??
    authorization.signatureBase58 ??
    authorization.rawSignature ??
    null;
  if (signature === null || signature === undefined || signature === '') {
    throw new Error('operatorAuthorization.signature must be a non-empty string');
  }
  const signer = await getMinaSignerClient();
  const isValid = signer.verifyMessage({
    data: providedPayload,
    signature,
    publicKey: authWallet
  });
  if (!isValid) throw new Error('operator authorization signature is invalid');
  usedOperatorAuthNonces.set(nonce, expiresAtUnixMs);
  return {
    wallet: authWallet,
    payload: providedPayload,
    nonce,
    expiresAtUnixMs,
    signature
  };
}

function getLockedCollateral(accountId, pairConfig = null) {
  const locked = {};
  for (const order of orders.values()) {
    if (!order || order.participant !== accountId) continue;
    if (order.status === 'FILLED' || order.status === 'CANCELED' || order.remaining <= 1e-9) continue;
    const pair = getPairConfigBySymbol(order.pair);
    if (!pair) continue;
    if (pairConfig && pair.symbol !== pairConfig.symbol) continue;
    if (order.reservedQuoteRemaining > 1e-9) {
      const q = canonicalAssetKey(pair.quoteAsset);
      locked[q] = Number(locked[q] || 0) + Number(order.reservedQuoteRemaining || 0);
    }
    if (order.reservedBaseRemaining > 1e-9) {
      const b = canonicalAssetKey(pair.baseAsset);
      locked[b] = Number(locked[b] || 0) + Number(order.reservedBaseRemaining || 0);
    }
  }
  return locked;
}

function expireEligibleOrders() {
  if (!(Number.isFinite(GTC_ORDER_EXPIRY_MS) && GTC_ORDER_EXPIRY_MS > 0)) return 0;
  let expired = 0;
  const nowMs = now();
  for (const order of orders.values()) {
    if (!order || order.status === 'FILLED' || order.status === 'CANCELED' || order.remaining <= 1e-9) continue;
    if (order.timeInForce !== 'GTC') continue;
    const created = Number(order.createdAtUnixMs || 0);
    if (!created) continue;
    if (nowMs - created < GTC_ORDER_EXPIRY_MS) continue;
    const { released } = cancelOrderInternal(order);
    logActivity(order.participant, 'order_expired', {
      orderId: order.id,
      pair: order.pair,
      side: order.side,
      released
    });
    recordAuditEvent('order_expired', { orderId: order.id, pair: order.pair, side: order.side });
    expired += 1;
  }
  return expired;
}

function normalizeFrontendId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9._-]{3,40}$/.test(trimmed)) {
    throw new Error('frontendId must be 3-40 chars [a-z0-9._-]');
  }
  return trimmed;
}

function setCorsHeaders(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*';
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-maker-key,x-internal-service-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,HEAD');
}

function accumulateFrontendFees({ frontendId, asset, feeAmount, quoteNotional, pair, tradeId }) {
  if (!Number.isFinite(feeAmount) || feeAmount <= 1e-12) return;
  const normalizedFrontendId = frontendId ? normalizeFrontendId(frontendId) : null;
  const share = normalizedFrontendId ? feeAmount * (FRONTEND_FEE_SHARE_BPS / 10000) : 0;
  const protocolShare = Math.max(0, feeAmount - share);

  protocolFeeBalances[asset] = Number(protocolFeeBalances[asset] || 0) + protocolShare;
  if (!normalizedFrontendId || share <= 1e-12) return;

  const existing = frontendFeeLedger.get(normalizedFrontendId) || {
    frontendId: normalizedFrontendId,
    tradeCount: 0,
    routedVolumeQuote: 0,
    earningsByAsset: {},
    recentFills: []
  };
  existing.tradeCount += 1;
  existing.routedVolumeQuote += Number(quoteNotional || 0);
  existing.earningsByAsset[asset] = Number(existing.earningsByAsset[asset] || 0) + share;
  existing.recentFills.unshift({ tradeId, pair, asset, feeAmount, frontendShare: share, createdAtUnixMs: now() });
  if (existing.recentFills.length > 100) existing.recentFills.pop();
  frontendFeeLedger.set(normalizedFrontendId, existing);
}

function getAccount(participant) {
  const existing = accounts.get(participant);
  if (existing) return existing;
  const created = {};
  accounts.set(participant, created);
  return created;
}

function getBalance(participant, asset) {
  const account = getAccount(participant);
  return Number(account[canonicalAssetKey(asset)] || 0);
}

function accountBalanceSnapshot(participant) {
  const account = getAccount(participant);
  const onchainTotals = account.__onchainTotals || {};
  return {
    accountId: participant,
    wallet: account.__wallet || null,
    availableBalances: { ...onchainTotals },
    onchainTotals,
    lockedByAsset: reservedByAssetForAccount(participant),
    outstandingNotesByAsset: outstandingNotesByAssetForAccount(participant),
    lastOnchainSyncUnixMs: account.__lastOnchainSyncUnixMs || null
  };
}

function addBalance(participant, asset, delta) {
  const account = getAccount(participant);
  const key = canonicalAssetKey(asset);
  const next = Number(account[key] || 0) + delta;
  if (next < -1e-9) throw new Error(`negative balance ${participant} ${asset}`);
  account[key] = Math.max(0, next);
}

function logActivity(accountId, type, details = {}) {
  if (!accountId) return;
  activityEvents.unshift({
    id: randomUUID(),
    accountId,
    type,
    details: storedActivityDetails(type, details),
    createdAtUnixMs: now()
  });
  if (activityEvents.length > 5000) activityEvents.pop();
  queueEngineStatePersist();
}

function computeSettlementBatchHash(fills) {
  const canonical = fills
    .map(
      (fill) =>
        [
          fill.tradeId,
          fill.pair,
          Number(fill.price).toFixed(8),
          Number(fill.quantity).toFixed(8),
          fill.buyCommitment,
          fill.sellCommitment,
          fill.buySequencingReceiptHash || '-',
          fill.sellSequencingReceiptHash || '-'
        ].join('|')
    )
    .sort()
    .join('\n');
  return sha256Hex(canonical);
}

function toSettlementBatchTrade(fill) {
  const buySequencingReceiptHash =
    fill.buySequencingReceiptHash || sequencingReceiptsByCommitment.get(fill.buyCommitment)?.receiptHash || null;
  const sellSequencingReceiptHash =
    fill.sellSequencingReceiptHash || sequencingReceiptsByCommitment.get(fill.sellCommitment)?.receiptHash || null;
  return {
    tradeId: fill.tradeId,
    pair: fill.pair,
    price: fill.price,
    quantity: fill.quantity,
    buyCommitment: fill.buyCommitment,
    sellCommitment: fill.sellCommitment,
    buySequencingReceiptHash,
    sellSequencingReceiptHash,
    createdAtUnixMs: fill.createdAtUnixMs
  };
}

function getAppendablePendingSettlementBatch(additionalTradeCount = 0) {
  const candidate = settlementBatches.find(
    (batch) => batch?.status === 'pending' && batch?.batchType === 'trade_settlement' && !batch?.txHash
  );
  if (!candidate) return null;
  const currentTradeCount = Array.isArray(candidate.trades) ? candidate.trades.length : Number(candidate.tradeCount || 0);
  if (currentTradeCount + additionalTradeCount > SETTLEMENT_BATCH_MAX_TRADES) return null;
  if (
    SETTLEMENT_BATCH_MAX_DELAY_MS > 0 &&
    Number.isFinite(Number(candidate.createdAtUnixMs || 0)) &&
    now() - Number(candidate.createdAtUnixMs || 0) > SETTLEMENT_BATCH_MAX_DELAY_MS
  ) {
    return null;
  }
  return candidate;
}

function openOrdersSnapshot() {
  return Array.from(orders.values())
    .filter((o) => o.status !== 'FILLED' && o.status !== 'CANCELED' && o.remaining > 1e-9)
    .map((o) => ({
      id: o.id,
      marketId: o.marketId || null,
      pair: o.pair,
      participant: o.participant,
      side: o.side,
      limitPrice: o.limitPrice,
      quantity: o.quantity,
      remaining: o.remaining,
      reservedQuoteRemaining: o.reservedQuoteRemaining,
      reservedBaseRemaining: o.reservedBaseRemaining,
      timeInForce: o.timeInForce,
      commitment: o.commitment,
      createdAtUnixMs: o.createdAtUnixMs,
      sequenceNumber: o.sequenceNumber || null,
      sequencingReceiptHash: o.sequencingReceiptHash || null,
      cancelToken: o.cancelToken,
      status: o.status,
      visibility: o.visibility || 'public',
      frontendId: o.frontendId || null,
      makerTag: o.makerTag || null
    }))
    .sort((a, b) => a.createdAtUnixMs - b.createdAtUnixMs || a.id.localeCompare(b.id));
}

function computeBookHash() {
  const lines = openOrdersSnapshot().map((o) =>
    [o.id, o.marketId || '-', o.pair, o.side, Number(o.limitPrice).toFixed(8), Number(o.remaining).toFixed(8), o.commitment].join('|')
  );
  return sha256Hex(lines.join('\n'));
}

function computeNoteCommitmentRoot() {
  const lines = Array.from(notes.values())
    .filter((note) => note && note.spentAtUnixMs === null)
    .map((note) =>
      [
        note.noteHash || '-',
        note.ownerAccountId || '-',
        canonicalAssetKey(note.asset),
        Number(note.amount || 0).toFixed(9),
        Number(note.createdAtUnixMs || 0)
      ].join('|')
    )
    .sort();
  return sha256Hex(lines.join('\n'));
}

function computeSpentNullifierRoot() {
  const sorted = Array.from(spentNullifiers.values()).sort();
  return sha256Hex(sorted.join('\n'));
}

function computeSequencingReceiptRoot() {
  const sorted = Array.from(sequencingReceiptsByCommitment.values())
    .map((receipt) => String(receipt?.receiptHash || ''))
    .filter(Boolean)
    .sort();
  return sha256Hex(sorted.join('\n'));
}

function pendingPrivateStateJournalEntries() {
  return privateStateJournal.filter((entry) => !Number.isFinite(Number(entry?.committedBatchId)));
}

function snapshotPrivateStateDelta() {
  const pending = pendingPrivateStateJournalEntries();
  return {
    noteSpends: pending.filter((entry) => entry?.kind === 'note_spend'),
    noteOutputs: pending.filter((entry) => entry?.kind === 'note_output'),
    sequencingReceipts: pending.filter((entry) => entry?.kind === 'sequencing_receipt')
  };
}

function privateStateDeltaEventCount(delta) {
  if (!delta || typeof delta !== 'object') return 0;
  return ['noteSpends', 'noteOutputs', 'sequencingReceipts'].reduce((sum, key) => {
    const list = Array.isArray(delta[key]) ? delta[key] : [];
    return sum + list.length;
  }, 0);
}

function hasPrivateStateDelta(delta) {
  return privateStateDeltaEventCount(delta) > 0;
}

function computePrivateStateDeltaHash(delta) {
  return sha256Hex(
    stableStringify({
      noteSpends: Array.isArray(delta?.noteSpends)
        ? delta.noteSpends.map((entry) => ({
            id: entry.id,
            noteHash: entry.noteHash,
            nullifier: entry.nullifier,
            ownerAccountId: entry.ownerAccountId,
            asset: entry.asset,
            amount: entry.amount,
            createdAtUnixMs: entry.createdAtUnixMs
          }))
        : [],
      noteOutputs: Array.isArray(delta?.noteOutputs)
        ? delta.noteOutputs.map((entry) => ({
            id: entry.id,
            noteHash: entry.noteHash,
            ownerAccountId: entry.ownerAccountId,
            asset: entry.asset,
            amount: entry.amount,
            createdAtUnixMs: entry.createdAtUnixMs
          }))
        : [],
      sequencingReceipts: Array.isArray(delta?.sequencingReceipts)
        ? delta.sequencingReceipts.map((entry) => ({
            id: entry.id,
            receiptHash: entry.receiptHash,
            commitment: entry.commitment,
            sequenceNumber: entry.sequenceNumber,
            participant: entry.participant
          }))
        : []
    })
  );
}

function buildLivePrivateStateDelta() {
  const delta = snapshotPrivateStateDelta();
  return {
    ...delta,
    eventCount: privateStateDeltaEventCount(delta)
  };
}

function updateBatchPrivateStateSnapshot(batch) {
  if (!batch || batch.status !== 'pending') return batch;
  const delta = buildLivePrivateStateDelta();
  batch.privateStateDelta = delta;
  batch.noteRootHash = computeNoteCommitmentRoot();
  batch.nullifierRootHash = computeSpentNullifierRoot();
  batch.sequencingRootHash = computeSequencingReceiptRoot();
  if (batch.batchType === 'private_state') {
    batch.batchHash = computePrivateStateDeltaHash(delta);
  }
  batch.privateStateTransitionHash = computePrivateStateTransitionHashForBatch(batch);
  batch.updatedAtUnixMs = now();
  return batch;
}

function getAppendablePendingPrivateStateBatch(additionalEventCount = 0) {
  const candidate = settlementBatches.find(
    (batch) => batch?.status === 'pending' && batch?.batchType === 'private_state' && !batch?.txHash
  );
  if (!candidate) return null;
  const currentEventCount = privateStateDeltaEventCount(candidate.privateStateDelta);
  if (currentEventCount + additionalEventCount > PRIVATE_STATE_BATCH_MAX_EVENTS) return null;
  if (
    SETTLEMENT_BATCH_MAX_DELAY_MS > 0 &&
    Number.isFinite(Number(candidate.createdAtUnixMs || 0)) &&
    now() - Number(candidate.createdAtUnixMs || 0) > SETTLEMENT_BATCH_MAX_DELAY_MS
  ) {
    return null;
  }
  return candidate;
}

async function ensurePrivateStateBatch(reason = 'private_state_update', accountId = null) {
  const delta = buildLivePrivateStateDelta();
  if (!hasPrivateStateDelta(delta)) return null;

  let target =
    getAppendablePendingSettlementBatch(0) ||
    getAppendablePendingPrivateStateBatch(delta.eventCount);

  if (!target) {
    target = {
      batchId: nextSettlementBatchId++,
      batchType: 'private_state',
      batchHash: computePrivateStateDeltaHash(delta),
      bookRootHash: computeBookHash(),
      noteRootHash: computeNoteCommitmentRoot(),
      nullifierRootHash: computeSpentNullifierRoot(),
      sequencingRootHash: computeSequencingReceiptRoot(),
      tradeCount: 0,
      trades: [],
      payouts: [],
      requiresOnchainPayouts: false,
      status: 'pending',
      createdAtUnixMs: now(),
      committedAtUnixMs: null,
      txHash: null,
      privateStateDelta: delta
    };
    target.privateStateTransitionHash = computePrivateStateTransitionHashForBatch(target);
    settlementBatches.unshift(target);
    if (settlementBatches.length > 1000) settlementBatches.pop();
    logActivity(accountId, 'private_state_batch_enqueued', {
      batchId: target.batchId,
      reason,
      eventCount: delta.eventCount,
      batchHash: target.batchHash,
      privateStateTransitionHash: target.privateStateTransitionHash
    });
    recordAuditEvent('private_state_batch_enqueued', {
      accountId,
      reason,
      batchId: target.batchId,
      eventCount: delta.eventCount,
      batchHash: target.batchHash,
      privateStateTransitionHash: target.privateStateTransitionHash
    });
  } else {
    updateBatchPrivateStateSnapshot(target);
  }

  await persistSettlementBatches();
  queueEngineStatePersist();
  return target;
}

function appendPrivateStateJournalEntry(entry) {
  const normalized = {
    id: randomUUID(),
    createdAtUnixMs: now(),
    committedBatchId: null,
    ...entry
  };
  privateStateJournal.push(normalized);
  if (privateStateJournal.length > 5000) {
    const retained = privateStateJournal.filter((item) => !Number.isFinite(Number(item?.committedBatchId)));
    privateStateJournal.length = 0;
    privateStateJournal.push(...retained.slice(-2500));
  }
  return normalized;
}

function computeTradeSequencingRoot(trades) {
  const sorted = [];
  for (const trade of trades || []) {
    if (trade?.buySequencingReceiptHash) sorted.push(`buy|${trade.buySequencingReceiptHash}`);
    if (trade?.sellSequencingReceiptHash) sorted.push(`sell|${trade.sellSequencingReceiptHash}`);
  }
  sorted.sort();
  return sha256Hex(sorted.join('\n'));
}

function computePrivateStateTransitionHashForBatch(batch) {
  const tradeRoot = computeSettlementBatchHash(Array.isArray(batch?.trades) ? batch.trades : []);
  return sha256Hex(
    [
      String(tradeRoot || ''),
      String(batch?.bookRootHash || ''),
      String(batch?.noteRootHash || ''),
      String(batch?.nullifierRootHash || ''),
      String(batch?.sequencingRootHash || '')
    ].join('|')
  );
}

function rebuildPoolTotalsFromNotes() {
  for (const key of Object.keys(poolTotals)) delete poolTotals[key];
  for (const note of notes.values()) {
    if (!note || note.spentAtUnixMs !== null) continue;
    const asset = canonicalAssetKey(note.asset);
    const amount = Number(note.amount || 0);
    if (!Number.isFinite(amount) || amount <= 1e-9) continue;
    poolTotals[asset] = Number(poolTotals[asset] || 0) + amount;
  }
}

function engineStateSnapshot() {
  return {
    version: 1,
    savedAtUnixMs: now(),
    openOrders: openOrdersSnapshot(),
    publicTape: publicTape.slice(0, 1000),
    activityEvents: activityEvents.slice(0, 5000),
    accounts: Object.fromEntries(accounts.entries()),
    participantWallets: Object.fromEntries(participantWallets.entries()),
    notes: Array.from(notes.values()),
    spentNullifiers: Array.from(spentNullifiers.values()),
    sequencingReceipts: Array.from(sequencingReceiptsByCommitment.entries()),
    privateStateJournal,
    nextOrderSequenceNumber,
    poolTotals,
    depositIntents: Object.fromEntries(depositIntents.entries()),
    usedDepositTxHashes: Array.from(usedDepositTxHashes.values()),
    usedSettlementPayoutTxHashes: Array.from(usedSettlementPayoutTxHashes.values())
  };
}

async function persistEngineState() {
  if (!engineStatePath) return;
  const payload = encryptJson(engineStateSnapshot(), ORDER_STATE_ENCRYPTION_KEY);
  await mkdir(path.dirname(engineStatePath), { recursive: true });
  await writeFile(engineStatePath, JSON.stringify(payload, null, 2), 'utf8');
}

function queueEngineStatePersist() {
  engineStateWriteChain = engineStateWriteChain.then(() => persistEngineState()).catch(() => {});
}

async function loadEngineState() {
  if (!engineStatePath) return;
  try {
    const raw = await readFile(engineStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    const state = decryptJson(parsed, ORDER_STATE_ENCRYPTION_KEY) || {};

    const loadedAccounts = state.accounts && typeof state.accounts === 'object' ? state.accounts : {};
    const loadedWallets = state.participantWallets && typeof state.participantWallets === 'object' ? state.participantWallets : {};
    const loadedOrders = Array.isArray(state.openOrders) ? state.openOrders : [];
    const loadedPublicTape = Array.isArray(state.publicTape) ? state.publicTape : [];
    const loadedActivityEvents = Array.isArray(state.activityEvents) ? state.activityEvents : [];
    const loadedNotes = Array.isArray(state.notes) ? state.notes : [];
    const loadedSpentNullifiers = Array.isArray(state.spentNullifiers) ? state.spentNullifiers : [];
    const loadedSequencingReceipts = Array.isArray(state.sequencingReceipts) ? state.sequencingReceipts : [];
    const loadedPrivateStateJournal = Array.isArray(state.privateStateJournal) ? state.privateStateJournal : [];
    const loadedDepositIntents = state.depositIntents && typeof state.depositIntents === 'object' ? state.depositIntents : {};
    const loadedUsedDepositTxHashes = Array.isArray(state.usedDepositTxHashes) ? state.usedDepositTxHashes : [];
    const loadedUsedSettlementPayoutTxHashes = Array.isArray(state.usedSettlementPayoutTxHashes)
      ? state.usedSettlementPayoutTxHashes
      : [];

    accounts.clear();
    for (const [k, v] of Object.entries(loadedAccounts)) accounts.set(k, v || {});

    participantWallets.clear();
    for (const [k, v] of Object.entries(loadedWallets)) {
      if (typeof v === 'string' && v.trim()) participantWallets.set(k, v.trim());
    }

    notes.clear();
    for (const note of loadedNotes) {
      if (!note || typeof note.noteHash !== 'string') continue;
      if (note.spentAtUnixMs !== null && !note.spentNullifier) {
        note.spentNullifier = computeNoteNullifier(note.noteHash, note.ownerAccountId || '');
      }
      notes.set(note.noteHash, note);
    }
    spentNullifiers.clear();
    for (const nullifier of loadedSpentNullifiers) {
      if (typeof nullifier === 'string' && nullifier.trim()) spentNullifiers.add(nullifier.trim());
    }
    for (const note of notes.values()) {
      if (note && note.spentAtUnixMs !== null && typeof note.spentNullifier === 'string' && note.spentNullifier.trim()) {
        spentNullifiers.add(note.spentNullifier.trim());
      }
    }
    sequencingReceiptsByCommitment.clear();
    for (const entry of loadedSequencingReceipts) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [commitment, receipt] = entry;
      if (typeof commitment !== 'string' || !commitment.trim() || !receipt || typeof receipt !== 'object') continue;
      sequencingReceiptsByCommitment.set(commitment.trim(), receipt);
    }
    privateStateJournal.length = 0;
    for (const entry of loadedPrivateStateJournal) {
      if (!entry || typeof entry !== 'object' || typeof entry.kind !== 'string') continue;
      privateStateJournal.push(entry);
    }
    depositIntents.clear();
    for (const [intentId, intent] of Object.entries(loadedDepositIntents)) {
      if (!intent || typeof intent !== 'object' || typeof intentId !== 'string') continue;
      if (Number(intent.expiresAtUnixMs || 0) > now()) depositIntents.set(intentId, intent);
    }
    const loadedNextOrderSequenceNumber = Number(state.nextOrderSequenceNumber || 0);
    if (Number.isFinite(loadedNextOrderSequenceNumber) && loadedNextOrderSequenceNumber > 0) {
      nextOrderSequenceNumber = loadedNextOrderSequenceNumber;
    } else {
      const maxSequence = Array.from(sequencingReceiptsByCommitment.values()).reduce(
        (max, receipt) => Math.max(max, Number(receipt?.sequenceNumber || 0)),
        0
      );
      nextOrderSequenceNumber = maxSequence + 1;
    }
    rebuildPoolTotalsFromNotes();
    usedDepositTxHashes.clear();
    for (const txHash of loadedUsedDepositTxHashes) {
      if (typeof txHash === 'string' && txHash.trim()) usedDepositTxHashes.add(txHash.trim());
    }
    usedSettlementPayoutTxHashes.clear();
    for (const txHash of loadedUsedSettlementPayoutTxHashes) {
      if (typeof txHash === 'string' && txHash.trim()) usedSettlementPayoutTxHashes.add(txHash.trim());
    }

    orders.clear();
    books.clear();
    publicTape.length = 0;
    for (const fill of loadedPublicTape) {
      if (!fill || typeof fill.tradeId !== 'string') continue;
      publicTape.push(fill);
    }
    activityEvents.length = 0;
    for (const event of loadedActivityEvents) {
      if (!event || typeof event.accountId !== 'string' || typeof event.type !== 'string') continue;
      activityEvents.push({
        ...event,
        details: storedActivityDetails(event.type, event.details || {})
      });
    }
    for (const order of loadedOrders) {
      if (!order || !order.id || !order.pair) continue;
      // Older snapshots carried base64-encoded plaintext order payloads. They
      // were never encryption; discard them when loading the state.
      delete order.encryptedOrder;
      orders.set(order.id, order);
      const book = getBook(order.pair);
      if (order.side === 'BUY') book.buys.push(order.id);
      else if (order.side === 'SELL') book.sells.push(order.id);
      if (!privateFillsByOrder.has(order.id)) privateFillsByOrder.set(order.id, []);
      if (!orderIssuedNotes.has(order.id)) orderIssuedNotes.set(order.id, []);
    }
    for (const pair of pairs.values()) {
      sortBook(pair.symbol);
      pruneBook(pair.symbol);
    }
  } catch {
  }
}

async function persistEarlyAccessState() {
  if (!earlyAccessStatePath || !EARLY_ACCESS_GATE_ENABLED) return;
  await mkdir(path.dirname(earlyAccessStatePath), { recursive: true });
  await writeFile(
    earlyAccessStatePath,
    JSON.stringify(
      {
        version: 1,
        savedAtUnixMs: now(),
        allowedIps: earlyAccessState.allowedIps,
        usedCodes: earlyAccessState.usedCodes
      },
      null,
      2
    ),
    'utf8'
  );
}

function queueEarlyAccessPersist() {
  earlyAccessWriteChain = earlyAccessWriteChain.then(() => persistEarlyAccessState()).catch(() => {});
}

async function loadEarlyAccessState() {
  if (!earlyAccessStatePath || !EARLY_ACCESS_GATE_ENABLED) return;
  try {
    const raw = await readFile(earlyAccessStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    earlyAccessState.allowedIps = parsed && typeof parsed.allowedIps === 'object' && parsed.allowedIps ? parsed.allowedIps : {};
    earlyAccessState.usedCodes = parsed && typeof parsed.usedCodes === 'object' && parsed.usedCodes ? parsed.usedCodes : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

function redeemEarlyAccessCode(code, ip) {
  const trimmedCode = String(code || '').trim();
  const normalizedIp = normalizeIpAddress(ip);
  if (!EARLY_ACCESS_GATE_ENABLED) {
    return { ok: true, authorized: true, ip: normalizedIp, alreadyAuthorized: true, gateEnabled: false };
  }
  if (!normalizedIp) throw new Error('unable to determine client ip');
  if (!trimmedCode) throw new Error('early access code is required');
  const inventory = getEarlyAccessCodeInventory();
  const codeHash = makeEarlyAccessCodeHash(trimmedCode);
  if (!inventory.has(codeHash)) throw new Error('invalid early access code');
  if (earlyAccessState.usedCodes[codeHash]) throw new Error('early access code already used');

  const usedAtUnixMs = now();
  earlyAccessState.usedCodes[codeHash] = {
    codeHash,
    usedAtUnixMs,
    firstIp: normalizedIp
  };
  earlyAccessState.allowedIps[normalizedIp] = {
    ip: normalizedIp,
    grantedAtUnixMs: usedAtUnixMs,
    source: 'invite-code',
    codeHash
  };
  queueEarlyAccessPersist();
  return {
    ok: true,
    authorized: true,
    gateEnabled: true,
    ip: normalizedIp,
    codeUsed: true,
    remainingCodes: Math.max(0, inventory.size - Object.keys(earlyAccessState.usedCodes).length)
  };
}

async function maybePublishBookSnapshotToDa(batch) {
  if (!DA_ENDPOINT) return null;
  try {
    const body = {
      version: 1,
      schema: ZEKO_DA_SCHEMA,
      appId: ZEKO_DA_APP_ID,
      network: ZEKO_DA_NETWORK,
      mode: DA_MODE,
      type: 'shadowbook.book_anchor',
      createdAtUnixMs: now(),
      batchId: batch.batchId,
      marketCount: pairs.size,
      commitment: batch.batchHash,
      commitmentAlgorithm: 'sha256',
      payloadHashAlgorithm: 'sha256'
    };
    if (DA_INCLUDE_ORDER_SNAPSHOT) {
      body.payload = {
        openOrders: openOrdersSnapshot()
      };
    }
    const encrypted = encryptJson(body, DA_ENCRYPTION_KEY);
    if (DA_REQUIRE_ENCRYPTION && encrypted.mode !== 'aes-256-gcm') {
      return { ok: false, error: 'DA encryption required but no DA_ENCRYPTION_KEY configured' };
    }
    const publishPayload =
      DA_MODE === 'zeko-relay'
        ? {
            mode: 'zeko-relay',
            schema: ZEKO_DA_SCHEMA,
            appId: ZEKO_DA_APP_ID,
            network: ZEKO_DA_NETWORK,
            commitment: batch.batchHash,
            payloadCiphertext: encrypted,
            payloadHash: sha256Hex(stableStringify(encrypted)),
            createdAtUnixMs: body.createdAtUnixMs
          }
        : encrypted;
    const response = await fetch(DA_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(DA_BEARER_TOKEN ? { authorization: `Bearer ${DA_BEARER_TOKEN}` } : {})
      },
      body: JSON.stringify(publishPayload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, body: json };
    return {
      ok: true,
      reference: json?.reference || json?.id || json?.cid || null,
      response: json
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function persistSettlementBatches() {
  if (!settlementBatchesPath) return;
  await mkdir(path.dirname(settlementBatchesPath), { recursive: true });
  await writeFile(
    settlementBatchesPath,
    JSON.stringify(
      {
        nextSettlementBatchId,
        batches: settlementBatches
      },
      null,
      2
    ),
    'utf8'
  );
}

async function loadSettlementBatches() {
  if (!settlementBatchesPath) return;
  try {
    const raw = await readFile(settlementBatchesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const loaded = Array.isArray(parsed?.batches) ? parsed.batches : [];
    settlementBatches.length = 0;
    settlementBatches.push(...loaded);
    const parsedNext = Number(parsed?.nextSettlementBatchId || 1);
    if (Number.isFinite(parsedNext) && parsedNext > 0) {
      nextSettlementBatchId = parsedNext;
    } else {
      const maxId = loaded.reduce((max, item) => Math.max(max, Number(item?.batchId || 0)), 0);
      nextSettlementBatchId = maxId + 1;
    }
    const latestBookAnchor = loaded.find((b) => b?.batchType === 'book_anchor' && typeof b.batchHash === 'string');
    lastAnchoredBookHash = latestBookAnchor?.batchHash || null;
  } catch {
    settlementBatches.length = 0;
    nextSettlementBatchId = 1;
    lastAnchoredBookHash = null;
  }
}

async function enqueueSettlementBatch(accountId, fills) {
  if (!Array.isArray(fills) || fills.length === 0) return null;
  const tradeSummaries = fills.map(toSettlementBatchTrade);
  const payouts = computeSettlementPayouts(fills);
  let appendTarget = getAppendablePendingSettlementBatch(tradeSummaries.length);
  if (!appendTarget) {
    const pendingPrivateStateBatch = getAppendablePendingPrivateStateBatch(0);
    if (
      pendingPrivateStateBatch &&
      (!Array.isArray(pendingPrivateStateBatch.trades) || pendingPrivateStateBatch.trades.length === 0) &&
      pendingPrivateStateBatch.status === 'pending'
    ) {
      pendingPrivateStateBatch.batchType = 'trade_settlement';
      pendingPrivateStateBatch.tradeCount = 0;
      pendingPrivateStateBatch.trades = [];
      pendingPrivateStateBatch.payouts = [];
      pendingPrivateStateBatch.requiresOnchainPayouts = SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS && !SETTLEMENT_PROCEEDS_AS_NOTES;
      appendTarget = pendingPrivateStateBatch;
    }
  }
  if (appendTarget) {
    appendTarget.trades = Array.isArray(appendTarget.trades) ? appendTarget.trades : [];
    appendTarget.trades.push(...tradeSummaries);
    appendTarget.tradeCount = appendTarget.trades.length;
    appendTarget.batchHash = computeSettlementBatchHash(appendTarget.trades);
    appendTarget.bookRootHash = computeBookHash();
    appendTarget.noteRootHash = computeNoteCommitmentRoot();
    appendTarget.nullifierRootHash = computeSpentNullifierRoot();
    appendTarget.sequencingRootHash = computeSequencingReceiptRoot();
    appendTarget.payouts = mergeSettlementPayouts(appendTarget.payouts, payouts);
    appendTarget.privateStateDelta = buildLivePrivateStateDelta();
    appendTarget.privateStateTransitionHash = computePrivateStateTransitionHashForBatch(appendTarget);
    appendTarget.updatedAtUnixMs = now();
    await persistSettlementBatches();
    queueEngineStatePersist();
    logActivity(accountId, 'settlement_batch_appended', {
      batchId: appendTarget.batchId,
      batchHash: appendTarget.batchHash,
      sequencingRootHash: appendTarget.sequencingRootHash,
      privateStateTransitionHash: appendTarget.privateStateTransitionHash,
      appendedTradeCount: tradeSummaries.length,
      tradeCount: appendTarget.tradeCount,
      payoutCount: Array.isArray(appendTarget.payouts) ? appendTarget.payouts.length : 0
    });
    recordAuditEvent('settlement_batch_appended', {
      accountId,
      batchId: appendTarget.batchId,
      batchHash: appendTarget.batchHash,
      sequencingRootHash: appendTarget.sequencingRootHash,
      privateStateTransitionHash: appendTarget.privateStateTransitionHash,
      appendedTradeCount: tradeSummaries.length,
      tradeCount: appendTarget.tradeCount,
      payoutCount: Array.isArray(appendTarget.payouts) ? appendTarget.payouts.length : 0
    });
    return appendTarget;
  }
  const batch = {
    batchId: nextSettlementBatchId++,
    batchType: 'trade_settlement',
    batchHash: computeSettlementBatchHash(tradeSummaries),
    bookRootHash: computeBookHash(),
    noteRootHash: computeNoteCommitmentRoot(),
    nullifierRootHash: computeSpentNullifierRoot(),
    sequencingRootHash: computeSequencingReceiptRoot(),
    tradeCount: tradeSummaries.length,
    trades: tradeSummaries,
    payouts,
    privateStateDelta: buildLivePrivateStateDelta(),
    requiresOnchainPayouts: SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS && !SETTLEMENT_PROCEEDS_AS_NOTES,
    status: 'pending',
    createdAtUnixMs: now(),
    committedAtUnixMs: null,
    txHash: null
  };
  batch.privateStateTransitionHash = computePrivateStateTransitionHashForBatch(batch);
  settlementBatches.unshift(batch);
  if (settlementBatches.length > 1000) settlementBatches.pop();
  await persistSettlementBatches();
  queueEngineStatePersist();
  logActivity(accountId, 'settlement_batch_enqueued', {
    batchId: batch.batchId,
    batchHash: batch.batchHash,
    sequencingRootHash: batch.sequencingRootHash,
    privateStateTransitionHash: batch.privateStateTransitionHash,
    tradeCount: batch.tradeCount,
    payoutCount: batch.payouts.length
  });
  recordAuditEvent('settlement_batch_enqueued', {
    accountId,
    batchId: batch.batchId,
    batchHash: batch.batchHash,
    sequencingRootHash: batch.sequencingRootHash,
    privateStateTransitionHash: batch.privateStateTransitionHash,
    tradeCount: batch.tradeCount,
    payoutCount: batch.payouts.length
  });
  return batch;
}

async function enqueueBookAnchor(reason = 'manual') {
  const bookHash = computeBookHash();
  if (bookHash === lastAnchoredBookHash) return null;

  const batch = {
    batchId: nextSettlementBatchId++,
    batchType: 'book_anchor',
    batchHash: bookHash,
    bookRootHash: bookHash,
    noteRootHash: computeNoteCommitmentRoot(),
    nullifierRootHash: computeSpentNullifierRoot(),
    sequencingRootHash: computeSequencingReceiptRoot(),
    tradeCount: 0,
    trades: [],
    anchorReason: reason,
    status: 'pending',
    createdAtUnixMs: now(),
    committedAtUnixMs: null,
    txHash: null,
    daReference: null
  };
  batch.privateStateTransitionHash = computePrivateStateTransitionHashForBatch(batch);

  const daPublish = await maybePublishBookSnapshotToDa(batch);
  if (daPublish?.ok) batch.daReference = daPublish.reference || null;
  else if (daPublish && !daPublish.ok) batch.daReference = `da_error:${daPublish.error || daPublish.status || 'unknown'}`;

  settlementBatches.unshift(batch);
  if (settlementBatches.length > 1000) settlementBatches.pop();
  await persistSettlementBatches();
  lastAnchoredBookHash = bookHash;

  recordAuditEvent('book_anchor_enqueued', {
    batchId: batch.batchId,
    bookHash,
    noteRootHash: batch.noteRootHash,
    nullifierRootHash: batch.nullifierRootHash,
    sequencingRootHash: batch.sequencingRootHash,
    privateStateTransitionHash: batch.privateStateTransitionHash,
    reason,
    daReference: batch.daReference
  });
  return batch;
}

function appendOrderNote(orderId, notePayload) {
  const current = orderIssuedNotes.get(orderId) || [];
  current.unshift(notePayload);
  if (current.length > 40) current.pop();
  orderIssuedNotes.set(orderId, current);
}

function issueNote(asset, amount, reason, orderId = null, ownerAccountId = null) {
  if (!Number.isFinite(amount) || amount <= 1e-9) return null;
  const note = `zkv_${randomBytes(20).toString('hex')}`;
  const noteHash = sha256Hex(note);
  const createdAtUnixMs = now();
  notes.set(noteHash, {
    noteHash,
    asset,
    amount,
    createdAtUnixMs,
    spentAtUnixMs: null,
    spentNullifier: null,
    ownerAccountId
  });
  poolTotals[asset] = Number(poolTotals[asset] || 0) + amount;
  const payload = { note, noteHash, asset, amount, reason, createdAtUnixMs, orderId, ownerAccountId };
  appendPrivateStateJournalEntry({
    kind: 'note_output',
    noteHash,
    asset,
    amount,
    createdAtUnixMs,
    ownerAccountId: ownerAccountId || null,
    reason,
    orderId: orderId || null
  });
  ensurePrivateStateBatch(reason || 'note_output', ownerAccountId || null).catch(() => {});
  if (orderId) appendOrderNote(orderId, payload);
  if (ownerAccountId) {
    logActivity(ownerAccountId, 'note_issued', { asset, amount, reason, noteHash, orderId });
  }
  return payload;
}

function getBook(pair) {
  const existing = books.get(pair);
  if (existing) return existing;
  const created = { buys: [], sells: [] };
  books.set(pair, created);
  return created;
}

function sortBook(pair) {
  const book = getBook(pair);
  book.buys.sort((a, b) => {
    const A = orders.get(a);
    const B = orders.get(b);
    if (!A || !B) return 0;
    if (A.limitPrice !== B.limitPrice) return B.limitPrice - A.limitPrice;
    return A.createdAtUnixMs - B.createdAtUnixMs;
  });
  book.sells.sort((a, b) => {
    const A = orders.get(a);
    const B = orders.get(b);
    if (!A || !B) return 0;
    if (A.limitPrice !== B.limitPrice) return A.limitPrice - B.limitPrice;
    return A.createdAtUnixMs - B.createdAtUnixMs;
  });
}

function topOfBook(pair) {
  expireEligibleOrders();
  pruneBook(pair);
  const book = getBook(pair);
  const bidOrder =
    book.buys
      .map((id) => orders.get(id))
      .find((o) => o && (o.visibility || 'public') === 'public' && o.status !== 'FILLED' && o.status !== 'CANCELED' && o.remaining > 1e-9) || null;
  const askOrder =
    book.sells
      .map((id) => orders.get(id))
      .find((o) => o && (o.visibility || 'public') === 'public' && o.status !== 'FILLED' && o.status !== 'CANCELED' && o.remaining > 1e-9) || null;
  return {
    bestBid: bidOrder ? bidOrder.limitPrice : null,
    bestAsk: askOrder ? askOrder.limitPrice : null,
    crossQty: bidOrder && askOrder && bidOrder.limitPrice >= askOrder.limitPrice ? Math.min(bidOrder.remaining, askOrder.remaining) : 0
  };
}

function marketSweepQuote(pairSymbol, side, quantity) {
  const depth = bookDepthSnapshot(pairSymbol, 1000);
  const levels = side === 'BUY' ? depth.asks : depth.bids;
  const ordered = Array.isArray(levels) ? levels : [];
  let remaining = Number(quantity || 0);
  let availableQty = 0;
  let terminalPrice = null;
  for (const level of ordered) {
    const size = Number(level?.size || 0);
    const price = Number(level?.price || 0);
    if (!(size > 1e-9) || !(price > 0)) continue;
    availableQty += size;
    terminalPrice = price;
    remaining -= size;
    if (remaining <= 1e-9) break;
  }
  return {
    availableQty: Number(availableQty.toFixed(9)),
    terminalPrice: terminalPrice && Number.isFinite(terminalPrice) ? terminalPrice : null,
    fullFillAvailable: remaining <= 1e-9
  };
}

function aggregateDepthBands(pairSymbol, percentages = [0.02, 0.05]) {
  const depth = bookDepthSnapshot(pairSymbol, 1000);
  const tob = topOfBook(pairSymbol);
  const mid = tob.bestBid !== null && tob.bestAsk !== null ? (tob.bestBid + tob.bestAsk) / 2 : tob.bestBid ?? tob.bestAsk ?? null;
  if (!(Number(mid) > 0)) {
    return {
      mid: null,
      bands: percentages.map((pct) => ({ pct, bidsSize: 0, asksSize: 0 }))
    };
  }
  const bands = percentages.map((pct) => {
    const bidFloor = Number(mid) * (1 - pct);
    const askCeiling = Number(mid) * (1 + pct);
    const bidsSize = (depth.bids || [])
      .filter((level) => Number(level.price || 0) >= bidFloor)
      .reduce((sum, level) => sum + Number(level.size || 0), 0);
    const asksSize = (depth.asks || [])
      .filter((level) => Number(level.price || 0) <= askCeiling)
      .reduce((sum, level) => sum + Number(level.size || 0), 0);
    return {
      pct,
      bidsSize: Number(bidsSize.toFixed(9)),
      asksSize: Number(asksSize.toFixed(9))
    };
  });
  return { mid: Number(mid.toFixed(8)), bands };
}

function cleanupOrder(order, pairConfig) {
  const released = [];
  if (order.reservedQuoteRemaining > 1e-9) {
    const note = issueNote(
      pairConfig.quoteAsset,
      order.reservedQuoteRemaining,
      'unfilled-collateral-refund',
      order.id,
      order.participant
    );
    if (note) released.push({ asset: pairConfig.quoteAsset, amount: order.reservedQuoteRemaining, note });
    order.reservedQuoteRemaining = 0;
  }
  if (order.reservedBaseRemaining > 1e-9) {
    const note = issueNote(
      pairConfig.baseAsset,
      order.reservedBaseRemaining,
      'unfilled-collateral-refund',
      order.id,
      order.participant
    );
    if (note) released.push({ asset: pairConfig.baseAsset, amount: order.reservedBaseRemaining, note });
    order.reservedBaseRemaining = 0;
  }
  return released;
}

function pruneBook(pair) {
  const book = getBook(pair);
  book.buys = book.buys.filter((id) => {
    const order = orders.get(id);
    return order && order.status !== 'FILLED' && order.status !== 'CANCELED' && order.remaining > 1e-9;
  });
  book.sells = book.sells.filter((id) => {
    const order = orders.get(id);
    return order && order.status !== 'FILLED' && order.status !== 'CANCELED' && order.remaining > 1e-9;
  });
}

function cancelOrderInternal(order) {
  const pairConfig = getPairConfigBySymbol(order.pair);
  if (!pairConfig) throw new Error('pair not found');
  if (order.status === 'FILLED' || order.status === 'CANCELED') {
    return { order, released: [] };
  }
  order.status = 'CANCELED';
  order.remaining = 0;
  const released = cleanupOrder(order, pairConfig);
  pruneBook(order.pair);
  queueEngineStatePersist();
  return { order, released };
}

function recordFill(pairSymbol, pairConfig, buy, sell, qty, price, aggressorOrderId, fills) {
  const quoteNotional = qty * price;

  if (buy.reservedQuoteRemaining + 1e-9 < quoteNotional) throw new Error('buy reserved quote exhausted');
  if (sell.reservedBaseRemaining + 1e-9 < qty) throw new Error('sell reserved base exhausted');

  buy.remaining -= qty;
  sell.remaining -= qty;
  buy.reservedQuoteRemaining -= quoteNotional;
  sell.reservedBaseRemaining -= qty;

  buy.status = buy.remaining <= 1e-9 ? 'FILLED' : 'PARTIAL';
  sell.status = sell.remaining <= 1e-9 ? 'FILLED' : 'PARTIAL';

  const fill = {
    tradeId: randomUUID(),
    marketId: pairConfig.marketId,
    pair: pairSymbol,
    quantity: qty,
    price,
    buyCommitment: buy.commitment,
    sellCommitment: sell.commitment,
    buySequencingReceiptHash: buy.sequencingReceiptHash || sequencingReceiptsByCommitment.get(buy.commitment)?.receiptHash || null,
    sellSequencingReceiptHash: sell.sequencingReceiptHash || sequencingReceiptsByCommitment.get(sell.commitment)?.receiptHash || null,
    createdAtUnixMs: now()
  };

  const isBuyTaker = aggressorOrderId === buy.id;
  const isSellTaker = aggressorOrderId === sell.id;
  const takerOrder = isBuyTaker ? buy : isSellTaker ? sell : null;
  const initiatorSide = isBuyTaker ? 'BUY' : isSellTaker ? 'SELL' : null;

  let buyReceiveBase = qty;
  let sellReceiveQuote = quoteNotional;

  if (takerOrder && TAKER_FEE_BPS > 0) {
    if (takerOrder.side === 'BUY') {
      const feeBase = qty * (TAKER_FEE_BPS / 10000);
      buyReceiveBase = Math.max(0, qty - feeBase);
      accumulateFrontendFees({
        frontendId: takerOrder.frontendId,
        asset: pairConfig.baseAsset,
        feeAmount: feeBase,
        quoteNotional,
        pair: pairSymbol,
        tradeId: fill.tradeId
      });
    } else {
      const feeQuote = quoteNotional * (TAKER_FEE_BPS / 10000);
      sellReceiveQuote = Math.max(0, quoteNotional - feeQuote);
      accumulateFrontendFees({
        frontendId: takerOrder.frontendId,
        asset: pairConfig.quoteAsset,
        feeAmount: feeQuote,
        quoteNotional,
        pair: pairSymbol,
        tradeId: fill.tradeId
      });
    }
  }

  const buyWallet = getLinkedWalletForParticipant(buy.participant);
  const sellWallet = getLinkedWalletForParticipant(sell.participant);
  fill.buyParticipant = buy.participant;
  fill.sellParticipant = sell.participant;
  fill.buyWallet = buyWallet;
  fill.sellWallet = sellWallet;
  fill.baseAsset = canonicalAssetKey(pairConfig.baseAsset);
  fill.quoteAsset = canonicalAssetKey(pairConfig.quoteAsset);
  fill.baseTokenId = tokenIdForAsset(pairConfig, pairConfig.baseAsset);
  fill.quoteTokenId = tokenIdForAsset(pairConfig, pairConfig.quoteAsset);
  fill.buyReceiveBase = Number(buyReceiveBase.toFixed(9));
  fill.sellReceiveQuote = Number(sellReceiveQuote.toFixed(9));

  logActivity(buy.participant, 'trade_fill', {
    pair: pairSymbol,
    side: 'BUY',
    initiatorSide,
    price,
    quantity: qty,
    counterpartyCommitment: fill.sellCommitment,
    tradeId: fill.tradeId,
    settlementAsset: fill.baseAsset,
    settlementAmount: fill.buyReceiveBase,
    settlementWallet: fill.buyWallet
  });
  logActivity(sell.participant, 'trade_fill', {
    pair: pairSymbol,
    side: 'SELL',
    initiatorSide,
    price,
    quantity: qty,
    counterpartyCommitment: fill.buyCommitment,
    tradeId: fill.tradeId,
    settlementAsset: fill.quoteAsset,
    settlementAmount: fill.sellReceiveQuote,
    settlementWallet: fill.sellWallet
  });

  fills.push(fill);
  engineMetrics.fillCount += 1;
  engineMetrics.lastFillAtUnixMs = fill.createdAtUnixMs;
  recordAuditEvent('trade_fill', {
    tradeId: fill.tradeId,
    pair: fill.pair,
    quantity: fill.quantity,
    price: fill.price,
    buyCommitment: fill.buyCommitment,
    sellCommitment: fill.sellCommitment,
    buySequencingReceiptHash: fill.buySequencingReceiptHash,
    sellSequencingReceiptHash: fill.sellSequencingReceiptHash,
    buyOrderId: buy.id,
    sellOrderId: sell.id,
    buyWallet: fill.buyWallet,
    sellWallet: fill.sellWallet
  });
  publicTape.unshift(fill);
  if (publicTape.length > 200) publicTape.pop();

  const buyPrivate = privateFillsByOrder.get(buy.id) || [];
  buyPrivate.push({ ...fill, myOrderId: buy.id, counterpartyCommitment: fill.sellCommitment });
  privateFillsByOrder.set(buy.id, buyPrivate);

  const sellPrivate = privateFillsByOrder.get(sell.id) || [];
  sellPrivate.push({ ...fill, myOrderId: sell.id, counterpartyCommitment: fill.buyCommitment });
  privateFillsByOrder.set(sell.id, sellPrivate);
}

function executeMatching(pairSymbol, aggressorOrderId = null) {
  expireEligibleOrders();
  const pairConfig = getPairConfigBySymbol(pairSymbol);
  if (!pairConfig) return [];
  const started = now();
  const book = getBook(pairSymbol);
  const fills = [];

  pruneBook(pairSymbol);
  sortBook(pairSymbol);
  const aggressor = aggressorOrderId ? orders.get(aggressorOrderId) : null;
  if (
    aggressor &&
    aggressor.pair === pairSymbol &&
    aggressor.status !== 'FILLED' &&
    aggressor.status !== 'CANCELED' &&
    aggressor.remaining > 1e-9
  ) {
    const oppositeQueue = aggressor.side === 'BUY' ? book.sells : book.buys;
    while (oppositeQueue.length && aggressor.remaining > 1e-9) {
      const resting = orders.get(oppositeQueue[0]);
      if (!resting || resting.status === 'FILLED' || resting.status === 'CANCELED' || resting.remaining <= 1e-9) {
        oppositeQueue.shift();
        continue;
      }
      const crosses =
        aggressor.side === 'BUY'
          ? aggressor.limitPrice + 1e-9 >= resting.limitPrice
          : resting.limitPrice + 1e-9 >= aggressor.limitPrice;
      if (!crosses) break;

      const qty = Math.min(aggressor.remaining, resting.remaining);
      const price = resting.limitPrice;
      const buy = aggressor.side === 'BUY' ? aggressor : resting;
      const sell = aggressor.side === 'SELL' ? aggressor : resting;
      recordFill(pairSymbol, pairConfig, buy, sell, qty, price, aggressorOrderId, fills);

      if (resting.remaining <= 1e-9) {
        cleanupOrder(resting, pairConfig);
        oppositeQueue.shift();
      }
    }
    if (aggressor.remaining <= 1e-9) {
      cleanupOrder(aggressor, pairConfig);
    }
  }

  pruneBook(pairSymbol);
  sortBook(pairSymbol);
  while (book.buys.length && book.sells.length) {
    const buy = orders.get(book.buys[0]);
    const sell = orders.get(book.sells[0]);
    if (!buy || buy.status === 'FILLED' || buy.status === 'CANCELED' || buy.remaining <= 1e-9) {
      book.buys.shift();
      continue;
    }
    if (!sell || sell.status === 'FILLED' || sell.status === 'CANCELED' || sell.remaining <= 1e-9) {
      book.sells.shift();
      continue;
    }
    if (buy.limitPrice + 1e-9 < sell.limitPrice) break;

    const qty = Math.min(buy.remaining, sell.remaining);
    const price = buy.createdAtUnixMs <= sell.createdAtUnixMs ? buy.limitPrice : sell.limitPrice;
    recordFill(pairSymbol, pairConfig, buy, sell, qty, price, aggressorOrderId, fills);

    if (buy.remaining <= 1e-9) {
      cleanupOrder(buy, pairConfig);
      book.buys.shift();
    }
    if (sell.remaining <= 1e-9) {
      cleanupOrder(sell, pairConfig);
      book.sells.shift();
    }
  }

  pruneBook(pairSymbol);
  const elapsed = Math.max(0, now() - started);
  engineMetrics.matchCallCount += 1;
  engineMetrics.matchLastMs = elapsed;
  engineMetrics.matchTotalMs += elapsed;
  engineMetrics.matchMaxMs = Math.max(engineMetrics.matchMaxMs, elapsed);
  return fills;
}

function availableNotesForAccountAsset(accountId, asset) {
  const key = canonicalAssetKey(asset);
  return Array.from(notes.values())
    .filter((n) => n && n.ownerAccountId === accountId && n.spentAtUnixMs === null && canonicalAssetKey(n.asset) === key)
    .sort((a, b) => Number(a.createdAtUnixMs || 0) - Number(b.createdAtUnixMs || 0));
}

function planOrderNoteFunding({ participant, asset, requiredAmount, fundingNoteHashes }) {
  if (!(Number.isFinite(requiredAmount) && requiredAmount > 1e-9)) {
    return { consumptions: [], noteContribution: 0 };
  }

  let candidates = [];
  if (Array.isArray(fundingNoteHashes) && fundingNoteHashes.length > 0) {
    candidates = fundingNoteHashes.map((noteHash) => {
      const note = notes.get(noteHash);
      if (!note) throw new Error(`funding note not found: ${noteHash}`);
      if (note.spentAtUnixMs !== null) throw new Error(`funding note already spent: ${noteHash}`);
      if (note.ownerAccountId !== participant) throw new Error(`funding note owner mismatch: ${noteHash}`);
      if (canonicalAssetKey(note.asset) !== canonicalAssetKey(asset)) {
        throw new Error(`funding note asset mismatch: expected ${asset}, got ${note.asset}`);
      }
      return note;
    });
  } else {
    candidates = availableNotesForAccountAsset(participant, asset);
  }

  let remaining = Number(requiredAmount);
  const consumptions = [];
  for (const note of candidates) {
    if (remaining <= 1e-9) break;
    const amount = Number(note.amount || 0);
    if (!Number.isFinite(amount) || amount <= 1e-9) continue;
    const consumeAmount = Math.min(amount, remaining);
    if (consumeAmount <= 1e-9) continue;
    consumptions.push({ note, consumeAmount });
    remaining -= consumeAmount;
  }

  const noteContribution = Number(
    consumptions.reduce((sum, item) => sum + Number(item.consumeAmount || 0), 0).toFixed(9)
  );
  if (noteContribution + 1e-9 < requiredAmount) {
    throw new Error(`insufficient note funding for ${asset}: required ${requiredAmount}, available ${noteContribution}`);
  }
  return { consumptions, noteContribution };
}

function applyOrderNoteFunding({ participant, asset, orderId, consumptions }) {
  const consumedFundingNotes = [];
  const issuedChangeNotes = [];
  const nowUnixMs = now();
  for (const item of consumptions || []) {
    const note = item.note;
    const consumeAmount = Number(item.consumeAmount || 0);
    if (!note || note.spentAtUnixMs !== null || consumeAmount <= 1e-9) continue;
    const fullAmount = Number(note.amount || 0);
    if (!Number.isFinite(fullAmount) || fullAmount <= 1e-9) continue;
    if (fullAmount + 1e-9 < consumeAmount) throw new Error('invalid note consumption amount');
    const noteAssetKey = canonicalAssetKey(note.asset);
    if (Number(poolTotals[noteAssetKey] || 0) + 1e-9 < fullAmount) {
      rebuildPoolTotalsFromNotes();
    }
    if (Number(poolTotals[noteAssetKey] || 0) + 1e-9 < fullAmount) {
      // The note itself is canonical; don't block valid spends on stale aggregate totals.
      poolTotals[noteAssetKey] = Number(poolTotals[noteAssetKey] || 0) + fullAmount;
    }
    const nullifier = computeNoteNullifier(note.noteHash, note.ownerAccountId || participant);
    if (spentNullifiers.has(nullifier)) {
      throw new Error(`funding note nullifier already used: ${note.noteHash}`);
    }
    note.spentAtUnixMs = nowUnixMs;
    note.spentNullifier = nullifier;
    spentNullifiers.add(nullifier);
    appendPrivateStateJournalEntry({
      kind: 'note_spend',
      noteHash: note.noteHash,
      asset: note.asset,
      amount: fullAmount,
      createdAtUnixMs: note.createdAtUnixMs,
      ownerAccountId: note.ownerAccountId || participant,
      spentAtUnixMs: nowUnixMs,
      nullifier,
      reason: 'order_funding',
      orderId
    });
    poolTotals[noteAssetKey] = Math.max(0, Number(poolTotals[noteAssetKey] || 0) - fullAmount);

    const changeAmount = Number((fullAmount - consumeAmount).toFixed(9));
    let changeNote = null;
    if (changeAmount > 1e-9) {
      changeNote = issueNote(noteAssetKey, changeAmount, 'order_note_change', orderId, participant);
      if (changeNote) issuedChangeNotes.push(changeNote);
    }
    consumedFundingNotes.push({
      noteHash: note.noteHash,
      asset: note.asset,
      originalAmount: fullAmount,
      consumedAmount: Number(consumeAmount.toFixed(9)),
      changeAmount: changeAmount > 1e-9 ? changeAmount : 0,
      nullifier
    });
    logActivity(participant, 'note_spent_for_order', {
      orderId,
      asset: note.asset,
      noteHash: note.noteHash,
      nullifier,
      consumedAmount: Number(consumeAmount.toFixed(9)),
      changeAmount: changeAmount > 1e-9 ? changeAmount : 0
    });
  }
  ensurePrivateStateBatch('order_funding', participant).catch(() => {});
  return { consumedFundingNotes, issuedChangeNotes };
}

function notePortfolioForAccount(accountId) {
  const account = getAccount(accountId);
  const outstanding = [];
  const outstandingByAsset = {};
  for (const note of notes.values()) {
    if (!note || note.ownerAccountId !== accountId) continue;
    if (note.spentAtUnixMs !== null) continue;
    outstanding.push(note);
    const key = canonicalAssetKey(note.asset);
    outstandingByAsset[key] = Number(outstandingByAsset[key] || 0) + Number(note.amount || 0);
  }
  return {
    accountId,
    wallet: account.__wallet || null,
    onchainTotals: account.__onchainTotals || {},
    availableBalances: { ...(account.__onchainTotals || {}) },
    outstandingNoteCount: outstanding.length,
    outstandingByAsset,
    outstandingNotes: outstanding
      .sort((a, b) => Number(b.createdAtUnixMs || 0) - Number(a.createdAtUnixMs || 0))
      .slice(0, 200)
      .map((n) => ({
        noteHash: n.noteHash,
        asset: n.asset,
        amount: n.amount,
        createdAtUnixMs: n.createdAtUnixMs
      }))
  };
}

function publicCandles({ marketId = null, pair = null, intervalSec = 60, limit = 120 } = {}) {
  const interval = Math.min(Math.max(Number(intervalSec) || 60, 1), 86400);
  const maxRows = Math.min(Math.max(Number(limit) || 120, 1), 1000);
  const filtered = publicTape
    .filter((fill) => {
      if (marketId && fill.marketId) return fill.marketId === marketId;
      if (pair) return fill.pair === pair;
      return true;
    })
    .slice()
    .sort((a, b) => Number(a.createdAtUnixMs || 0) - Number(b.createdAtUnixMs || 0));
  const buckets = new Map();
  for (const fill of filtered) {
    const tsMs = Number(fill.createdAtUnixMs || 0);
    const price = Number(fill.price || 0);
    const qty = Number(fill.quantity || 0);
    if (!(tsMs > 0) || !(price > 0) || !(qty > 0)) continue;
    const bucketSec = Math.floor(tsMs / 1000 / interval) * interval;
    const existing = buckets.get(bucketSec);
    if (!existing) {
      buckets.set(bucketSec, {
        time: bucketSec,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: qty,
        trades: 1
      });
      continue;
    }
    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
    existing.volume = Number(existing.volume || 0) + qty;
    existing.trades += 1;
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .slice(-maxRows);
}

function placeOrder({
  participant,
  pairConfig,
  side,
  limitPrice,
  quantity,
  timeInForce,
  orderType = 'LIMIT',
  visibility = 'public',
  privateMemo,
  fundingNoteHashes = [],
  frontendId = null
}) {
  let reservedQuote = 0;
  let reservedBase = 0;
  const orderId = randomUUID();
  let consumedFundingNotes = [];

  if (side === 'BUY') {
    reservedQuote = limitPrice * quantity;
    const fundingPlan = planOrderNoteFunding({
      participant,
      asset: pairConfig.quoteAsset,
      requiredAmount: reservedQuote,
      fundingNoteHashes
    });
    const applied = applyOrderNoteFunding({
      participant,
      asset: pairConfig.quoteAsset,
      orderId,
      consumptions: fundingPlan.consumptions
    });
    consumedFundingNotes = applied.consumedFundingNotes;
  } else {
    reservedBase = quantity;
    const fundingPlan = planOrderNoteFunding({
      participant,
      asset: pairConfig.baseAsset,
      requiredAmount: reservedBase,
      fundingNoteHashes
    });
    const applied = applyOrderNoteFunding({
      participant,
      asset: pairConfig.baseAsset,
      orderId,
      consumptions: fundingPlan.consumptions
    });
    consumedFundingNotes = applied.consumedFundingNotes;
  }

  const payload = JSON.stringify({
    participant,
    pair: pairConfig.symbol,
    side,
    limitPrice,
    quantity,
    privateMemo,
    nonce: randomBytes(12).toString('hex')
  });

  const order = {
    id: orderId,
    marketId: pairConfig.marketId,
    pair: pairConfig.symbol,
    participant,
    side,
    orderType,
    visibility: visibility === 'private' ? 'private' : 'public',
    limitPrice,
    quantity,
    remaining: quantity,
    reservedQuoteRemaining: reservedQuote,
    reservedBaseRemaining: reservedBase,
    timeInForce,
    commitment: sha256Hex(payload),
    createdAtUnixMs: now(),
    cancelToken: randomBytes(16).toString('hex'),
    status: 'OPEN',
    frontendId
  };

  orders.set(order.id, order);
  privateFillsByOrder.set(order.id, []);
  const book = getBook(pairConfig.symbol);
  if (side === 'BUY') book.buys.push(order.id);
  else book.sells.push(order.id);

  const fills = executeMatching(pairConfig.symbol, order.id);
  if (timeInForce === 'IOC' && order.status !== 'FILLED') {
    order.status = 'CANCELED';
    order.remaining = 0;
    cleanupOrder(order, pairConfig);
    pruneBook(pairConfig.symbol);
  }

  queueEngineStatePersist();
  return {
    order,
    fills,
    consumedFundingNote: consumedFundingNotes[0] || null,
    consumedFundingNotes
  };
}

function sanitizeOrder(order) {
  return {
    id: order.id,
    marketId: order.marketId || null,
    pair: order.pair,
    side: order.side,
    orderType: order.orderType || 'LIMIT',
    visibility: order.visibility || 'public',
    quantity: order.quantity,
    remaining: order.remaining,
    timeInForce: order.timeInForce,
    commitment: order.commitment,
    sequenceNumber: order.sequenceNumber || null,
    sequencingReceiptHash: order.sequencingReceiptHash || null,
    makerTag: order.makerTag || null,
    frontendId: order.frontendId || null,
    status: order.status,
    createdAtUnixMs: order.createdAtUnixMs
  };
}

function activeOrdersForAccount(pair, accountId) {
  return Array.from(orders.values()).filter(
    (o) =>
      o.pair === pair &&
      o.participant === accountId &&
      o.status !== 'FILLED' &&
      o.status !== 'CANCELED' &&
      o.remaining > 1e-9
  );
}

function marketSnapshot() {
  return Array.from(pairs.values()).map((pair) => {
    const tob = topOfBook(pair.symbol);
    const openOrderCount = getBook(pair.symbol).buys.length + getBook(pair.symbol).sells.length;
    const indicativeMid = tob.bestBid !== null && tob.bestAsk !== null ? (tob.bestBid + tob.bestAsk) / 2 : tob.bestBid ?? tob.bestAsk ?? null;
    const effectiveReferencePrice = indicativeMid !== null ? indicativeMid : pair.referencePrice;
    const depthBands = aggregateDepthBands(pair.symbol);
    pair.referencePrice = effectiveReferencePrice;
    return {
      marketId: pair.marketId,
      pair: pair.symbol,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      baseTokenId: pair.baseTokenId,
      quoteTokenId: pair.quoteTokenId,
      referencePrice: effectiveReferencePrice,
      bestBid: tob.bestBid,
      bestAsk: tob.bestAsk,
      indicativeMid,
      openOrderCount,
      depthBands
    };
  });
}

function bookDepthSnapshot(pairSymbol, maxLevels = 20) {
  const bidLevels = new Map();
  const askLevels = new Map();

  for (const order of orders.values()) {
    if (order.pair !== pairSymbol) continue;
    if ((order.visibility || 'public') !== 'public') continue;
    if (order.status === 'FILLED' || order.status === 'CANCELED') continue;
    if (order.remaining <= 1e-9) continue;
    const key = Number(order.limitPrice).toFixed(8);
    if (order.side === 'BUY') {
      bidLevels.set(key, Number(bidLevels.get(key) || 0) + Number(order.remaining));
    } else {
      askLevels.set(key, Number(askLevels.get(key) || 0) + Number(order.remaining));
    }
  }

  const bids = Array.from(bidLevels.entries())
    .map(([price, size]) => ({ price: Number(price), size }))
    .sort((a, b) => b.price - a.price)
    .slice(0, maxLevels);

  const asks = Array.from(askLevels.entries())
    .map(([price, size]) => ({ price: Number(price), size }))
    .sort((a, b) => a.price - b.price)
    .slice(0, maxLevels);

  return { pair: pairSymbol, bids, asks };
}

function makeNote(asset, amount) {
  return issueNote(asset, amount, 'vault-deposit');
}

async function runJsonCommand(command, input) {
  if (!command) throw new Error('command is required');
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: projectRoot,
      env: process.env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `command exited ${code}`).trim()));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        resolve({ ok: true });
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(
          new Error(
            `command returned non-JSON output: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    });
    child.stdin.end(input ? JSON.stringify(input) : '');
  });
}

async function runJsonCommandCapture(command, envOverrides = {}) {
  if (!command) throw new Error('command is required');
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...envOverrides
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: Number.isFinite(code) ? code : 1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function requireMinaAddress(value, field) {
  const address = requireString(value, field);
  if (!/^B62[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(address)) {
    throw new Error(`${field} must be a valid Mina address`);
  }
  return address;
}

async function claimZekoTestnetFaucet(address) {
  if (!ZEKO_FAUCET_COMMAND) throw new Error('zeko faucet command is not configured');
  if (!ZEKO_FAUCET_GITHUB_TOKEN) throw new Error('zeko faucet github token is not configured');
  const target = requireMinaAddress(address, 'wallet');
  const command = `${ZEKO_FAUCET_COMMAND} claim ${target} --json`;
  const result = await runJsonCommandCapture(command, {
    GITHUB_TOKEN: ZEKO_FAUCET_GITHUB_TOKEN
  });
  const payloadText = result.stdout || result.stderr || '';
  let payload = null;
  if (payloadText) {
    try {
      payload = JSON.parse(payloadText);
    } catch {}
  }
  if (payload && typeof payload === 'object') {
    return {
      ok: Boolean(payload.success),
      exitCode: result.code,
      faucet: payload
    };
  }
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `faucet command exited ${result.code}`).trim());
  }
  return {
    ok: true,
    exitCode: result.code,
    faucet: {
      success: true,
      address: target,
      message: 'Claim submitted'
    }
  };
}

async function submitOnchainWithdrawalPayout({ accountId, wallet, asset, tokenId, amount }) {
  if (!SETTLEMENT_PAYOUT_COMMAND) {
    throw new Error('SETTLEMENT_PAYOUT_COMMAND is required for note withdrawals');
  }
  const syntheticBatch = {
    batchId: `withdraw_${randomUUID()}`,
    batchType: 'trade_settlement',
    status: 'pending',
    payouts: [{ participant: accountId, wallet, asset, tokenId, amount }]
  };
  return await runJsonCommand(SETTLEMENT_PAYOUT_COMMAND, { batch: syntheticBatch });
}

async function withdrawNoteCollateral({ accountId, wallet, asset, amount, fundingNoteHashes = [] }) {
  const canonicalAsset = canonicalAssetKey(asset);
  const numericAmount = Number(amount || 0);
  if (!(numericAmount > 1e-9)) throw new Error('withdraw amount must be positive');
  const assetConfig = getAssetConfig(canonicalAsset);
  if (!assetConfig?.tokenId) throw new Error(`unsupported withdraw asset ${canonicalAsset}`);

  const { consumptions } = planOrderNoteFunding({
    participant: accountId,
    asset: canonicalAsset,
    requiredAmount: numericAmount,
    fundingNoteHashes
  });
  const nowUnixMs = now();
  const staged = [];
  for (const item of consumptions) {
    const note = item.note;
    const consumeAmount = Number(item.consumeAmount || 0);
    const fullAmount = Number(note?.amount || 0);
    if (!note || note.spentAtUnixMs !== null || !(consumeAmount > 1e-9) || !(fullAmount > 1e-9)) continue;
    const noteAssetKey = canonicalAssetKey(note.asset);
    const nullifier = computeNoteNullifier(note.noteHash, note.ownerAccountId || accountId);
    if (spentNullifiers.has(nullifier)) {
      throw new Error(`withdraw note nullifier already used: ${note.noteHash}`);
    }
    staged.push({
      note,
      fullAmount,
      consumeAmount,
      changeAmount: Number((fullAmount - consumeAmount).toFixed(9)),
      nullifier,
      previousSpentAtUnixMs: note.spentAtUnixMs,
      previousSpentNullifier: note.spentNullifier,
      previousPoolTotal: Number(poolTotals[noteAssetKey] || 0)
    });
    note.spentAtUnixMs = nowUnixMs;
    note.spentNullifier = nullifier;
    spentNullifiers.add(nullifier);
    poolTotals[noteAssetKey] = Math.max(0, Number(poolTotals[noteAssetKey] || 0) - fullAmount);
  }

  try {
    const payout = await submitOnchainWithdrawalPayout({
      accountId,
      wallet,
      asset: canonicalAsset,
      tokenId: assetConfig.tokenId,
      amount: Number(numericAmount.toFixed(9))
    });
    const payoutTxs = Array.isArray(payout?.payoutTxs) ? payout.payoutTxs : [];
    const txHash = payoutTxs[0]?.txHash || null;
    const consumedFundingNotes = [];
    const issuedNotes = [];
    for (const item of staged) {
      const noteAssetKey = canonicalAssetKey(item.note.asset);
      appendPrivateStateJournalEntry({
        kind: 'note_spend',
        noteHash: item.note.noteHash,
        asset: item.note.asset,
        amount: item.fullAmount,
        createdAtUnixMs: item.note.createdAtUnixMs,
        ownerAccountId: item.note.ownerAccountId || accountId,
        spentAtUnixMs: nowUnixMs,
        nullifier: item.nullifier,
        reason: 'withdrawal',
        orderId: null
      });
      if (item.changeAmount > 1e-9) {
        const changeNote = issueNote(noteAssetKey, item.changeAmount, 'withdraw_note_change', null, accountId);
        if (changeNote) issuedNotes.push(changeNote);
      }
      consumedFundingNotes.push({
        noteHash: item.note.noteHash,
        asset: item.note.asset,
        originalAmount: item.fullAmount,
        consumedAmount: Number(item.consumeAmount.toFixed(9)),
        changeAmount: item.changeAmount > 1e-9 ? item.changeAmount : 0,
        nullifier: item.nullifier
      });
    }
    withdrawals.unshift({
      id: randomUUID(),
      accountId,
      wallet,
      asset: canonicalAsset,
      amount: Number(numericAmount.toFixed(9)),
      txHash,
      createdAtUnixMs: nowUnixMs,
      consumedFundingNotes
    });
    if (withdrawals.length > 500) withdrawals.pop();
    logActivity(accountId, 'note_withdrawn', {
      asset: canonicalAsset,
      amount: Number(numericAmount.toFixed(9)),
      recipient: wallet,
      txHash
    });
    for (const entry of consumedFundingNotes) {
      logActivity(accountId, 'note_spent_for_withdrawal', {
        asset: entry.asset,
        noteHash: entry.noteHash,
        consumedAmount: entry.consumedAmount,
        changeAmount: entry.changeAmount,
        nullifier: entry.nullifier,
        recipient: wallet,
        txHash
      });
    }
    await ensurePrivateStateBatch('withdrawal', accountId);
    scheduleParticipantOnchainResync(accountId, wallet, 'withdrawal');
    queueEngineStatePersist();
    return {
      ok: true,
      wallet,
      asset: canonicalAsset,
      amount: Number(numericAmount.toFixed(9)),
      txHash,
      payoutTxs,
      consumedFundingNotes,
      issuedNotes,
      participantBalances: accountBalanceSnapshot(accountId)
    };
  } catch (error) {
    for (const item of staged) {
      const noteAssetKey = canonicalAssetKey(item.note.asset);
      item.note.spentAtUnixMs = item.previousSpentAtUnixMs;
      item.note.spentNullifier = item.previousSpentNullifier;
      spentNullifiers.delete(item.nullifier);
      poolTotals[noteAssetKey] = item.previousPoolTotal;
    }
    throw error;
  }
}

function spendNote(rawNote) {
  const noteHash = sha256Hex(rawNote);
  const note = notes.get(noteHash);
  if (!note) throw new Error('note not found');
  if (note.spentAtUnixMs !== null) throw new Error('note already spent');
  const nullifier = computeNoteNullifier(note.noteHash, note.ownerAccountId || '');
  if (spentNullifiers.has(nullifier)) throw new Error('note nullifier already used');
  note.spentAtUnixMs = now();
  note.spentNullifier = nullifier;
  spentNullifiers.add(nullifier);
  appendPrivateStateJournalEntry({
    kind: 'note_spend',
    noteHash: note.noteHash,
    asset: note.asset,
    amount: Number(note.amount || 0),
    createdAtUnixMs: note.createdAtUnixMs,
    ownerAccountId: note.ownerAccountId || null,
    spentAtUnixMs: note.spentAtUnixMs,
    nullifier,
    reason: 'note_redeem',
    orderId: null
  });
  ensurePrivateStateBatch('note_redeem', note.ownerAccountId || null).catch(() => {});
  return note;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function writeJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data, null, 2));
}

async function markBatchCommittedInternal(batchId, txHash = null, payoutTxs = []) {
  const target = settlementBatches.find((b) => Number(b.batchId) === Number(batchId));
  if (!target) throw new Error('batch not found');

  if (
    target.batchType === 'trade_settlement' &&
    target.status !== 'committed' &&
    (target.requiresOnchainPayouts !== undefined
      ? Boolean(target.requiresOnchainPayouts)
      : SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS) &&
    !(typeof txHash === 'string' && txHash.startsWith('local_'))
  ) {
    const requiredPayouts = Array.isArray(target.payouts) ? target.payouts : [];
    const provided = Array.isArray(payoutTxs) ? payoutTxs : [];
    if (requiredPayouts.length > 0 && provided.length === 0) {
      throw new Error('on-chain payout tx proofs are required for this settlement batch');
    }
    const providedByKey = new Map();
    for (const item of provided) {
      const wallet = requireString(item.wallet, 'payoutTxs[].wallet');
      const tokenId = requireString(item.tokenId, 'payoutTxs[].tokenId');
      const key = `${wallet}|${tokenId}`;
      if (providedByKey.has(key)) throw new Error(`duplicate payout proof for ${key}`);
      providedByKey.set(key, item);
    }
    const verifiedPayouts = [];
    for (const payout of requiredPayouts) {
      const key = `${payout.wallet}|${payout.tokenId}`;
      const proof = providedByKey.get(key);
      if (!proof) throw new Error(`missing payout proof for ${payout.wallet} ${payout.asset}`);
      const txHashProof = requireString(proof.txHash, 'payoutTxs[].txHash');
      if (usedSettlementPayoutTxHashes.has(txHashProof)) {
        throw new Error(`payout tx hash already used: ${txHashProof}`);
      }
      const verified = await verifyOnchainPayoutTx({
        txHash: txHashProof,
        wallet: payout.wallet,
        tokenId: payout.tokenId,
        amount: Number(payout.amount || 0)
      });
      usedSettlementPayoutTxHashes.add(verified.txHash);
      verifiedPayouts.push({
        wallet: payout.wallet,
        asset: payout.asset,
        tokenId: payout.tokenId,
        amount: payout.amount,
        txHash: verified.txHash
      });
    }
    target.payoutVerification = {
      requiredCount: requiredPayouts.length,
      providedCount: provided.length,
      verifiedAtUnixMs: now(),
      payouts: verifiedPayouts
    };
  }

  if (target.status !== 'committed') {
    if (SETTLEMENT_PROCEEDS_AS_NOTES && target.batchType === 'trade_settlement') {
      target.noteSettlementOutputs = issueSettlementProceedsNotes(target);
      target.privateStateDelta = buildLivePrivateStateDelta();
      target.noteRootHash = computeNoteCommitmentRoot();
      target.nullifierRootHash = computeSpentNullifierRoot();
      target.sequencingRootHash = computeSequencingReceiptRoot();
      target.privateStateTransitionHash = computePrivateStateTransitionHashForBatch(target);
    }
    target.status = 'committed';
    target.committedAtUnixMs = now();
    target.txHash = txHash;
    const committedIds = new Set(
      [
        ...(Array.isArray(target?.privateStateDelta?.noteSpends) ? target.privateStateDelta.noteSpends : []),
        ...(Array.isArray(target?.privateStateDelta?.noteOutputs) ? target.privateStateDelta.noteOutputs : []),
        ...(Array.isArray(target?.privateStateDelta?.sequencingReceipts) ? target.privateStateDelta.sequencingReceipts : [])
      ]
        .map((entry) => entry?.id)
        .filter((value) => typeof value === 'string' && value.trim())
    );
    if (committedIds.size > 0) {
      for (const entry of privateStateJournal) {
        if (committedIds.has(entry?.id)) entry.committedBatchId = target.batchId;
      }
      const retained = privateStateJournal.filter(
        (entry) => !Number.isFinite(Number(entry?.committedBatchId)) || now() - Number(entry?.createdAtUnixMs || 0) < 7 * 24 * 60 * 60 * 1000
      );
      privateStateJournal.length = 0;
      privateStateJournal.push(...retained);
      queueEngineStatePersist();
    }
    await persistSettlementBatches();
    recordAuditEvent('settlement_batch_committed', {
      batchId: target.batchId,
      batchHash: target.batchHash,
      txHash: target.txHash,
      payoutProofCount: Array.isArray(target?.payoutVerification?.payouts) ? target.payoutVerification.payouts.length : 0,
      committedAtUnixMs: target.committedAtUnixMs
    });
  }
  return target;
}

async function cacheBatchPayoutProofsInternal(batchId, payoutTxs = []) {
  const target = settlementBatches.find((b) => Number(b.batchId) === Number(batchId));
  if (!target) throw new Error('batch not found');
  if (target.status === 'committed') throw new Error('cannot cache payout proofs for a committed batch');
  if (target.batchType !== 'trade_settlement') throw new Error('payout proofs only apply to trade settlement batches');
  const provided = Array.isArray(payoutTxs) ? payoutTxs : [];
  if (!provided.length) throw new Error('payoutTxs are required');
  target.payoutSubmission = {
    submittedAtUnixMs: now(),
    payoutCount: provided.length,
    payoutTxs: provided.map((item) => ({
      wallet: requireString(item.wallet, 'payoutTxs[].wallet'),
      tokenId: requireString(item.tokenId, 'payoutTxs[].tokenId'),
      txHash: requireString(item.txHash, 'payoutTxs[].txHash')
    }))
  };
  await persistSettlementBatches();
  return target;
}

function privateStateProofArtifactPath(batchId) {
  return path.resolve(projectRoot, 'data', 'private-state-proofs', `batch-${batchId}.json`);
}

async function cachePrivateStateProofInternal(batchId, proofArtifact, metadata = {}) {
  const target = settlementBatches.find((b) => Number(b.batchId) === Number(batchId));
  if (!target) throw new Error('batch not found');
  if (target.status === 'committed') throw new Error('cannot cache private-state proof for a committed batch');
  if (!proofArtifact || typeof proofArtifact !== 'object') throw new Error('proofArtifact must be an object');
  if (Number(proofArtifact.batchId || 0) !== Number(batchId)) {
    throw new Error(`proof artifact batchId mismatch for batch ${batchId}`);
  }
  if (String(proofArtifact.batchHash || '') !== String(target.batchHash || '')) {
    throw new Error(`proof artifact batchHash mismatch for batch ${batchId}`);
  }
  const artifactPath = privateStateProofArtifactPath(batchId);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(proofArtifact, null, 2), 'utf8');
  target.privateStateProofSubmission = {
    submittedAtUnixMs: now(),
    source: metadata.source || 'api-upload',
    batchHash: String(proofArtifact.batchHash || target.batchHash || ''),
    proofTransitionHash: String(proofArtifact?.publicInput?.transitionHash || ''),
    artifactPath
  };
  await persistSettlementBatches();
  return target;
}

async function commitNextPendingBatchLocal() {
  const pending = settlementBatches
    .filter((b) => b.status === 'pending')
    .sort((a, b) => Number(a.batchId) - Number(b.batchId))[0];
  if (!pending) return null;
  const txHash = `local_${pending.batchHash.slice(0, 20)}_${Date.now().toString(36)}`;
  return markBatchCommittedInternal(pending.batchId, txHash);
}

function computeZkappReadiness() {
  const pendingBatch = settlementBatches
    .filter((b) => b.status === 'pending')
    .sort((a, b) => Number(a.batchId) - Number(b.batchId))[0] || null;
  return {
    graphqlConfigured: Boolean(ZEKO_SETTLEMENT_GRAPHQL),
    deployerKeyConfigured: Boolean(process.env.DEPLOYER_PRIVATE_KEY),
    zkappPrivateKeyConfigured: Boolean(process.env.ZKAPP_PRIVATE_KEY),
    zkappPublicKeyConfigured: Boolean(ZKAPP_PUBLIC_KEY),
    operatorPublicKeyConfigured: Boolean(OPERATOR_PUBLIC_KEY),
    readyToDeploy: Boolean(ZEKO_SETTLEMENT_GRAPHQL && process.env.DEPLOYER_PRIVATE_KEY && process.env.ZKAPP_PRIVATE_KEY),
    readyToCommit: Boolean(ZEKO_SETTLEMENT_GRAPHQL && process.env.DEPLOYER_PRIVATE_KEY && ZKAPP_PUBLIC_KEY),
    zkappPublicKey: ZKAPP_PUBLIC_KEY || null,
    operatorPublicKey: OPERATOR_PUBLIC_KEY || null,
    operatorPanelAllowedWallet: OPERATOR_PANEL_ALLOWED_WALLET || null,
    operatorPanelAdminKeyConfigured: Boolean(OPERATOR_PANEL_ADMIN_KEY),
    nextPendingBatchId: pendingBatch ? pendingBatch.batchId : null
  };
}

async function validateOperatorPanelAccess(body, action) {
  const adminKey = String(body?.adminKey || '').trim();
  if (OPERATOR_PANEL_ADMIN_KEY) {
    if (!adminKey) throw new Error('operator admin key is required');
    if (adminKey !== OPERATOR_PANEL_ADMIN_KEY) throw new Error('operator admin key is invalid');
    return { mode: 'admin-key' };
  }
  return validateOperatorPanelAuthorization(action, body?.authorization);
}

function computeStatusSnapshot(port) {
  const pendingSettlementCount = settlementBatches.filter((b) => b.status === 'pending').length;
  const committedSettlementCount = settlementBatches.filter((b) => b.status === 'committed').length;
  const openOrders = Array.from(orders.values()).filter((o) => o.status !== 'FILLED' && o.status !== 'CANCELED' && o.remaining > 1e-9);
  const avgMatchMs = engineMetrics.matchCallCount > 0 ? engineMetrics.matchTotalMs / engineMetrics.matchCallCount : 0;
  const auditStatus = getAuditChainStatus(auditTrail);
  return {
    ok: true,
    nowUnixMs: now(),
    uptimeSec: Math.floor((now() - startedAtUnixMs) / 1000),
    server: {
      buildId: SERVER_BUILD_ID,
      port,
      autoSettlement: AUTO_SETTLEMENT,
      autoSettlementIntervalMs: AUTO_SETTLEMENT_INTERVAL_MS,
      localSettlementEnabled: ENABLE_LOCAL_SETTLEMENT,
      realFundsMode: REAL_FUNDS_MODE,
      onchainSyncTtlMs: ONCHAIN_SYNC_TTL_MS,
      requireOnchainDepositTx: REQUIRE_ONCHAIN_DEPOSIT_TX,
      settlementRequireOnchainPayouts: SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS,
      vaultDepositAddress: VAULT_DEPOSIT_ADDRESS || null,
      vaultDepositAddressConfigured: Boolean(VAULT_DEPOSIT_ADDRESS),
      tokenContractAddresses: TOKEN_CONTRACT_ADDRESSES,
      txVerification: {
        balanceEndpoint: ZEKO_GRAPHQL || null,
        txEndpointConfigured: ZEKO_TX_GRAPHQL_ENV || null,
        txEndpointEffective: ZEKO_TX_GRAPHQL || null,
        archiveEndpoint: ZEKO_ARCHIVE_GRAPHQL || null,
        archiveRelayEndpoint: ZEKO_ARCHIVE_RELAY_GRAPHQL || null,
        hasDedicatedTxEndpoint: Boolean(ZEKO_TX_GRAPHQL_ENV && ZEKO_TX_GRAPHQL_ENV !== ZEKO_GRAPHQL)
      },
      userConfirmation: {
        model: 'zeko-sequencer',
        ethereumFinalityRequired: false,
        noteIssuanceRequiresDepositHash: REQUIRE_ONCHAIN_DEPOSIT_TX
      },
      walletNetwork: WALLET_NETWORK_CONFIG,
      executionPrivacy: {
        currentMode: 'lean',
        fullModeReferencePath: true,
        proofWorkerAutoStart: Boolean(AUTO_RUN_PROOF_WORKER),
        secureModeAvailable: SECURE_MODE_IMPLEMENTED,
        secureModeBoundary: 'encrypted matcher inside an attested execution environment'
      },
      activityPrivacy: {
        mode: ACTIVITY_PRIVACY_MODE,
        serverDetailsStored: !OPERATOR_ACTIVITY_REDACTION_ENABLED,
        clientTimelineStorage: 'browser-local'
      },
      da: {
        mode: DA_MODE,
        enabled: Boolean(DA_ENDPOINT),
        endpointConfigured: Boolean(DA_ENDPOINT),
        requireEncryption: DA_REQUIRE_ENCRYPTION,
        includeOrderSnapshot: DA_INCLUDE_ORDER_SNAPSHOT,
        encryptionConfigured: Boolean(DA_ENCRYPTION_KEY),
        zekoNetwork: ZEKO_DA_NETWORK,
        zekoAppId: ZEKO_DA_APP_ID
      },
      settlementBatching: {
        maxTrades: SETTLEMENT_BATCH_MAX_TRADES,
        maxDelayMs: SETTLEMENT_BATCH_MAX_DELAY_MS
      },
      faucet: {
        enabled: Boolean(ZEKO_FAUCET_COMMAND && ZEKO_FAUCET_GITHUB_TOKEN),
        commandConfigured: Boolean(ZEKO_FAUCET_COMMAND),
        githubTokenConfigured: Boolean(ZEKO_FAUCET_GITHUB_TOKEN)
      },
      gtcOrderExpiryMs: GTC_ORDER_EXPIRY_MS,
      zkapp: computeZkappReadiness()
    },
    matching: {
      orderAcceptedCount: engineMetrics.orderAcceptedCount,
      orderRejectedCount: engineMetrics.orderRejectedCount,
      cancelCount: engineMetrics.cancelCount,
      fillCount: engineMetrics.fillCount,
      matchCallCount: engineMetrics.matchCallCount,
      matchLastMs: engineMetrics.matchLastMs,
      matchAvgMs: Number(avgMatchMs.toFixed(3)),
      matchMaxMs: engineMetrics.matchMaxMs,
      lastOrderAtUnixMs: engineMetrics.lastOrderAtUnixMs,
      lastFillAtUnixMs: engineMetrics.lastFillAtUnixMs
    },
    orderbook: {
      openOrders: openOrders.length,
      byPair: Array.from(pairs.values()).map((pair) => {
        const book = getBook(pair.symbol);
        return {
          pair: pair.symbol,
          bids: book.buys.length,
          asks: book.sells.length
        };
      })
    },
    settlement: {
      pendingSettlementCount,
      committedSettlementCount,
      pendingPayoutBatches: settlementBatches.filter(
        (b) => b.status === 'pending' && b.batchType === 'trade_settlement' && Array.isArray(b.payouts) && b.payouts.length > 0
      ).length,
      nextSettlementBatchId,
      latestBatch: settlementBatches[0] || null
    },
    integrity: {
      openOrderBookHash: computeBookHash(),
      noteCommitmentRootHash: computeNoteCommitmentRoot(),
      spentNullifierRootHash: computeSpentNullifierRoot(),
      sequencingReceiptRootHash: computeSequencingReceiptRoot(),
      lastAnchoredBookHash,
      orderStatePersistence: Boolean(engineStatePath),
      orderStateEncrypted: Boolean(ORDER_STATE_ENCRYPTION_KEY),
      bookAnchorIntervalMs: BOOK_ANCHOR_INTERVAL_MS,
      spentNullifierCount: spentNullifiers.size
    },
    fairness: {
      matchingRule: 'strict-price-time-priority',
      receiptSignature: ORDER_RECEIPT_SECRET ? 'enabled' : 'disabled',
      auditHeadHash,
      auditCount: auditTrail.length,
      auditValid: auditStatus.valid,
      auditBreakIndex: auditStatus.breakIndex,
      auditBreakReason: auditStatus.reason,
      auditGapDetected,
      auditGapIndex,
      auditGapExpectedPrevHash,
      auditGapActualPrevHash
    }
  };
}

async function bootstrapMarkets() {
  pairs.clear();
  marketsById.clear();
  marketsByTokenKey.clear();
  const configuredMarkets = parseSupportedAssetPairs(process.env.SUPPORTED_ASSET_PAIRS_JSON || '');
  const sourceMarkets = configuredMarkets || DEFAULT_MARKET_DEFINITIONS;
  const configuredSzekoTokenId = TOKEN_CONTRACT_ADDRESSES.SZEKO
    ? await deriveTokenIdFromAddress(TOKEN_CONTRACT_ADDRESSES.SZEKO)
    : DEFAULT_SZEKO_TOKEN_ID;
  for (const rawMarket of sourceMarkets) {
    const market = { ...rawMarket };
    const baseAssetKey = canonicalAssetKey(market.baseAsset);
    const quoteAssetKey = canonicalAssetKey(market.quoteAsset);
    if (!market.baseTokenId) {
      market.baseTokenId = await deriveTokenIdFromAddress(TOKEN_CONTRACT_ADDRESSES[baseAssetKey]);
    }
    if (!market.quoteTokenId) {
      market.quoteTokenId = await deriveTokenIdFromAddress(TOKEN_CONTRACT_ADDRESSES[quoteAssetKey]);
    }
    if (!market.baseTokenId) {
      throw new Error(`missing baseTokenId for ${market.symbol}; set SUPPORTED_ASSET_PAIRS_JSON or token address for ${market.baseAsset}`);
    }
    if (!market.quoteTokenId) {
      throw new Error(`missing quoteTokenId for ${market.symbol}; set SUPPORTED_ASSET_PAIRS_JSON or token address for ${market.quoteAsset}`);
    }
    const expectedBaseTokenId = baseAssetKey === 'SETH' ? DEFAULT_NATIVE_TOKEN_ID : configuredSzekoTokenId;
    const expectedQuoteTokenId = quoteAssetKey === 'SETH' ? DEFAULT_NATIVE_TOKEN_ID : configuredSzekoTokenId;
    if (
      !['SETH', 'SZEKO'].includes(baseAssetKey) ||
      !['SETH', 'SZEKO'].includes(quoteAssetKey) ||
      market.baseTokenId !== expectedBaseTokenId ||
      market.quoteTokenId !== expectedQuoteTokenId
    ) {
      throw new Error(
        `Sepolia requires the sETH/sZEKO market using native token ${DEFAULT_NATIVE_TOKEN_ID} and configured sZEKO token ${configuredSzekoTokenId}`
      );
    }
    pairs.set(String(market.symbol).trim().toUpperCase(), market);
  }
  for (const market of pairs.values()) {
    if (!market.marketId) {
      market.marketId = makeMarketId(market.baseTokenId, market.quoteTokenId);
    }
    marketsById.set(market.marketId, market);
    marketsByTokenKey.set(tokenPairKey(market.baseTokenId, market.quoteTokenId), market);
  }
}

async function main() {
  if (CONFIGURED_ZEKO_GRAPHQL && CONFIGURED_ZEKO_GRAPHQL !== SEPOLIA_ZEKO_GRAPHQL) {
    console.warn('[darkpool-server] Ignoring non-Sepolia ZEKO_GRAPHQL and using https://sepolia.zeko.io/graphql');
  }
  await bootstrapMarkets();
  const landingPagePath = path.resolve(projectRoot, 'public', 'index.html');
  const landingPreviewPagePath = path.resolve(projectRoot, 'public', 'landing-preview.html');
  const pagePath = path.resolve(projectRoot, 'public', 'darkpool.html');
  const partnerPagePath = path.resolve(projectRoot, 'public', 'partner-frontend.html');
  const assetsRoot = path.resolve(projectRoot, 'public', 'assets');
  const sdkRoot = path.resolve(projectRoot, 'public', 'sdk');
  const defaultDataDir = path.resolve(projectRoot, 'data', 'zeko-sepolia');
  const dataDir = path.resolve(process.env.DARKPOOL_DATA_DIR || defaultDataDir);
  settlementBatchesPath = path.join(dataDir, 'settlement-batches.json');
  engineStatePath = path.join(dataDir, 'engine-state.json');
  auditLogPath = path.join(dataDir, 'fairness-audit.jsonl');
  earlyAccessStatePath = path.join(dataDir, 'early-access-state.json');
  await mkdir(path.dirname(auditLogPath), { recursive: true });
  await loadAuditHeadFromFile();
  await loadSettlementBatches();
  await loadEngineState();
  await loadEarlyAccessState();
  if (RESET_OPEN_ORDERS_ON_BOOT) {
    orders.clear();
    books.clear();
    privateFillsByOrder.clear();
    orderIssuedNotes.clear();
    await persistEngineState();
  }
  const port = Number.parseInt(process.env.DARKPOOL_PORT || '8791', 10);

  const server = createServer(async (req, res) => {
    try {
      setCorsHeaders(req, res);
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/assets/')) {
        const decodedPathname = decodeURIComponent(url.pathname);
        const assetRelativePath = decodedPathname.slice('/assets/'.length);
        const requestedPath = path.resolve(assetsRoot, assetRelativePath);
        if (!requestedPath.startsWith(assetsRoot + path.sep)) {
          writeJson(res, 400, { error: 'invalid asset path' });
          return;
        }
        const ext = path.extname(requestedPath).toLowerCase();
        const contentType =
          ext === '.mp4'
            ? 'video/mp4'
            : ext === '.webm'
              ? 'video/webm'
              : ext === '.png'
                ? 'image/png'
                : ext === '.jpg' || ext === '.jpeg'
                  ? 'image/jpeg'
                  : ext === '.svg'
                    ? 'image/svg+xml'
                    : 'application/octet-stream';
        const fileInfo = await stat(requestedPath);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');

        const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : null;
        if (rangeHeader && (ext === '.mp4' || ext === '.webm')) {
          const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
          if (!m) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${fileInfo.size}`);
            res.end();
            return;
          }

          const start = m[1] ? Number.parseInt(m[1], 10) : 0;
          const end = m[2] ? Number.parseInt(m[2], 10) : fileInfo.size - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileInfo.size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${fileInfo.size}`);
            res.end();
            return;
          }

          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileInfo.size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const data = await readFile(requestedPath);
          res.end(data.subarray(start, end + 1));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Length', String(fileInfo.size));
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const data = await readFile(requestedPath);
        res.end(data);
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/sdk/')) {
        const decodedPathname = decodeURIComponent(url.pathname);
        const sdkRelativePath = decodedPathname.slice('/sdk/'.length);
        const requestedPath = path.resolve(sdkRoot, sdkRelativePath);
        if (!requestedPath.startsWith(sdkRoot + path.sep)) {
          writeJson(res, 400, { error: 'invalid sdk path' });
          return;
        }
        const ext = path.extname(requestedPath).toLowerCase();
        const contentType = ext === '.js' ? 'application/javascript; charset=utf-8' : 'application/octet-stream';
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=300');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const data = await readFile(requestedPath);
        res.end(data);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const html = await readFile(landingPagePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/landing-preview') {
        const html = await readFile(landingPreviewPagePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/early-access/status') {
        const ip = getRequestIp(req);
        writeJson(res, 200, {
          ok: true,
          gateEnabled: EARLY_ACCESS_GATE_ENABLED,
          authorized: isEarlyAccessAllowed(req),
          ip,
          configuredCodeCount: EARLY_ACCESS_CODES.length,
          usedCodeCount: Object.keys(earlyAccessState.usedCodes).length
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/early-access/redeem') {
        const body = await readJsonBody(req);
        const result = redeemEarlyAccessCode(body?.code, getRequestIp(req));
        res.setHeader('Set-Cookie', buildEarlyAccessCookieHeader(getRequestIp(req)));
        writeJson(res, 200, result);
        return;
      }

      if (isProtectedAppPath(url.pathname) && !isEarlyAccessAllowed(req)) {
        if (req.method === 'GET' && (url.pathname === '/darkpool' || url.pathname === '/partner')) {
          res.statusCode = 302;
          res.setHeader('Location', '/');
          res.end();
          return;
        }
        writeJson(res, 403, {
          error: 'early access required',
          gateEnabled: EARLY_ACCESS_GATE_ENABLED
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/darkpool') {
        const html = await readFile(pagePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/partner') {
        const html = await readFile(partnerPagePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/markets') {
        const markets = marketSnapshot().map((m) => ({
          ...m,
          referenceMode: 'book-indicative-mid-fallback'
        }));
        writeJson(res, 200, { nowUnixMs: now(), markets });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/book') {
        const pair = resolveMarket({
          marketId: url.searchParams.get('marketId'),
          pair: url.searchParams.get('pair') || getDefaultPairSymbol(),
          baseTokenId: url.searchParams.get('baseTokenId'),
          quoteTokenId: url.searchParams.get('quoteTokenId')
        });
        const levels = Number.parseInt(url.searchParams.get('levels') || '20', 10);
        const maxLevels = Number.isFinite(levels) ? Math.min(Math.max(levels, 1), 100) : 20;
        writeJson(res, 200, {
          nowUnixMs: now(),
          depth: {
            marketId: pair.marketId,
            ...bookDepthSnapshot(pair.symbol, maxLevels),
            depthBands: aggregateDepthBands(pair.symbol)
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/book/hash') {
        const pair = resolveMarket({
          marketId: url.searchParams.get('marketId'),
          pair: url.searchParams.get('pair') || getDefaultPairSymbol(),
          baseTokenId: url.searchParams.get('baseTokenId'),
          quoteTokenId: url.searchParams.get('quoteTokenId')
        });
        const snapshot = openOrdersSnapshot().filter((o) => o.pair === pair.symbol);
        const pairHash = sha256Hex(
          snapshot
            .map((o) => [o.id, o.side, Number(o.limitPrice).toFixed(8), Number(o.remaining).toFixed(8), o.commitment].join('|'))
            .join('\n')
        );
        writeJson(res, 200, {
          nowUnixMs: now(),
          marketId: pair.marketId,
          pair: pair.symbol,
          bookHash: pairHash,
          globalBookHash: computeBookHash(),
          openOrders: snapshot.length
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/activity') {
        const accountId = deriveBlindedAccountId({
          wallet: url.searchParams.get('wallet'),
          participant: url.searchParams.get('participant')
        });
        const limitRaw = Number.parseInt(url.searchParams.get('limit') || '200', 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200;
        const events = activityEvents.filter((e) => e.accountId === accountId).slice(0, limit);
        const openOrders = openOrdersSnapshot().filter((o) => o.participant === accountId).slice(0, limit);
        writeJson(res, 200, { accountId, count: events.length, events, openOrders });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/candles') {
        const market = resolveMarket({
          marketId: url.searchParams.get('marketId'),
          pair: url.searchParams.get('pair') || getDefaultPairSymbol(),
          baseTokenId: url.searchParams.get('baseTokenId'),
          quoteTokenId: url.searchParams.get('quoteTokenId')
        });
        const intervalSecRaw = Number.parseInt(url.searchParams.get('intervalSec') || '60', 10);
        const limitRaw = Number.parseInt(url.searchParams.get('limit') || '120', 10);
        const candles = publicCandles({
          marketId: market.marketId,
          pair: market.symbol,
          intervalSec: intervalSecRaw,
          limit: limitRaw
        });
        writeJson(res, 200, {
          ok: true,
          marketId: market.marketId,
          pair: market.symbol,
          intervalSec: Math.min(Math.max(intervalSecRaw || 60, 1), 86400),
          count: candles.length,
          candles
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/frontends/fees') {
        const frontendId = normalizeFrontendId(url.searchParams.get('frontendId'));
        if (frontendId) {
          const stats = frontendFeeLedger.get(frontendId) || {
            frontendId,
            tradeCount: 0,
            routedVolumeQuote: 0,
            earningsByAsset: {},
            recentFills: []
          };
          writeJson(res, 200, {
            frontend: stats,
            protocolFeeBalances,
            config: {
              takerFeeBps: TAKER_FEE_BPS,
              frontendFeeShareBps: FRONTEND_FEE_SHARE_BPS
            }
          });
          return;
        }

        const leaderboard = Array.from(frontendFeeLedger.values())
          .map((v) => ({
            frontendId: v.frontendId,
            tradeCount: v.tradeCount,
            routedVolumeQuote: v.routedVolumeQuote,
            earningsByAsset: v.earningsByAsset
          }))
          .sort((a, b) => Number(b.routedVolumeQuote || 0) - Number(a.routedVolumeQuote || 0))
          .slice(0, 50);
        writeJson(res, 200, {
          count: leaderboard.length,
          frontends: leaderboard,
          protocolFeeBalances,
          config: {
            takerFeeBps: TAKER_FEE_BPS,
            frontendFeeShareBps: FRONTEND_FEE_SHARE_BPS
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/status') {
        writeJson(res, 200, computeStatusSnapshot(port));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/fairness/audit') {
        const limitRaw = Number.parseInt(url.searchParams.get('limit') || '500', 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 5000) : 500;
        const entries = auditTrail.slice(0, limit);
        writeJson(res, 200, {
          count: entries.length,
          auditHeadHash,
          valid: verifyAuditChain(entries),
          entries
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/settlement/batches') {
        const limitRaw = Number.parseInt(url.searchParams.get('limit') || '100', 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
        writeJson(res, 200, {
          nextSettlementBatchId,
          count: Math.min(limit, settlementBatches.length),
          batches: settlementBatches.slice(0, limit)
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/settlement/proof-job/next') {
        requireProofWorkerAuth(req);
        const pending = settlementBatches
          .filter((b) => b.status === 'pending')
          .sort((a, b) => Number(a.batchId) - Number(b.batchId))[0] || null;
        if (!pending) {
          writeJson(res, 200, { ok: true, message: 'no pending batches', batch: null });
          return;
        }
        const artifactPath = privateStateProofArtifactPath(pending.batchId);
        if (existsSync(artifactPath)) {
          writeJson(res, 200, {
            ok: true,
            message: 'cached proof already exists',
            batch: {
              batchId: pending.batchId,
              batchHash: pending.batchHash
            },
            cached: true
          });
          return;
        }
        if (!engineStatePath || !settlementBatchesPath) throw new Error('engine or batch state path not configured');
        const [engineStatePayload, settlementBatchesPayload] = await Promise.all([
          readFile(engineStatePath, 'utf8'),
          readFile(settlementBatchesPath, 'utf8')
        ]);
        writeJson(res, 200, {
          ok: true,
          cached: false,
          batch: {
            batchId: pending.batchId,
            batchHash: pending.batchHash,
            privateStateTransitionHash: pending.privateStateTransitionHash || null
          },
          snapshot: {
            engineStatePayload,
            settlementBatchesPayload
          }
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/operator/zkapp-state') {
        try {
          const body = await readJsonBody(req);
          await validateOperatorPanelAccess(body, 'zkapp-state');
          const zkappState = await runJsonCommand('node --enable-source-maps dist-zkapp/get-state.js');
          writeJson(res, 200, { ok: true, zkappState });
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            zkappState: null
          });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/operator/private-state-witness') {
        try {
          const body = await readJsonBody(req);
          await validateOperatorPanelAccess(body, 'private-state-witness');
          const witness = await runJsonCommand('node --enable-source-maps dist-zkapp/build-private-state-witness.js');
          writeJson(res, 200, { ok: true, witness });
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            witness: null
          });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/operator/private-state-merkle') {
        try {
          const body = await readJsonBody(req);
          await validateOperatorPanelAccess(body, 'private-state-merkle');
          const merkle = await runJsonCommand('node --enable-source-maps dist-zkapp/inspect-private-state-merkle.js');
          writeJson(res, 200, { ok: true, merkle });
        } catch (error) {
          writeJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            merkle: null
          });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/operator/private-state-proof') {
        try {
          const body = await readJsonBody(req);
          await validateOperatorPanelAccess(body, 'private-state-proof');
          const proof = await runJsonCommand('node --enable-source-maps dist-zkapp/prove-private-state-batch.js');
          writeJson(res, 200, { ok: true, proof });
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            proof: null
          });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/settlement/mark-committed') {
        const body = await readJsonBody(req);
        const batchId = Number.parseInt(String(body.batchId || ''), 10);
        if (!Number.isFinite(batchId) || batchId <= 0) throw new Error('batchId must be a positive integer');
        const txHash = typeof body.txHash === 'string' && body.txHash.trim().length > 0 ? body.txHash.trim() : null;
        const payoutTxs = Array.isArray(body.payoutTxs) ? body.payoutTxs : [];
        const target = await markBatchCommittedInternal(batchId, txHash, payoutTxs);
        writeJson(res, 200, { ok: true, batch: target });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/settlement/cache-payout-proofs') {
        const body = await readJsonBody(req);
        const batchId = Number.parseInt(String(body.batchId || ''), 10);
        if (!Number.isFinite(batchId) || batchId <= 0) throw new Error('batchId must be a positive integer');
        const payoutTxs = Array.isArray(body.payoutTxs) ? body.payoutTxs : [];
        const target = await cacheBatchPayoutProofsInternal(batchId, payoutTxs);
        writeJson(res, 200, { ok: true, batch: target });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/settlement/cache-private-state-proof') {
        requireProofWorkerAuth(req);
        const body = await readJsonBody(req);
        const batchId = Number.parseInt(String(body.batchId || ''), 10);
        if (!Number.isFinite(batchId) || batchId <= 0) throw new Error('batchId must be a positive integer');
        const target = await cachePrivateStateProofInternal(batchId, body.proofArtifact, {
          source: 'proof-worker-api'
        });
        writeJson(res, 200, { ok: true, batch: target });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/settlement/payout-requirements') {
        const batchId = Number.parseInt(String(url.searchParams.get('batchId') || ''), 10);
        if (!Number.isFinite(batchId) || batchId <= 0) throw new Error('batchId must be a positive integer');
        const batch = settlementBatches.find((b) => Number(b.batchId) === Number(batchId));
        if (!batch) throw new Error('batch not found');
        writeJson(res, 200, {
          ok: true,
          batchId: batch.batchId,
          batchType: batch.batchType,
          status: batch.status,
          requiresOnchainPayouts: Boolean(batch.requiresOnchainPayouts || SETTLEMENT_REQUIRE_ONCHAIN_PAYOUTS),
          payoutCount: Array.isArray(batch.payouts) ? batch.payouts.length : 0,
          payouts: Array.isArray(batch.payouts) ? batch.payouts : []
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/settlement/commit-next-local') {
        if (!ENABLE_LOCAL_SETTLEMENT) {
          throw new Error('local settlement endpoint disabled');
        }
        const committed = await commitNextPendingBatchLocal();
        writeJson(res, 200, {
          ok: true,
          committed: committed || null,
          message: committed ? 'committed pending batch locally' : 'no pending batches'
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/settlement/anchor-book') {
        const body = await readJsonBody(req);
        const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'manual';
        const batch = await enqueueBookAnchor(reason);
        writeJson(res, 200, {
          ok: true,
          anchored: Boolean(batch),
          batch: batch || null,
          message: batch ? 'book anchor enqueued' : 'book hash unchanged; skipped'
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/reference/update') {
        const body = await readJsonBody(req);
        const pair = resolveMarket(body);
        const referencePrice = requirePositiveNumber(body.referencePrice, 'referencePrice');
        pair.referencePrice = referencePrice;
        writeJson(res, 200, { ok: true, marketId: pair.marketId, pair: pair.symbol, referencePrice });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/accounts/fund') {
        throw new Error('manual funding endpoint removed; fund wallet on-chain and call /api/darkpool/accounts/sync-onchain');
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/accounts/sync-onchain') {
        const body = await readJsonBody(req);
        const participant = deriveBlindedAccountId(body);
        const wallet = requireString(body.wallet, 'wallet');
        const synced = await syncParticipantFromOnchain(participant, wallet);
        logActivity(participant, 'balance_synced_onchain', {
          wallet,
          syncedAtUnixMs: synced.syncedAtUnixMs
        });
        queueEngineStatePersist();
        writeJson(res, 200, { ok: true, ...synced });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/accounts/balance') {
        const participant = deriveBlindedAccountId({
          wallet: url.searchParams.get('wallet'),
          participant: url.searchParams.get('participant')
        });
        const snapshot = accountBalanceSnapshot(participant);
        writeJson(res, 200, {
          ...snapshot,
          balances: {
            ...snapshot.onchainTotals,
            __wallet: snapshot.wallet,
            __lastOnchainSyncUnixMs: snapshot.lastOnchainSyncUnixMs,
            __onchainTotals: snapshot.onchainTotals
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/accounts/onchain-diagnostics') {
        const wallet = requireString(url.searchParams.get('wallet'), 'wallet');
        const diagnostics = await getOnchainDiagnostics(wallet);
        writeJson(res, 200, { ok: true, wallet, diagnostics });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/accounts/pretrade') {
        const participant = deriveBlindedAccountId({
          wallet: url.searchParams.get('wallet'),
          participant: url.searchParams.get('participant')
        });
        const market = resolveMarket({
          marketId: url.searchParams.get('marketId'),
          baseTokenId: url.searchParams.get('baseTokenId'),
          quoteTokenId: url.searchParams.get('quoteTokenId'),
          pair: url.searchParams.get('pair')
        });
        const side = normalizeSide(url.searchParams.get('side') || 'BUY');
        const orderType = normalizeOrderType(url.searchParams.get('orderType') || 'LIMIT');
        const quantity = requirePositiveNumber(Number(url.searchParams.get('quantity') || '0'), 'quantity');
        let limitPrice = Number(url.searchParams.get('limitPrice') || '0');
        let marketExecutable = true;
        let marketAvailableQuantity = null;
        let marketFullFillAvailable = null;
        if (orderType === 'MARKET') {
          const sweep = marketSweepQuote(market.symbol, side, quantity);
          marketAvailableQuantity = sweep.availableQty;
          marketFullFillAvailable = sweep.fullFillAvailable;
          const slip = Math.max(0, Number(MARKET_ORDER_SLIPPAGE_BPS || 0)) / 10000;
          if (side === 'BUY') {
            if (!Number.isFinite(Number(sweep.terminalPrice)) || Number(sweep.terminalPrice) <= 0 || !sweep.fullFillAvailable) marketExecutable = false;
            else limitPrice = Number(sweep.terminalPrice) * (1 + slip);
          } else {
            if (!Number.isFinite(Number(sweep.terminalPrice)) || Number(sweep.terminalPrice) <= 0 || !sweep.fullFillAvailable) marketExecutable = false;
            else limitPrice = Math.max(0.00000001, Number(sweep.terminalPrice) * (1 - slip));
          }
        } else {
          limitPrice = requirePositiveNumber(limitPrice, 'limitPrice');
        }

        const account = getAccount(participant);
        const noteBalances = outstandingNotesByAssetForAccount(participant);
        const locked = getLockedCollateral(participant, market);
        const required =
          side === 'BUY'
            ? { asset: canonicalAssetKey(market.quoteAsset), amount: Number((limitPrice || 0) * quantity || 0) }
            : { asset: canonicalAssetKey(market.baseAsset), amount: quantity };
        const available = Number(noteBalances[required.asset] || 0);
        const walletLinked = typeof account.__wallet === 'string' && account.__wallet.trim().length > 0;
        const syncAgeMs =
          account.__lastOnchainSyncUnixMs !== undefined && account.__lastOnchainSyncUnixMs !== null
            ? Math.max(0, now() - Number(account.__lastOnchainSyncUnixMs))
            : null;
        const syncFresh = syncAgeMs !== null && syncAgeMs <= ONCHAIN_SYNC_TTL_MS;
        const funded = required.amount > 0 ? available + 1e-9 >= required.amount : true;
        writeJson(res, 200, {
          ok: true,
          accountId: participant,
          marketId: market.marketId,
          realFundsMode: REAL_FUNDS_MODE,
          walletLinked,
          syncFresh,
          syncAgeMs,
          onchainSyncTtlMs: ONCHAIN_SYNC_TTL_MS,
          orderType,
          marketExecutable,
          marketAvailableQuantity,
          marketFullFillAvailable,
          side,
          quantity,
          limitPrice: Number.isFinite(limitPrice) ? limitPrice : null,
          required,
          availableByAsset: {
            [canonicalAssetKey(market.baseAsset)]: Number(noteBalances[canonicalAssetKey(market.baseAsset)] || 0),
            [canonicalAssetKey(market.quoteAsset)]: Number(noteBalances[canonicalAssetKey(market.quoteAsset)] || 0)
          },
          walletAvailableByAsset: account.__onchainTotals || {},
          lockedByAsset: {
            [canonicalAssetKey(market.baseAsset)]: Number(locked[canonicalAssetKey(market.baseAsset)] || 0),
            [canonicalAssetKey(market.quoteAsset)]: Number(locked[canonicalAssetKey(market.quoteAsset)] || 0)
          },
          funded
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/orders/place') {
        const body = await readJsonBody(req);
        const participant = deriveBlindedAccountId(body);
        let validatedOrderAuthorization = null;
        const frontendId = normalizeFrontendId(body.frontendId);
        const pairConfig = resolveMarket(body);
        const side = normalizeSide(body.side);
        const quantity = requirePositiveNumber(body.quantity, 'quantity');
        const orderType = normalizeOrderType(body.orderType);
        const visibility = String(body.visibility || 'public').trim().toLowerCase() === 'private' ? 'private' : 'public';
        let timeInForce = normalizeTif(body.timeInForce);
        let limitPrice =
          body.limitPrice === undefined || body.limitPrice === null
            ? NaN
            : Number(body.limitPrice);
        const privateMemo = typeof body.privateMemo === 'string' ? body.privateMemo : '';
        const fundingMode = normalizeFundingMode(body.fundingMode || 'note-only');
        const fundingNoteHashes = normalizeFundingNoteHashes(body.fundingNoteHashes);
        if (fundingMode === 'wallet' || fundingMode === 'hybrid') {
          throw new Error('wallet-funded trading removed; orders must be note-backed');
        }

        if (orderType === 'MARKET') {
          sortBook(pairConfig.symbol);
          const sweep = marketSweepQuote(pairConfig.symbol, side, quantity);
          const slip = Math.max(0, Number(MARKET_ORDER_SLIPPAGE_BPS || 0)) / 10000;
          if (!sweep.fullFillAvailable) {
            throw new Error(
              `market order quantity ${quantity} exceeds available ${side === 'BUY' ? 'ask' : 'bid'} liquidity ${sweep.availableQty}`
            );
          }
          if (side === 'BUY') {
            if (!Number.isFinite(Number(sweep.terminalPrice)) || Number(sweep.terminalPrice) <= 0) {
              throw new Error('no ask liquidity for market buy');
            }
            limitPrice = Number(sweep.terminalPrice) * (1 + slip);
          } else {
            if (!Number.isFinite(Number(sweep.terminalPrice)) || Number(sweep.terminalPrice) <= 0) {
              throw new Error('no bid liquidity for market sell');
            }
            limitPrice = Math.max(0.00000001, Number(sweep.terminalPrice) * (1 - slip));
          }
          timeInForce = 'IOC';
        } else {
          limitPrice = requirePositiveNumber(limitPrice, 'limitPrice');
        }

        if (REAL_FUNDS_MODE) {
          const account = getAccount(participant);
          const linkedWallet = participantWallets.get(participant) || account.__wallet;
          if (!linkedWallet) {
            throw new Error('wallet linkage missing; call /api/darkpool/accounts/sync-onchain first');
          }
          const lastSync = Number(account.__lastOnchainSyncUnixMs || 0);
          if (!lastSync || now() - lastSync > ONCHAIN_SYNC_TTL_MS) {
            throw new Error('on-chain balances are stale; call /api/darkpool/accounts/sync-onchain');
          }
          validatedOrderAuthorization = await validateOrderAuthorization({
            wallet: linkedWallet,
            market: pairConfig,
            side,
            orderType,
            timeInForce,
            limitPrice: orderType === 'MARKET' ? null : limitPrice,
            quantity,
            fundingNoteHashes,
            visibility,
            frontendId,
            authorization: body.orderAuthorization
          });
        }

        const { order, fills, consumedFundingNote, consumedFundingNotes } = placeOrder({
          participant,
          pairConfig,
          side,
          limitPrice,
          quantity,
          timeInForce,
          orderType,
          visibility,
          privateMemo,
          fundingNoteHashes,
          frontendId
        });

        engineMetrics.orderAcceptedCount += 1;
        engineMetrics.lastOrderAtUnixMs = now();
        const orderReceipt = createOrderReceipt(order, participant);
        const sequencingReceipt = createSequencingReceipt(order, participant);

        const settlementBatch = await enqueueSettlementBatch(participant, fills);
        if (validatedOrderAuthorization) {
          usedOrderAuthNonces.set(validatedOrderAuthorization.nonce, validatedOrderAuthorization.expiresAtUnixMs);
        }
        writeJson(res, 200, {
          ok: true,
          order: sanitizeOrder(order),
          orderReceipt,
          sequencingReceipt,
          cancelToken: order.cancelToken,
          consumedFundingNote,
          consumedFundingNotes,
          issuedNotes: orderIssuedNotes.get(order.id) || [],
          settlementBatch,
          privateFills: (privateFillsByOrder.get(order.id) || []).map((f) => ({
            tradeId: f.tradeId,
            quantity: f.quantity,
            price: f.price,
            counterpartyCommitment: f.counterpartyCommitment,
            createdAtUnixMs: f.createdAtUnixMs
          })),
          matchCount: fills.length,
          message:
            orderType === 'MARKET' && fills.length === 0
              ? 'market order had no immediately executable opposite liquidity and was canceled (IOC)'
              : undefined,
          accountId: participant,
          participantBalances: accountBalanceSnapshot(participant)
        });
        logActivity(participant, 'order_submitted', {
          orderId: order.id,
          pair: order.pair,
          side: order.side,
          orderType,
          limitPrice: order.limitPrice,
          quantity: order.quantity,
          tif: order.timeInForce,
          sequenceNumber: sequencingReceipt.sequenceNumber,
          sequencingReceiptHash: sequencingReceipt.receiptHash,
          fundingMode,
          frontendId
        });
        recordAuditEvent('order_accepted', {
          orderId: order.id,
          participant,
          pair: order.pair,
          side: order.side,
          orderType,
          limitPrice: order.limitPrice,
          quantity: order.quantity,
          tif: order.timeInForce,
          frontendId,
          commitment: order.commitment,
          receiptSignature: orderReceipt.signature,
          sequencingReceiptHash: sequencingReceipt.receiptHash,
          sequenceNumber: sequencingReceipt.sequenceNumber
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/maker/quote') {
        requireMakerAuth(req);
        const body = await readJsonBody(req);
        const accountId = deriveBlindedAccountId(body);
        const pairConfig = resolveMarket(body);
        const bidPrice = requirePositiveNumber(body.bidPrice, 'bidPrice');
        const askPrice = requirePositiveNumber(body.askPrice, 'askPrice');
        const bidSize = requirePositiveNumber(body.bidSize, 'bidSize');
        const askSize = requirePositiveNumber(body.askSize, 'askSize');
        const replace = Boolean(body.replace);
        const tif = normalizeTif(body.timeInForce);
        const frontendId = normalizeFrontendId(body.frontendId);
        const visibility = String(body.visibility || 'public').trim().toLowerCase() === 'private' ? 'private' : 'public';
        const makerTag = typeof body.makerTag === 'string' ? body.makerTag.trim().slice(0, 60) : 'maker-quote';
        if (bidPrice >= askPrice) throw new Error('bidPrice must be less than askPrice');

        let canceled = 0;
        if (replace) {
          const current = activeOrdersForAccount(pairConfig.symbol, accountId);
          for (const existing of current) {
            cancelOrderInternal(existing);
            canceled += 1;
          }
        }

        const bidResult = placeOrder({
          participant: accountId,
          pairConfig,
          side: 'BUY',
          limitPrice: bidPrice,
          quantity: bidSize,
          timeInForce: tif,
          visibility,
          privateMemo: `maker-bid:${makerTag}`,
          frontendId
        });
        const bid = bidResult.order;
        bid.makerTag = makerTag;
        const bidSequencingReceipt = createSequencingReceipt(bid, accountId);

        const askResult = placeOrder({
          participant: accountId,
          pairConfig,
          side: 'SELL',
          limitPrice: askPrice,
          quantity: askSize,
          timeInForce: tif,
          visibility,
          privateMemo: `maker-ask:${makerTag}`,
          frontendId
        });
        const ask = askResult.order;
        ask.makerTag = makerTag;
        const askSequencingReceipt = createSequencingReceipt(ask, accountId);
        const allFills = [...bidResult.fills, ...askResult.fills];
        const settlementBatch = await enqueueSettlementBatch(accountId, allFills);

        writeJson(res, 200, {
          ok: true,
          accountId,
          pair: pairConfig.symbol,
          replace,
          canceledOrders: canceled,
          quote: { bidPrice, askPrice, bidSize, askSize, tif, makerTag, visibility },
          bidOrder: sanitizeOrder(bid),
          askOrder: sanitizeOrder(ask),
          sequencingReceipts: {
            bid: bidSequencingReceipt,
            ask: askSequencingReceipt
          },
          settlementBatch,
          balances: accountBalanceSnapshot(accountId)
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/maker/cancel-all') {
        requireMakerAuth(req);
        const body = await readJsonBody(req);
        const accountId = deriveBlindedAccountId(body);
        const pairConfig = resolveMarket(body);
        const current = activeOrdersForAccount(pairConfig.symbol, accountId);
        let canceled = 0;
        for (const existing of current) {
          cancelOrderInternal(existing);
          canceled += 1;
        }
        writeJson(res, 200, {
          ok: true,
          accountId,
          pair: pairConfig.symbol,
          canceledOrders: canceled,
          balances: accountBalanceSnapshot(accountId)
        });
        return;
      }

      if (req.method === 'POST' && url.pathname.match(/^\/api\/darkpool\/orders\/[^/]+\/cancel$/)) {
        const orderId = url.pathname.split('/')[4];
        const body = await readJsonBody(req);
        const cancelToken = requireString(body.cancelToken, 'cancelToken');
        const order = orders.get(orderId);
        if (!order) throw new Error('order not found');
        if (order.cancelToken !== cancelToken) throw new Error('invalid cancel token');
        const pairConfig = getPairConfigBySymbol(order.pair);
        if (!pairConfig) throw new Error('pair not found');

        const { released } = cancelOrderInternal(order);
        engineMetrics.cancelCount += 1;
        writeJson(res, 200, {
          ok: true,
          order: sanitizeOrder(order),
          released,
          issuedNotes: orderIssuedNotes.get(order.id) || [],
          accountId: order.participant,
          participantBalances: accountBalanceSnapshot(order.participant)
        });
        logActivity(order.participant, 'order_canceled', {
          orderId: order.id,
          pair: order.pair
        });
        recordAuditEvent('order_canceled', {
          orderId: order.id,
          pair: order.pair,
          participant: order.participant
        });
        return;
      }

      if (req.method === 'POST' && url.pathname.match(/^\/api\/darkpool\/orders\/[^/]+\/replace$/)) {
        const orderId = url.pathname.split('/')[4];
        const body = await readJsonBody(req);
        let validatedOrderAuthorization = null;
        const cancelToken = requireString(body.cancelToken, 'cancelToken');
        const existingOrder = orders.get(orderId);
        if (!existingOrder) throw new Error('order not found');
        if (existingOrder.cancelToken !== cancelToken) throw new Error('invalid cancel token');
        if (existingOrder.status === 'FILLED' || existingOrder.status === 'CANCELED' || existingOrder.remaining <= 1e-9) {
          throw new Error('order is no longer replaceable');
        }
        const pairConfig = getPairConfigBySymbol(existingOrder.pair);
        if (!pairConfig) throw new Error('pair not found');

        const participant = existingOrder.participant;
        const side = normalizeSide(body.side || existingOrder.side);
        if (side !== existingOrder.side) {
          throw new Error('replace currently supports same-side updates only');
        }
        const orderType = normalizeOrderType(body.orderType || existingOrder.orderType || 'LIMIT');
        let timeInForce = normalizeTif(body.timeInForce || existingOrder.timeInForce || 'GTC');
        let limitPrice =
          body.limitPrice === undefined || body.limitPrice === null
            ? Number(existingOrder.limitPrice)
            : Number(body.limitPrice);
        const quantity =
          body.quantity === undefined || body.quantity === null
            ? requirePositiveNumber(Number(existingOrder.quantity), 'quantity')
            : requirePositiveNumber(Number(body.quantity), 'quantity');
        const visibility = String(body.visibility || existingOrder.visibility || 'public').trim().toLowerCase() === 'private' ? 'private' : 'public';
        const privateMemo = typeof body.privateMemo === 'string' ? body.privateMemo : '';
        const frontendId = normalizeFrontendId(body.frontendId || existingOrder.frontendId);

        if (orderType === 'MARKET') {
          const sweep = marketSweepQuote(pairConfig.symbol, side, quantity);
          const slip = Math.max(0, Number(MARKET_ORDER_SLIPPAGE_BPS || 0)) / 10000;
          if (side === 'BUY') {
            if (!Number.isFinite(Number(sweep.terminalPrice)) || Number(sweep.terminalPrice) <= 0) {
              throw new Error('no ask liquidity for market buy');
            }
            limitPrice = Number(sweep.terminalPrice) * (1 + slip);
          } else {
            if (!Number.isFinite(Number(sweep.terminalPrice)) || Number(sweep.terminalPrice) <= 0) {
              throw new Error('no bid liquidity for market sell');
            }
            limitPrice = Math.max(0.00000001, Number(sweep.terminalPrice) * (1 - slip));
          }
          timeInForce = 'IOC';
        } else {
          limitPrice = requirePositiveNumber(limitPrice, 'limitPrice');
        }

        const requestedFundingNoteHashes = normalizeFundingNoteHashes(body.fundingNoteHashes);

        if (REAL_FUNDS_MODE) {
          const account = getAccount(participant);
          const linkedWallet = participantWallets.get(participant) || account.__wallet;
          if (!linkedWallet) throw new Error('wallet linkage missing; call /api/darkpool/accounts/sync-onchain first');
          const lastSync = Number(account.__lastOnchainSyncUnixMs || 0);
          if (!lastSync || now() - lastSync > ONCHAIN_SYNC_TTL_MS) {
            throw new Error('on-chain balances are stale; call /api/darkpool/accounts/sync-onchain');
          }
          validatedOrderAuthorization = await validateOrderAuthorization({
            wallet: linkedWallet,
            market: pairConfig,
            side,
            orderType,
            timeInForce,
            limitPrice: orderType === 'MARKET' ? null : limitPrice,
            quantity,
            fundingNoteHashes: requestedFundingNoteHashes,
            visibility,
            frontendId,
            authorization: body.orderAuthorization
          });
        }

        const { released } = cancelOrderInternal(existingOrder);
        engineMetrics.cancelCount += 1;
        const replacementFundingNoteHashes = requestedFundingNoteHashes.length
          ? requestedFundingNoteHashes
          : released
              .map((entry) => entry?.note?.noteHash)
              .filter((value) => typeof value === 'string' && value.trim());

        const { order, fills, consumedFundingNote, consumedFundingNotes } = placeOrder({
          participant,
          pairConfig,
          side,
          limitPrice,
          quantity,
          timeInForce,
          orderType,
          visibility,
          privateMemo,
          fundingNoteHashes: replacementFundingNoteHashes,
          frontendId
        });

        engineMetrics.orderAcceptedCount += 1;
        engineMetrics.lastOrderAtUnixMs = now();
        const orderReceipt = createOrderReceipt(order, participant);
        const sequencingReceipt = createSequencingReceipt(order, participant);
        const settlementBatch = await enqueueSettlementBatch(participant, fills);
        if (validatedOrderAuthorization) {
          usedOrderAuthNonces.set(validatedOrderAuthorization.nonce, validatedOrderAuthorization.expiresAtUnixMs);
        }
        logActivity(participant, 'order_replaced', {
          replacedOrderId: existingOrder.id,
          newOrderId: order.id,
          pair: pairConfig.symbol,
          side,
          orderType,
          quantity,
          limitPrice,
          sequenceNumber: sequencingReceipt.sequenceNumber,
          sequencingReceiptHash: sequencingReceipt.receiptHash
        });
        recordAuditEvent('order_replaced', {
          replacedOrderId: existingOrder.id,
          newOrderId: order.id,
          pair: pairConfig.symbol,
          participant
        });

        writeJson(res, 200, {
          ok: true,
          replacedOrder: sanitizeOrder(existingOrder),
          replacementOrder: sanitizeOrder(order),
          orderReceipt,
          sequencingReceipt,
          cancelToken: order.cancelToken,
          released,
          consumedFundingNote,
          consumedFundingNotes,
          issuedNotes: orderIssuedNotes.get(order.id) || [],
          settlementBatch,
          accountId: participant,
          participantBalances: accountBalanceSnapshot(participant)
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.match(/^\/api\/darkpool\/orders\/[^/]+$/)) {
        const orderId = url.pathname.split('/')[4];
        const token = requireString(url.searchParams.get('token'), 'token');
        const order = orders.get(orderId);
        if (!order) throw new Error('order not found');
        if (order.cancelToken !== token) throw new Error('invalid token');
        writeJson(res, 200, {
          order: sanitizeOrder(order),
          orderPayloadCommitment: order.commitment,
          privateFills: privateFillsByOrder.get(orderId) || [],
          issuedNotes: orderIssuedNotes.get(orderId) || []
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/trades') {
        writeJson(res, 200, { count: publicTape.length, trades: publicTape.slice(0, 80) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit/find-latest') {
        const body = await readJsonBody(req);
        const accountId = deriveBlindedAccountId(body);
        const resolved = resolveKnownAsset({ asset: body.asset, tokenId: body.tokenId });
        const amount = requirePositiveNumber(body.amount, 'amount');
        const wallet = requireString(body.wallet, 'wallet');
        const account = getAccount(accountId);
        if (typeof account.__wallet !== 'string' || account.__wallet.trim() !== wallet) {
          throw new Error('wallet must be synced first; call /api/darkpool/accounts/sync-onchain before minting note');
        }
        const lastSync = Number(account.__lastOnchainSyncUnixMs || 0);
        if (!Number.isFinite(lastSync) || now() - lastSync > ONCHAIN_SYNC_TTL_MS) {
          throw new Error('on-chain balances are stale; sync wallet before minting note');
        }
        const found = await findLatestEligibleDepositTx({
          wallet,
          tokenId: resolved.tokenId,
          amount
        });
        writeJson(res, 200, {
          ok: true,
          accountId,
          wallet,
          asset: canonicalAssetKey(resolved.asset),
          tokenId: resolved.tokenId,
          requestedAmount: amount,
          txHash: found.txHash,
          tx: found.tx
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit/build-transaction') {
        const body = await readJsonBody(req);
        const resolved = resolveKnownAsset({ asset: body.asset, tokenId: body.tokenId });
        const wallet = requireString(body.wallet, 'wallet');
        const amount = requirePositiveNumber(body.amount, 'amount');
        const rawAmount = decimalToRawUnitsString(amount, ASSET_DECIMALS[canonicalAssetKey(resolved.asset)] ?? 9);
        const suggestedFee = await getSuggestedSequencerFeeRaw();
        const memo =
          typeof body.memo === 'string' && body.memo.trim()
            ? body.memo.trim()
            : `shadowbook-deposit:${resolved.asset}`;
        const built = await buildVaultDepositTransaction({
          wallet,
          tokenId: resolved.tokenId,
          amount: rawAmount,
          memo,
          feeRaw: suggestedFee.feeRaw
        });
        writeJson(res, 200, {
          ok: true,
          wallet,
          asset: resolved.asset,
          tokenId: resolved.tokenId,
          amount,
          rawAmount,
          vaultDepositAddress: VAULT_DEPOSIT_ADDRESS,
          fee: suggestedFee.fee,
          feeRaw: suggestedFee.feeRaw,
          feeSource: suggestedFee.source,
          receiverNeedsAccount: Boolean(built?.receiverNeedsAccount),
          receiverNeedsTokenAccount: Boolean(built?.receiverNeedsTokenAccount),
          memo,
          transaction: built.transaction
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/funding/token-transfer/build-transaction') {
        const body = await readJsonBody(req);
        const resolved = resolveKnownAsset({ asset: body.asset, tokenId: body.tokenId });
        if (canonicalAssetKey(resolved.asset) !== 'SZEKO') {
          throw new Error('token transfer widget currently supports sZEKO only');
        }
        const wallet = requireString(body.wallet, 'wallet');
        const recipient = requireString(body.recipient, 'recipient');
        const amount = requirePositiveNumber(body.amount, 'amount');
        const rawAmount = decimalToRawUnitsString(amount, ASSET_DECIMALS[canonicalAssetKey(resolved.asset)] ?? 9);
        const suggestedFee = await getSuggestedSequencerFeeRaw();
        const memo =
          typeof body.memo === 'string' && body.memo.trim()
            ? body.memo.trim()
            : `shadowbook-transfer:${resolved.asset}`;
        const built = await buildTokenTransferTransaction({
          wallet,
          recipient,
          tokenId: resolved.tokenId,
          amount: rawAmount,
          memo,
          feeRaw: suggestedFee.feeRaw
        });
        writeJson(res, 200, {
          ok: true,
          wallet,
          recipient,
          asset: resolved.asset,
          tokenId: resolved.tokenId,
          amount,
          rawAmount,
          fee: suggestedFee.fee,
          feeRaw: suggestedFee.feeRaw,
          feeSource: suggestedFee.source,
          receiverNeedsTokenAccount: Boolean(built?.receiverNeedsTokenAccount),
          memo,
          transaction: built.transaction
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit/submit-signed') {
        const body = await readJsonBody(req);
        const signedData = body?.signedData ?? body?.signature ?? body?.response?.signedData ?? null;
        const parsed = signedData ? (typeof signedData === 'string' ? JSON.parse(signedData) : signedData) : null;
        const zkappCommand =
          body?.zkappCommand ||
          parsed?.zkappCommand ||
          parsed?.data?.zkappCommand ||
          parsed?.signedData?.zkappCommand ||
          null;
        if (!zkappCommand || typeof zkappCommand !== 'object') {
          throw new Error('submit-signed requires zkappCommand or signedData containing zkappCommand');
        }
        validateSignedZkappCommandCoverage(zkappCommand);
        const submitted = await submitSignedZkappCommand(zkappCommand);
        writeJson(res, 200, {
          ok: true,
          hash: submitted.hash,
          zkappId: submitted.id
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/funding/token-transfer/submit-signed') {
        const body = await readJsonBody(req);
        const signedData = body?.signedData ?? body?.signature ?? body?.response?.signedData ?? null;
        const parsed = signedData ? (typeof signedData === 'string' ? JSON.parse(signedData) : signedData) : null;
        const zkappCommand =
          body?.zkappCommand ||
          parsed?.zkappCommand ||
          parsed?.data?.zkappCommand ||
          parsed?.signedData?.zkappCommand ||
          null;
        if (!zkappCommand || typeof zkappCommand !== 'object') {
          throw new Error('submit-signed requires zkappCommand or signedData containing zkappCommand');
        }
        validateSignedZkappCommandCoverage(zkappCommand);
        const submitted = await submitSignedZkappCommand(zkappCommand);
        writeJson(res, 200, {
          ok: true,
          hash: submitted.hash,
          zkappId: submitted.id
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit-intent') {
        const body = await readJsonBody(req);
        const wallet = requireString(body.wallet, 'wallet');
        const asset = requireString(body.asset, 'asset');
        const tokenId = requireString(body.tokenId, 'tokenId');
        const amount = requirePositiveNumber(body.amount, 'amount');
        writeJson(res, 200, await createDepositIntent({ wallet, asset, tokenId, amount }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit-recover') {
        const body = await readJsonBody(req);
        const intentId = requireString(body.intentId, 'intentId');
        writeJson(res, 200, await recoverDepositIntent(intentId));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit-cancel') {
        const body = await readJsonBody(req);
        const intentId = requireString(body.intentId, 'intentId');
        writeJson(res, 200, cancelDepositIntent(intentId));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit-auto') {
        const body = await readJsonBody(req);
        const accountId = deriveBlindedAccountId(body);
        const resolved = resolveKnownAsset({ asset: body.asset, tokenId: body.tokenId });
        const amount = requirePositiveNumber(body.amount, 'amount');
        const wallet = requireString(body.wallet, 'wallet');
        const account = getAccount(accountId);
        if (typeof account.__wallet !== 'string' || account.__wallet.trim() !== wallet) {
          throw new Error('wallet must be synced first; call /api/darkpool/accounts/sync-onchain before minting note');
        }
        const lastSync = Number(account.__lastOnchainSyncUnixMs || 0);
        if (!Number.isFinite(lastSync) || now() - lastSync > ONCHAIN_SYNC_TTL_MS) {
          throw new Error('on-chain balances are stale; sync wallet before minting note');
        }

        let verifiedDeposit = null;
        if (REQUIRE_ONCHAIN_DEPOSIT_TX) {
          const providedTxHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
          let txHashForVerify = providedTxHash;
          if (!txHashForVerify) {
            const found = await findLatestEligibleDepositTx({
              wallet,
              tokenId: resolved.tokenId,
              amount
            });
            txHashForVerify = found.txHash;
          }
          verifiedDeposit = await verifyOnchainDepositTx({
            txHash: txHashForVerify,
            wallet,
            tokenId: resolved.tokenId,
            amount
          });
          usedDepositTxHashes.add(txHashForVerify);
        }
        const canonical = canonicalAssetKey(resolved.asset);
        const note = issueNote(canonical, amount, 'onchain-backed-deposit', null, accountId);
        const intentId = typeof body.intentId === 'string' ? body.intentId.trim() : '';
        if (intentId) {
          const intent = depositIntents.get(intentId);
          if (intent && intent.status === 'pending') {
            intent.status = 'claimed';
            intent.claimedAtUnixMs = now();
            intent.note = note;
          }
        }
        queueEngineStatePersist();
        writeJson(res, 200, {
          ok: true,
          accountId,
          note,
          asset: canonical,
          tokenId: resolved.tokenId,
          verifiedDepositTx: verifiedDeposit
            ? {
                txHash: verifiedDeposit.txHash,
                from: verifiedDeposit.tx?.from || null,
                to: verifiedDeposit.tx?.to || null,
                amount: verifiedDeposit.tx?.amount || null,
                token: verifiedDeposit.tx?.token || verifiedDeposit.tx?.tokenId || null,
                unverified: Boolean(verifiedDeposit.unverified),
                verificationMode: verifiedDeposit.verificationMode || 'unknown'
              }
            : null,
          participantBalances: accountBalanceSnapshot(accountId),
          poolTotals
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/deposit') {
        const body = await readJsonBody(req);
        const accountId = deriveBlindedAccountId(body);
        const resolved = resolveKnownAsset({ asset: body.asset, tokenId: body.tokenId });
        const amount = requirePositiveNumber(body.amount, 'amount');
        const wallet = requireString(body.wallet, 'wallet');
        const account = getAccount(accountId);
        if (typeof account.__wallet !== 'string' || account.__wallet.trim() !== wallet) {
          throw new Error('wallet must be synced first; call /api/darkpool/accounts/sync-onchain before minting note');
        }
        const lastSync = Number(account.__lastOnchainSyncUnixMs || 0);
        if (!Number.isFinite(lastSync) || now() - lastSync > ONCHAIN_SYNC_TTL_MS) {
          throw new Error('on-chain balances are stale; sync wallet before minting note');
        }
        let verifiedDeposit = null;
        if (REQUIRE_ONCHAIN_DEPOSIT_TX) {
          const txHash = requireString(body.txHash, 'txHash');
          if (usedDepositTxHashes.has(txHash)) throw new Error('deposit tx hash already used');
          verifiedDeposit = await verifyOnchainDepositTx({
            txHash,
            wallet,
            tokenId: resolved.tokenId,
            amount
          });
          usedDepositTxHashes.add(txHash);
        }
        const canonical = canonicalAssetKey(resolved.asset);
        const note = issueNote(canonical, amount, 'onchain-backed-deposit', null, accountId);
        queueEngineStatePersist();
        writeJson(res, 200, {
          ok: true,
          accountId,
          note,
          asset: canonical,
          tokenId: resolved.tokenId,
          verifiedDepositTx: verifiedDeposit
            ? {
                txHash: verifiedDeposit.txHash,
                from: verifiedDeposit.tx?.from || null,
                to: verifiedDeposit.tx?.to || null,
                amount: verifiedDeposit.tx?.amount || null,
                token: verifiedDeposit.tx?.token || verifiedDeposit.tx?.tokenId || null,
                unverified: Boolean(verifiedDeposit.unverified),
                verificationMode: verifiedDeposit.verificationMode || 'unknown'
              }
            : null,
          participantBalances: accountBalanceSnapshot(accountId),
          poolTotals
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/vault/withdraw') {
        const body = await readJsonBody(req);
        const accountId = deriveBlindedAccountId({
          wallet: body.wallet,
          participant: body.participant
        });
        const linkedWallet = getLinkedWalletForParticipant(accountId);
        const recipient = typeof body.recipient === 'string' && body.recipient.trim() ? body.recipient.trim() : linkedWallet;
        if (recipient !== linkedWallet) {
          throw new Error('withdraw recipient must match the linked wallet');
        }
        const asset = requireString(body.asset, 'asset');
        const amount = requirePositiveNumber(body.amount, 'amount');
        const fundingNoteHashes = Array.isArray(body.noteHashes)
          ? body.noteHashes.map((entry) => requireString(entry, 'noteHashes[]'))
          : [];
        const result = await withdrawNoteCollateral({
          accountId,
          wallet: recipient,
          asset,
          amount,
          fundingNoteHashes
        });
        writeJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/faucet/claim') {
        const body = await readJsonBody(req);
        const wallet = requireMinaAddress(body.wallet, 'wallet');
        const result = await claimZekoTestnetFaucet(wallet);
        writeJson(res, 200, {
          ok: result.ok,
          wallet,
          faucet: result.faucet,
          exitCode: result.exitCode
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/darkpool/notes/redeem') {
        throw new Error('note redemption to internal trading balance removed; private notes are spent automatically when you place a note-backed order');
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/notes/status') {
        const noteRaw = requireString(url.searchParams.get('note'), 'note');
        const noteHash = sha256Hex(noteRaw);
        const note = notes.get(noteHash);
        if (!note) {
          writeJson(res, 200, { exists: false, noteHash });
          return;
        }
        writeJson(res, 200, { exists: true, note });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/notes/portfolio') {
        const accountId = deriveBlindedAccountId({
          wallet: url.searchParams.get('wallet'),
          participant: url.searchParams.get('participant')
        });
        writeJson(res, 200, { ok: true, ...notePortfolioForAccount(accountId) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/darkpool/vault/pool') {
        writeJson(res, 200, { poolTotals, withdrawalCount: withdrawals.length, recentWithdrawals: withdrawals.slice(0, 20) });
        return;
      }

      writeJson(res, 404, { error: 'not found' });
    } catch (error) {
      engineMetrics.orderRejectedCount += 1;
      recordAuditEvent('request_rejected', {
        path: req.url || '',
        method: req.method || '',
        message: error instanceof Error ? error.message : String(error)
      });
      writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(port, DARKPOOL_HOST, () => {
    console.log(`Dark pool server listening on http://${DARKPOOL_HOST}:${port}/darkpool`);
    const localApiBase = `http://127.0.0.1:${port}`;
    if (AUTO_RUN_PROOF_WORKER) {
      startManagedBackgroundProcess('proof-worker', 'node scripts/private-state-proof-worker.js', {
        DARKPOOL_API: localApiBase,
        INTERNAL_SERVICE_SECRET
      });
    }
    if (AUTO_RUN_SETTLEMENT_WORKER) {
      const settlementNodeOptions =
        ZKAPP_COMMIT_MAX_OLD_SPACE_MB > 0
          ? `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--max-old-space-size=${ZKAPP_COMMIT_MAX_OLD_SPACE_MB}`
          : process.env.NODE_OPTIONS || '';
      startManagedBackgroundProcess('settlement-worker', 'node scripts/settlement-worker.js', {
        DARKPOOL_API: localApiBase,
        INTERNAL_SERVICE_SECRET,
        ...(settlementNodeOptions ? { NODE_OPTIONS: settlementNodeOptions } : {})
      });
    }
  });

  if (AUTO_SETTLEMENT) {
    if (!ENABLE_LOCAL_SETTLEMENT) {
      console.log('[settlement:auto] AUTO_SETTLEMENT requested but ENABLE_LOCAL_SETTLEMENT=false; skipping local auto-commits');
      return;
    }
    setInterval(async () => {
      try {
        const committed = await commitNextPendingBatchLocal();
        if (committed) {
          console.log(`[settlement:auto] committed batch ${committed.batchId} tx=${committed.txHash}`);
        }
      } catch (error) {
        console.error('[settlement:auto] failed', error);
      }
    }, Math.max(1000, AUTO_SETTLEMENT_INTERVAL_MS));
  }

  if (BOOK_ANCHOR_INTERVAL_MS > 0) {
    setInterval(async () => {
      try {
        const batch = await enqueueBookAnchor('interval');
        if (batch) {
          console.log(`[book-anchor:auto] enqueued batch ${batch.batchId} hash=${batch.batchHash.slice(0, 16)}...`);
        }
      } catch (error) {
        console.error('[book-anchor:auto] failed', error);
      }
    }, Math.max(3000, BOOK_ANCHOR_INTERVAL_MS));
  }

  if (GTC_ORDER_EXPIRY_MS > 0) {
    setInterval(() => {
      try {
        const expired = expireEligibleOrders();
        if (expired > 0) {
          queueEngineStatePersist();
          console.log(`[orders:expiry] expired ${expired} GTC order(s)`);
        }
      } catch (error) {
        console.error('[orders:expiry] failed', error);
      }
    }, Math.max(2000, Math.min(30000, Math.floor(GTC_ORDER_EXPIRY_MS / 2))));
  }
}

main().catch((error) => {
  console.error('[darkpool-server] failed:', error);
  process.exit(1);
});
