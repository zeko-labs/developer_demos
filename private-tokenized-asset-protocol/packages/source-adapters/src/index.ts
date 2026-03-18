import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import {
  assertZkTlsRepoReady,
  latestZkTlsArtifacts,
  runZkTlsPipeline
} from '../../attestor-service/src/index.js';
import type {
  AuthProfile,
  CustodyHoldingsSource,
  GenericRestSource,
  IncreaseSource,
  MtlsProfile,
  MockBankSource,
  PersonaSource,
  PlaidSource,
  SourceAdapterRequest,
  SourceProvider,
  ZkTlsBankSource,
  ZkTlsEmployerSource
} from '@tap/shared-types';

export type AdapterErrorCode =
  | 'invalid_config'
  | 'domain_not_allowed'
  | 'auth_profile_not_found'
  | 'auth_secret_missing'
  | 'auth_token_fetch_failed'
  | 'auth_credential_expired'
  | 'auth_rotation_required'
  | 'mtls_profile_not_found'
  | 'mtls_secret_missing'
  | 'upstream_timeout'
  | 'upstream_unavailable'
  | 'upstream_bad_response'
  | 'schema_mismatch'
  | 'dependency_not_ready';

export class AdapterError extends Error {
  code: AdapterErrorCode;
  retryable: boolean;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    code: AdapterErrorCode,
    message: string,
    options?: { retryable?: boolean; statusCode?: number; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.statusCode = options?.statusCode ?? 500;
    this.details = options?.details;
  }
}

export interface PartnerAttestation {
  attestationId: string;
  provider: SourceProvider;
  subjectCommitment: string;
  eligible: boolean;
  score: number;
  fields: Record<string, string | number | boolean>;
  raw: unknown;
  receivedAt: string;
}

export interface PartnerSourceAdapter {
  provider: SourceProvider;
  collect(input: SourceAdapterRequest, runtime?: CollectRuntimeOptions): Promise<PartnerAttestation>;
}

export interface CollectRuntimeOptions {
  allowedHosts?: string[];
  authProfiles?: Record<string, AuthProfile>;
  mtlsProfiles?: Record<string, MtlsProfile>;
}

function nowIso() {
  return new Date().toISOString();
}

function randomHex(size = 6) {
  return crypto.randomBytes(size).toString('hex');
}

function getByPath(data: unknown, path: string): unknown {
  if (!path) return undefined;
  const keys = path.split('.').filter(Boolean);
  let current: unknown = data;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeScore(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  if (typeof value === 'boolean') return value ? 100 : 0;
  return fallback;
}

function monthsSince(unixMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(unixMs) || unixMs <= 0) return 0;
  return Math.max(0, Math.floor((nowMs - unixMs) / (30 * 24 * 60 * 60 * 1000)));
}

function parseJsonObjectEnv(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseCredentialLifecycle(value: unknown):
  | {
      keyVersion?: string;
      owner?: string;
      lastRotatedAt?: string;
      rotateBy?: string;
      expiresAt?: string;
    }
  | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    keyVersion: typeof record.keyVersion === 'string' ? record.keyVersion : undefined,
    owner: typeof record.owner === 'string' ? record.owner : undefined,
    lastRotatedAt: typeof record.lastRotatedAt === 'string' ? record.lastRotatedAt : undefined,
    rotateBy: typeof record.rotateBy === 'string' ? record.rotateBy : undefined,
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : undefined
  };
}

function allowedHosts(override?: string[]): Set<string> {
  if (override && override.length > 0) {
    return new Set(override.map((v) => v.trim().toLowerCase()).filter(Boolean));
  }
  const raw = process.env.TAP_SOURCE_ALLOWED_HOSTS || '';
  const hosts = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return new Set(hosts);
}

function assertAllowedHost(urlString: string, override?: string[]): void {
  const allowlist = allowedHosts(override);
  if (allowlist.size === 0) return;
  let hostname = '';
  try {
    hostname = new URL(urlString).hostname.toLowerCase();
  } catch {
    throw new AdapterError('invalid_config', `invalid source url: ${urlString}`, { statusCode: 400 });
  }
  if (!allowlist.has(hostname)) {
    throw new AdapterError('domain_not_allowed', `source host not allowed: ${hostname}`, {
      statusCode: 403,
      details: { hostname, allowlist: [...allowlist] }
    });
  }
}

function loadAuthProfiles(): Record<string, AuthProfile> {
  const raw = parseJsonObjectEnv(process.env.TAP_SOURCE_AUTH_PROFILES_JSON);
  const result: Record<string, AuthProfile> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const type = record.type;
    if (type === 'oauth2-client-credentials') {
      const tokenUrl = typeof record.tokenUrl === 'string' ? record.tokenUrl : '';
      const clientIdEnv = typeof record.clientIdEnv === 'string' ? record.clientIdEnv : '';
      const clientSecretEnv = typeof record.clientSecretEnv === 'string' ? record.clientSecretEnv : '';
      if (!tokenUrl || !clientIdEnv || !clientSecretEnv) continue;
      result[key] = {
        type,
        tokenUrl,
        clientIdEnv,
        clientSecretEnv,
        mtlsProfile: typeof record.mtlsProfile === 'string' ? record.mtlsProfile : undefined,
        scope: typeof record.scope === 'string' ? record.scope : undefined,
        audience: typeof record.audience === 'string' ? record.audience : undefined,
        header: typeof record.header === 'string' && record.header ? record.header : undefined,
        prefix: typeof record.prefix === 'string' ? record.prefix : undefined,
        lifecycle: parseCredentialLifecycle(record.lifecycle)
      };
      continue;
    }

    const secretEnv =
      typeof record.secretEnv === 'string' && record.secretEnv
        ? record.secretEnv
        : typeof record.env === 'string' && record.env
          ? record.env
          : '';
    if ((type !== 'api-key' && type !== 'bearer') || !secretEnv) continue;
    result[key] = {
      type,
      secretEnv,
      header: typeof record.header === 'string' && record.header ? record.header : undefined,
      prefix: typeof record.prefix === 'string' ? record.prefix : undefined,
      lifecycle: parseCredentialLifecycle(record.lifecycle)
    };
  }
  return result;
}

function loadMtlsProfiles(): Record<string, MtlsProfile> {
  const raw = parseJsonObjectEnv(process.env.TAP_SOURCE_MTLS_PROFILES_JSON);
  const result: Record<string, MtlsProfile> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const certEnv = typeof record.certEnv === 'string' ? record.certEnv : '';
    const keyEnv = typeof record.keyEnv === 'string' ? record.keyEnv : '';
    if (!certEnv || !keyEnv) continue;
    result[key] = {
      certEnv,
      keyEnv,
      caEnv: typeof record.caEnv === 'string' ? record.caEnv : undefined,
      passphraseEnv: typeof record.passphraseEnv === 'string' ? record.passphraseEnv : undefined,
      serverName: typeof record.serverName === 'string' ? record.serverName : undefined,
      rejectUnauthorized:
        typeof record.rejectUnauthorized === 'boolean' ? record.rejectUnauthorized : undefined,
      lifecycle: parseCredentialLifecycle(record.lifecycle)
    };
  }
  return result;
}

interface ResolvedMtlsConfig {
  cert: string;
  key: string;
  ca?: string;
  passphrase?: string;
  serverName?: string;
  rejectUnauthorized?: boolean;
}

function decodePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

function parseIsoMillis(value?: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function assertLifecycleGate(
  profileName: string,
  lifecycle:
    | {
        keyVersion?: string;
        owner?: string;
        lastRotatedAt?: string;
        rotateBy?: string;
        expiresAt?: string;
      }
    | undefined,
  kind: 'auth' | 'mtls'
): void {
  if (!lifecycle) return;
  const now = Date.now();
  const expiresAtMs = parseIsoMillis(lifecycle.expiresAt);
  if (expiresAtMs !== null && now >= expiresAtMs) {
    throw new AdapterError('auth_credential_expired', `${kind} credential expired for profile ${profileName}`, {
      statusCode: 401,
      details: {
        profileName,
        kind,
        keyVersion: lifecycle.keyVersion,
        owner: lifecycle.owner,
        expiresAt: lifecycle.expiresAt
      }
    });
  }

  const rotateByMs = parseIsoMillis(lifecycle.rotateBy);
  if (rotateByMs !== null && now >= rotateByMs) {
    throw new AdapterError('auth_rotation_required', `${kind} credential rotation required for profile ${profileName}`, {
      statusCode: 412,
      details: {
        profileName,
        kind,
        keyVersion: lifecycle.keyVersion,
        owner: lifecycle.owner,
        rotateBy: lifecycle.rotateBy,
        lastRotatedAt: lifecycle.lastRotatedAt
      }
    });
  }
}

function resolveMtlsConfig(
  profileName: string,
  overrideProfiles?: Record<string, MtlsProfile>
): ResolvedMtlsConfig {
  const profiles = overrideProfiles || loadMtlsProfiles();
  const profile = profiles[profileName];
  if (!profile) {
    throw new AdapterError('mtls_profile_not_found', `mTLS profile not found: ${profileName}`, {
      statusCode: 400
    });
  }
  assertLifecycleGate(profileName, profile.lifecycle, 'mtls');

  const certRaw = process.env[profile.certEnv];
  const keyRaw = process.env[profile.keyEnv];
  if (!certRaw || !keyRaw) {
    throw new AdapterError(
      'mtls_secret_missing',
      `missing mTLS cert/key env for profile ${profileName}: ${profile.certEnv}/${profile.keyEnv}`,
      { statusCode: 500 }
    );
  }

  const caRaw = profile.caEnv ? process.env[profile.caEnv] : undefined;
  const passphraseRaw = profile.passphraseEnv ? process.env[profile.passphraseEnv] : undefined;
  return {
    cert: decodePem(certRaw),
    key: decodePem(keyRaw),
    ca: caRaw ? decodePem(caRaw) : undefined,
    passphrase: passphraseRaw,
    serverName: profile.serverName,
    rejectUnauthorized: profile.rejectUnauthorized
  };
}

function parseJsonResponse(raw: string, context: string): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    throw new AdapterError('schema_mismatch', `${context} returned non-JSON response`, {
      statusCode: 502
    });
  }
}

async function requestWithOptionalMtls(options: {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  mtls?: ResolvedMtlsConfig;
}): Promise<{ status: number; body: unknown }> {
  if (!options.mtls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal
      });
      const raw = await response.text();
      return { status: response.status, body: parseJsonResponse(raw, 'upstream') };
    } catch (error) {
      const e = error as { name?: string; message?: string };
      if (e?.name === 'AbortError') {
        throw new AdapterError('upstream_timeout', `upstream request timed out after ${options.timeoutMs}ms`, {
          retryable: true,
          statusCode: 504
        });
      }
      throw new AdapterError('upstream_unavailable', e?.message || 'upstream request failed', {
        retryable: true,
        statusCode: 502
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  const url = new URL(options.url);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: options.headers,
        cert: options.mtls?.cert,
        key: options.mtls?.key,
        ca: options.mtls?.ca,
        passphrase: options.mtls?.passphrase,
        servername: options.mtls?.serverName || url.hostname,
        rejectUnauthorized: options.mtls?.rejectUnauthorized ?? true
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status, body: parseJsonResponse(raw, 'upstream') });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      const message = String(error.message || '');
      if (message.includes('timeout')) {
        reject(
          new AdapterError('upstream_timeout', `upstream request timed out after ${options.timeoutMs}ms`, {
            retryable: true,
            statusCode: 504
          })
        );
        return;
      }
      reject(
        new AdapterError('upstream_unavailable', error.message || 'upstream request failed', {
          retryable: true,
          statusCode: 502
        })
      );
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

const oauthTokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>();

async function resolveOauth2Token(
  profileName: string,
  profile: Extract<AuthProfile, { type: 'oauth2-client-credentials' }>,
  runtime?: CollectRuntimeOptions
): Promise<string> {
  const clientId = process.env[profile.clientIdEnv];
  const clientSecret = process.env[profile.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new AdapterError(
      'auth_secret_missing',
      `missing oauth2 env for profile ${profileName}: ${profile.clientIdEnv}/${profile.clientSecretEnv}`,
      { statusCode: 500 }
    );
  }

  const cacheKey = `${profileName}:${profile.tokenUrl}:${clientId}`;
  const cached = oauthTokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAtMs - 10_000 > now) {
    return cached.accessToken;
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  if (profile.scope) body.set('scope', profile.scope);
  if (profile.audience) body.set('audience', profile.audience);

  assertAllowedHost(profile.tokenUrl, runtime?.allowedHosts);
  const mtls = profile.mtlsProfile ? resolveMtlsConfig(profile.mtlsProfile, runtime?.mtlsProfiles) : undefined;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let response: { status: number; body: unknown };
  try {
    response = await requestWithOptionalMtls({
      url: profile.tokenUrl,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`
      },
      body: body.toString(),
      timeoutMs: 15_000,
      mtls
    });
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('auth_token_fetch_failed', `oauth2 token request failed for ${profileName}`, {
      retryable: true,
      statusCode: 502,
      details: { error: String(error) }
    });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new AdapterError(
      'upstream_bad_response',
      `oauth2 token endpoint returned ${response.status} for ${profileName}`,
      {
        retryable: response.status >= 500,
        statusCode: response.status
      }
    );
  }

  const tokenBody = response.body as { access_token?: string; expires_in?: number };
  const accessToken = tokenBody.access_token;
  if (!accessToken) {
    throw new AdapterError('auth_token_fetch_failed', `oauth2 token response missing access_token for ${profileName}`, {
      statusCode: 502
    });
  }

  const ttlSec = Number.isFinite(tokenBody.expires_in) ? Math.max(30, Number(tokenBody.expires_in)) : 300;
  oauthTokenCache.set(cacheKey, {
    accessToken,
    expiresAtMs: now + ttlSec * 1000
  });

  return accessToken;
}

async function applyAuthProfile(
  headers: Record<string, string>,
  profileName: string | undefined,
  runtime?: CollectRuntimeOptions
): Promise<Record<string, string>> {
  if (!profileName) return headers;
  const profiles = runtime?.authProfiles || loadAuthProfiles();
  const profile = profiles[profileName];
  if (!profile) {
    throw new AdapterError('auth_profile_not_found', `auth profile not found: ${profileName}`, {
      statusCode: 400
    });
  }
  assertLifecycleGate(profileName, profile.lifecycle, 'auth');
  if (profile.type === 'oauth2-client-credentials') {
    const token = await resolveOauth2Token(profileName, profile, runtime);
    headers[profile.header || 'authorization'] = `${profile.prefix || 'Bearer '}${token}`;
    return headers;
  }

  const secret = process.env[profile.secretEnv];
  if (!secret) {
    throw new AdapterError('auth_secret_missing', `missing secret env for profile ${profileName}: ${profile.secretEnv}`, {
      statusCode: 500
    });
  }

  if (profile.type === 'api-key') {
    headers[profile.header || 'x-api-key'] = `${profile.prefix || ''}${secret}`;
    return headers;
  }

  headers[profile.header || 'authorization'] = `${profile.prefix || 'Bearer '}${secret}`;
  return headers;
}

const mockBankAdapter: PartnerSourceAdapter = {
  provider: 'mock-bank',
  async collect(input) {
    const source = (input.source || {}) as MockBankSource;
    const balanceCents = source.balanceCents ?? 50_000;
    const kycPassed = source.kycPassed ?? true;
    const accountStatus = source.accountStatus ?? 'active';
    const eligible = kycPassed && accountStatus === 'active' && balanceCents >= 10_000;
    const score = normalizeScore(
      Math.round(Math.min(100, balanceCents / 10_000) * (kycPassed ? 1 : 0.25))
    );

    return {
      attestationId: `att_src_${Date.now()}_${randomHex(3)}`,
      provider: 'mock-bank',
      subjectCommitment: input.subjectCommitment,
      eligible,
      score,
      fields: { balanceCents, kycPassed, accountStatus },
      raw: { balanceCents, kycPassed, accountStatus },
      receivedAt: nowIso()
    };
  }
};

const genericRestAdapter: PartnerSourceAdapter = {
  provider: 'generic-rest',
  async collect(input, runtime) {
    const source = (input.source || {}) as GenericRestSource;
    if (!source.url) {
      throw new AdapterError('invalid_config', 'generic-rest requires source.url', {
        statusCode: 400
      });
    }
    assertAllowedHost(source.url, runtime?.allowedHosts);

    const requestHeaders = await applyAuthProfile({ ...(source.headers || {}) }, source.authProfile, runtime);
    const mtls = source.mtlsProfile ? resolveMtlsConfig(source.mtlsProfile, runtime?.mtlsProfiles) : undefined;
    const timeoutMs = source.timeoutMs ?? 15_000;
    let responseBody: unknown;
    const retryCount = source.retryCount ?? 1;

    try {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          const response = await requestWithOptionalMtls({
            url: source.url,
            method: source.method || 'GET',
            headers: requestHeaders,
            body: source.body ? JSON.stringify(source.body) : undefined,
            timeoutMs,
            mtls
          });

          if (response.status < 200 || response.status >= 300) {
            throw new AdapterError('upstream_bad_response', `generic-rest response status ${response.status}`, {
              retryable: response.status >= 500,
              statusCode: response.status,
              details: { status: response.status }
            });
          }

          responseBody = response.body;
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= retryCount) break;
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }

      if (lastError) {
        throw lastError;
      }
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      const e = error as { name?: string; message?: string };
      if (e?.name === 'AbortError') {
        throw new AdapterError('upstream_timeout', `source request timed out after ${timeoutMs}ms`, {
          retryable: true,
          statusCode: 504
        });
      }
      throw new AdapterError('upstream_unavailable', e?.message || 'source request failed', {
        retryable: true,
        statusCode: 502
      });
    }

    const extract: NonNullable<GenericRestSource['extract']> = source.extract || {};
    const eligibleRaw = extract.eligibilityPath
      ? getByPath(responseBody, extract.eligibilityPath)
      : undefined;
    const subjectRaw = extract.subjectPath ? getByPath(responseBody, extract.subjectPath) : undefined;
    const scoreRaw = extract.scorePath ? getByPath(responseBody, extract.scorePath) : undefined;

    const mappedFields: Record<string, string | number | boolean> = {};
    for (const [field, fieldPath] of Object.entries(extract.fields || {} as Record<string, string>)) {
      const value = getByPath(responseBody, fieldPath);
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        mappedFields[field] = value;
      }
    }

    const eligible =
      typeof eligibleRaw === 'boolean'
        ? eligibleRaw
        : typeof eligibleRaw === 'number'
          ? eligibleRaw > 0
          : normalizeScore(scoreRaw, 0) >= 70;

    return {
      attestationId: `att_src_${Date.now()}_${randomHex(3)}`,
      provider: 'generic-rest',
      subjectCommitment: typeof subjectRaw === 'string' ? subjectRaw : input.subjectCommitment,
      eligible,
      score: normalizeScore(scoreRaw, eligible ? 80 : 40),
      fields: mappedFields,
      raw: responseBody,
      receivedAt: nowIso()
    };
  }
};

const plaidAdapter: PartnerSourceAdapter = {
  provider: 'plaid',
  async collect(input, runtime) {
    const source = (input.source || {}) as PlaidSource;
    if (!source.accessToken) {
      throw new AdapterError('invalid_config', 'plaid requires source.accessToken', { statusCode: 400 });
    }

    const clientIdEnv = source.clientIdEnv || 'PLAID_CLIENT_ID';
    const secretEnv = source.secretEnv || 'PLAID_SECRET';
    const clientId = process.env[clientIdEnv];
    const secret = process.env[secretEnv];
    if (!clientId || !secret) {
      throw new AdapterError('auth_secret_missing', `missing plaid creds in env: ${clientIdEnv}/${secretEnv}`, {
        statusCode: 500
      });
    }

    const baseUrl = source.baseUrl || process.env.PLAID_BASE_URL || 'https://sandbox.plaid.com';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/accounts/balance/get`;
    assertAllowedHost(endpoint, runtime?.allowedHosts);

    const controller = new AbortController();
    const timeoutMs = 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          secret,
          access_token: source.accessToken
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AdapterError('upstream_bad_response', `plaid response status ${response.status}`, {
          retryable: response.status >= 500,
          statusCode: response.status,
          details: { status: response.status }
        });
      }

      const body = (await response.json()) as {
        accounts?: Array<{
          mask?: string;
          subtype?: string;
          balances?: {
            available?: number | null;
            current?: number | null;
            iso_currency_code?: string | null;
          };
        }>;
        item?: { institution_id?: string };
        request_id?: string;
      };

      const accounts = body.accounts || [];
      if (accounts.length === 0) {
        throw new AdapterError('schema_mismatch', 'plaid response missing accounts', { statusCode: 422 });
      }

      const availableCents = Math.round(
        accounts.reduce((sum, account) => sum + Number(account.balances?.available || 0), 0) * 100
      );
      const currentCents = Math.round(
        accounts.reduce((sum, account) => sum + Number(account.balances?.current || 0), 0) * 100
      );
      const currency =
        accounts.find((a) => typeof a.balances?.iso_currency_code === 'string')?.balances?.iso_currency_code ||
        'USD';
      const minBalanceCents = source.minBalanceCents ?? 10_000;
      const requirePositiveBalance = source.requirePositiveBalance ?? true;
      const eligible =
        currentCents >= minBalanceCents &&
        (!requirePositiveBalance || availableCents > 0);
      const score = normalizeScore(Math.min(100, Math.round(currentCents / 10_000)));

      return {
        attestationId: `att_src_${Date.now()}_${randomHex(3)}`,
        provider: 'plaid',
        subjectCommitment: input.subjectCommitment,
        eligible,
        score,
        fields: {
          accountCount: accounts.length,
          availableBalanceCents: availableCents,
          currentBalanceCents: currentCents,
          minBalanceCents,
          requirePositiveBalance,
          currency,
          institutionId: body.item?.institution_id || '',
          plaidRequestId: body.request_id || ''
        },
        raw: body,
        receivedAt: nowIso()
      };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      const e = error as { name?: string; message?: string };
      if (e?.name === 'AbortError') {
        throw new AdapterError('upstream_timeout', `plaid request timed out after ${timeoutMs}ms`, {
          retryable: true,
          statusCode: 504
        });
      }
      throw new AdapterError('upstream_unavailable', e?.message || 'plaid request failed', {
        retryable: true,
        statusCode: 502
      });
    } finally {
      clearTimeout(timeout);
    }
  }
};

const increaseAdapter: PartnerSourceAdapter = {
  provider: 'increase',
  async collect(input, runtime) {
    const source = (input.source || {}) as IncreaseSource;
    if (!source.accountId) {
      throw new AdapterError('invalid_config', 'increase requires source.accountId', { statusCode: 400 });
    }

    const apiKeyEnv = source.apiKeyEnv || 'INCREASE_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new AdapterError('auth_secret_missing', `missing increase api key env: ${apiKeyEnv}`, {
        statusCode: 500
      });
    }

    const baseUrl = source.baseUrl || process.env.INCREASE_BASE_URL || 'https://api.increase.com';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/accounts/${encodeURIComponent(source.accountId)}/balance`;
    assertAllowedHost(endpoint, runtime?.allowedHosts);

    const response = await requestWithOptionalMtls({
      url: endpoint,
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json'
      },
      timeoutMs: 15_000
    });
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError('upstream_bad_response', `increase response status ${response.status}`, {
        retryable: response.status >= 500,
        statusCode: response.status
      });
    }

    const body = response.body as Record<string, unknown>;
    const currentBalanceCents = Number(body.current_balance ?? body.current_balance_cents ?? 0);
    const availableBalanceCents = Number(
      body.available_balance ?? body.available_balance_cents ?? currentBalanceCents
    );
    const accountStatus = String(body.account_status ?? body.status ?? '');
    const currency = String(body.currency ?? 'USD');
    const accountId = String(body.account_id ?? body.id ?? source.accountId);
    const minBalanceCents = source.minBalanceCents ?? 10_000;
    const requirePositiveAvailable = source.requirePositiveAvailable ?? true;
    const requireOpenAccount = source.requireOpenAccount ?? true;
    const openAccount = ['open', 'active'].includes(accountStatus.toLowerCase());
    const eligible =
      currentBalanceCents >= minBalanceCents &&
      (!requirePositiveAvailable || availableBalanceCents > 0) &&
      (!requireOpenAccount || openAccount);

    return {
      attestationId: `att_src_${Date.now()}_${randomHex(3)}`,
      provider: 'increase',
      subjectCommitment: input.subjectCommitment,
      eligible,
      score: normalizeScore(Math.min(100, Math.round(currentBalanceCents / 10_000))),
      fields: {
        accountId,
        currentBalanceCents,
        availableBalanceCents,
        minBalanceCents,
        requirePositiveAvailable,
        requireOpenAccount,
        accountStatus,
        currency
      },
      raw: body,
      receivedAt: nowIso()
    };
  }
};

const personaAdapter: PartnerSourceAdapter = {
  provider: 'persona',
  async collect(input, runtime) {
    const source = (input.source || {}) as PersonaSource;
    if (!source.inquiryId) {
      throw new AdapterError('invalid_config', 'persona requires source.inquiryId', { statusCode: 400 });
    }

    const apiKeyEnv = source.apiKeyEnv || 'PERSONA_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new AdapterError('auth_secret_missing', `missing persona api key env: ${apiKeyEnv}`, {
        statusCode: 500
      });
    }

    const baseUrl = source.baseUrl || process.env.PERSONA_BASE_URL || 'https://withpersona.com';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/v1/inquiries/${encodeURIComponent(source.inquiryId)}`;
    assertAllowedHost(endpoint, runtime?.allowedHosts);

    const response = await requestWithOptionalMtls({
      url: endpoint,
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json'
      },
      timeoutMs: 15_000
    });
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError('upstream_bad_response', `persona response status ${response.status}`, {
        retryable: response.status >= 500,
        statusCode: response.status
      });
    }

    const body = response.body as Record<string, unknown>;
    const data = (body.data || {}) as Record<string, unknown>;
    const attributes = (data.attributes || {}) as Record<string, unknown>;
    const statusRaw =
      (typeof attributes.status === 'string' ? attributes.status : undefined) ||
      (typeof data.status === 'string' ? data.status : undefined) ||
      '';

    const accepted = (source.acceptedStatuses || ['approved', 'completed', 'passed']).map((v) =>
      v.trim().toLowerCase()
    );
    const kycPassed = accepted.includes(statusRaw.toLowerCase());
    const requirePassed = source.requirePassed ?? true;
    const eligible = requirePassed ? kycPassed : true;

    const referenceId =
      (typeof attributes['reference-id'] === 'string' ? attributes['reference-id'] : undefined) ||
      (typeof attributes.referenceId === 'string' ? attributes.referenceId : undefined) ||
      input.subjectCommitment;

    const countryCode =
      (typeof attributes['country-code'] === 'string' ? attributes['country-code'] : undefined) ||
      (typeof attributes.countryCode === 'string' ? attributes.countryCode : undefined) ||
      '';

    return {
      attestationId: `att_src_${Date.now()}_${randomHex(3)}`,
      provider: 'persona',
      subjectCommitment: referenceId,
      eligible,
      score: kycPassed ? 95 : 35,
      fields: {
        inquiryId: source.inquiryId,
        personaStatus: statusRaw,
        kycPassed,
        requirePassed,
        countryCode
      },
      raw: body,
      receivedAt: nowIso()
    };
  }
};

const custodyHoldingsAdapter: PartnerSourceAdapter = {
  provider: 'custody-holdings',
  async collect(input, runtime) {
    const source = (input.source || {}) as CustodyHoldingsSource;
    if (!source.accountId) {
      throw new AdapterError('invalid_config', 'custody-holdings requires source.accountId', { statusCode: 400 });
    }

    const apiKeyEnv = source.apiKeyEnv || 'CUSTODY_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new AdapterError('auth_secret_missing', `missing custody api key env: ${apiKeyEnv}`, {
        statusCode: 500
      });
    }

    const baseUrl = source.baseUrl || process.env.CUSTODY_BASE_URL || 'https://sandbox.custody.example';
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v1/accounts/${encodeURIComponent(source.accountId)}/holdings`);
    if (source.assetSymbol) url.searchParams.set('symbol', source.assetSymbol);
    if (source.certificateId) url.searchParams.set('certificateId', source.certificateId);
    assertAllowedHost(url.toString(), runtime?.allowedHosts);

    const response = await requestWithOptionalMtls({
      url: url.toString(),
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json'
      },
      timeoutMs: 15_000
    });
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError('upstream_bad_response', `custody-holdings response status ${response.status}`, {
        retryable: response.status >= 500,
        statusCode: response.status
      });
    }

    const body = response.body as Record<string, unknown>;
    const holdingsRaw = Array.isArray(body.holdings) ? body.holdings : [];
    if (holdingsRaw.length === 0) {
      throw new AdapterError('schema_mismatch', 'custody-holdings response missing holdings', {
        statusCode: 422
      });
    }

    const matched = holdingsRaw.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const r = item as Record<string, unknown>;
      const symbolOk =
        !source.assetSymbol ||
        (typeof r.symbol === 'string' && r.symbol.toLowerCase() === source.assetSymbol.toLowerCase());
      const certOk =
        !source.certificateId ||
        (typeof r.certificateId === 'string' && r.certificateId === source.certificateId);
      return symbolOk && certOk;
    }) as Record<string, unknown> | undefined;

    const holding = matched || (holdingsRaw[0] as Record<string, unknown>);
    const symbol = typeof holding.symbol === 'string' ? holding.symbol : source.assetSymbol || '';
    const certificateId =
      typeof holding.certificateId === 'string' ? holding.certificateId : source.certificateId || '';
    const status = typeof holding.certificateStatus === 'string' ? holding.certificateStatus : '';
    const units = typeof holding.units === 'number' && Number.isFinite(holding.units) ? holding.units : 0;
    const minUnits = source.minUnits ?? 1;
    const certificateValid = ['valid', 'verified', 'active'].includes(status.toLowerCase());
    const requireCertificateValid = source.requireCertificateValid ?? true;
    const eligible = units >= minUnits && (!requireCertificateValid || certificateValid);

    return {
      attestationId: `att_src_${Date.now()}_${randomHex(3)}`,
      provider: 'custody-holdings',
      subjectCommitment: input.subjectCommitment,
      eligible,
      score: normalizeScore(Math.min(100, Math.round(units * 10))),
      fields: {
        accountId: source.accountId,
        symbol,
        units,
        minUnits,
        certificateId,
        certificateStatus: status,
        certificateValid,
        requireCertificateValid
      },
      raw: body,
      receivedAt: nowIso()
    };
  }
};

const zktlsEmployerAdapter: PartnerSourceAdapter = {
  provider: 'zktls-employer',
  async collect(input) {
    const source = (input.source || {}) as ZkTlsEmployerSource;
    const status = await assertZkTlsRepoReady();
    if (!status.exists || !status.hasMoon) {
      throw new AdapterError('dependency_not_ready', 'zktls repo not ready', {
        statusCode: 503,
        retryable: false,
        details: status
      });
    }

    const mode = source.mode === 'ineligible' ? 'ineligible' : 'eligible';
    const artifacts = source.runPipelineFirst
      ? (await runZkTlsPipeline({ mode, profile: 'employment' })).artifacts
      : await latestZkTlsArtifacts();
    const disclosed = (artifacts.disclosedFields || {}) as Record<string, unknown>;
    const attestation = (artifacts.attestation || {}) as Record<string, unknown>;
    const proof = (artifacts.proof || {}) as Record<string, unknown>;
    if (String(disclosed.source_profile || 'employment') !== 'employment') {
      throw new AdapterError('schema_mismatch', 'latest zktls artifacts are not employment-shaped', {
        statusCode: 422,
        details: { runId: artifacts.runId, sourceProfile: disclosed.source_profile }
      });
    }
    const expectedServerName = source.expectedServerName || 'localhost';

    const salary = Number(disclosed.salary ?? 0);
    const hireDateUnix = Number(disclosed.hire_date_unix ?? 0);
    const tenureMonths = monthsSince(hireDateUnix);
    const statusHash = String(disclosed.status_hash ?? '');
    const responseBodyHash = String(disclosed.response_body_hash ?? '');
    const publicOutput = Array.isArray((proof.proof as Record<string, unknown> | undefined)?.publicOutput)
      ? (((proof.proof as Record<string, unknown>).publicOutput as unknown[]) || [])
      : [];
    const proofEligible =
      String(publicOutput[0] ?? '').toLowerCase() === '1' ||
      String(publicOutput[0] ?? '').toLowerCase() === 'true';
    const serverName = String(attestation.server_name || '');
    const employmentStatus = (() => {
      const body = typeof attestation.response_body === 'string' ? attestation.response_body : '';
      if (!body) return '';
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        return typeof parsed.employment_status === 'string' ? parsed.employment_status : '';
      } catch {
        return '';
      }
    })();

    if (expectedServerName && serverName !== expectedServerName) {
      throw new AdapterError('schema_mismatch', `zktls server_name mismatch: expected ${expectedServerName}, got ${serverName}`, {
        statusCode: 422,
        details: { expectedServerName, serverName, runId: artifacts.runId }
      });
    }

    const minSalary = source.minSalary ?? 50_000;
    const minTenureMonths = source.minTenureMonths ?? 12;
    const requireActive = source.requireActive ?? true;
    const activeOk = !requireActive || employmentStatus.toLowerCase() === 'active';
    const eligible = proofEligible && salary >= minSalary && tenureMonths >= minTenureMonths && activeOk;
    const score = normalizeScore(
      eligible ? Math.min(100, Math.round((salary / Math.max(minSalary, 1)) * 80 + 20)) : 30
    );

    return {
      attestationId: `att_zktls_${artifacts.runId}_${randomHex(3)}`,
      provider: 'zktls-employer',
      subjectCommitment: input.subjectCommitment,
      eligible,
      score,
      fields: {
        runId: artifacts.runId,
        salary,
        hireDateUnix,
        tenureMonths,
        employmentStatus,
        minSalary,
        minTenureMonths,
        requireActive,
        proofEligible,
        serverName,
        responseBodyHash,
        statusHash
      },
      raw: {
        runId: artifacts.runId,
        outputDir: artifacts.outputDir,
        attestation: artifacts.attestation,
        disclosedFields: artifacts.disclosedFields,
        proof: artifacts.proof,
        verificationKey: artifacts.verificationKey
      },
      receivedAt: nowIso()
    };
  }
};

const zktlsBankAdapter: PartnerSourceAdapter = {
  provider: 'zktls-bank',
  async collect(input) {
    const source = (input.source || {}) as ZkTlsBankSource;
    const status = await assertZkTlsRepoReady();
    if (!status.exists || !status.hasMoon) {
      throw new AdapterError('dependency_not_ready', 'zktls repo not ready', {
        statusCode: 503,
        retryable: false,
        details: status
      });
    }

    const mode = source.mode === 'ineligible' ? 'ineligible' : 'eligible';
    const artifacts = source.runPipelineFirst
      ? (await runZkTlsPipeline({ mode, profile: 'bank' })).artifacts
      : await latestZkTlsArtifacts();
    const disclosed = (artifacts.disclosedFields || {}) as Record<string, unknown>;
    if (String(disclosed.source_profile || '') !== 'bank') {
      throw new AdapterError('schema_mismatch', 'latest zktls artifacts are not bank-shaped', {
        statusCode: 422,
        details: { runId: artifacts.runId, sourceProfile: disclosed.source_profile }
      });
    }
    const attestation = (artifacts.attestation || {}) as Record<string, unknown>;
    const expectedServerName = source.expectedServerName || 'localhost';
    const serverName = String(attestation.server_name || '');
    if (expectedServerName && serverName !== expectedServerName) {
      throw new AdapterError('schema_mismatch', `zktls server_name mismatch: expected ${expectedServerName}, got ${serverName}`, {
        statusCode: 422,
        details: { expectedServerName, serverName, runId: artifacts.runId }
      });
    }

    const body = (() => {
      const raw = typeof attestation.response_body === 'string' ? attestation.response_body : '';
      if (!raw) return {} as Record<string, unknown>;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new AdapterError('schema_mismatch', 'zktls bank response body is not valid JSON', {
          statusCode: 422,
          details: { runId: artifacts.runId }
        });
      }
    })();

    const currentBalanceCents = Number(
      body.current_balance_cents ?? body.currentBalanceCents ?? body.balance_cents ?? 0
    );
    const availableBalanceCents = Number(
      body.available_balance_cents ?? body.availableBalanceCents ?? currentBalanceCents
    );
    const currency = String(body.currency || 'USD');
    const accountStatus = String(body.account_status ?? body.accountStatus ?? '');
    const kycPassed = Boolean(body.kyc_passed ?? body.kycPassed ?? false);
    const accountId = String(body.account_id ?? body.accountId ?? '');

    const minBalanceCents = source.minBalanceCents ?? 10_000;
    const requirePositiveAvailable = source.requirePositiveAvailable ?? true;
    const requireKycPassed = source.requireKycPassed ?? true;
    const eligible =
      currentBalanceCents >= minBalanceCents &&
      (!requirePositiveAvailable || availableBalanceCents > 0) &&
      accountStatus.toLowerCase() === 'active' &&
      (!requireKycPassed || kycPassed);

    return {
      attestationId: `att_zktls_bank_${artifacts.runId}_${randomHex(3)}`,
      provider: 'zktls-bank',
      subjectCommitment: input.subjectCommitment,
      eligible,
      score: normalizeScore(
        eligible ? Math.min(100, Math.round(currentBalanceCents / Math.max(minBalanceCents, 1))) : 25
      ),
      fields: {
        runId: artifacts.runId,
        accountId,
        currentBalanceCents,
        availableBalanceCents,
        minBalanceCents,
        requirePositiveAvailable,
        requireKycPassed,
        currency,
        accountStatus,
        kycPassed,
        serverName
      },
      raw: {
        runId: artifacts.runId,
        outputDir: artifacts.outputDir,
        attestation: artifacts.attestation,
        disclosedFields: artifacts.disclosedFields,
        proof: artifacts.proof,
        verificationKey: artifacts.verificationKey
      },
      receivedAt: nowIso()
    };
  }
};

const adapters: Record<SourceProvider, PartnerSourceAdapter> = {
  'mock-bank': mockBankAdapter,
  'generic-rest': genericRestAdapter,
  increase: increaseAdapter,
  plaid: plaidAdapter,
  persona: personaAdapter,
  'custody-holdings': custodyHoldingsAdapter,
  'zktls-employer': zktlsEmployerAdapter,
  'zktls-bank': zktlsBankAdapter
};

export function listSourceProviders(): SourceProvider[] {
  return Object.keys(adapters) as SourceProvider[];
}

export async function collectPartnerAttestation(
  input: SourceAdapterRequest,
  runtime?: CollectRuntimeOptions
): Promise<PartnerAttestation> {
  const adapter = adapters[input.provider];
  if (!adapter) {
    throw new AdapterError('invalid_config', `unsupported source provider: ${input.provider}`, {
      statusCode: 400
    });
  }
  return adapter.collect(input, runtime);
}
