import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { TenantProviderConfig } from '@tap/shared-types';

interface TenantConfigStore {
  providerConfigs: TenantProviderConfig[];
}

interface TenantConfigRepository {
  upsert(config: Omit<TenantProviderConfig, 'updatedAt'>): Promise<TenantProviderConfig>;
  get(tenantId: string, provider: TenantProviderConfig['provider']): Promise<TenantProviderConfig | null>;
  list(tenantId: string): Promise<TenantProviderConfig[]>;
  listAll(): Promise<TenantProviderConfig[]>;
}

function dataDir() {
  return process.env.TAP_DATA_DIR || path.join(process.cwd(), 'output');
}

function storeFile() {
  return path.join(dataDir(), 'tenant-provider-configs.json');
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureStore() {
  await fs.mkdir(dataDir(), { recursive: true });
  try {
    await fs.access(storeFile());
  } catch {
    const initial: TenantConfigStore = { providerConfigs: [] };
    await fs.writeFile(storeFile(), JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function readStore(): Promise<TenantConfigStore> {
  await ensureStore();
  const raw = await fs.readFile(storeFile(), 'utf8');
  return JSON.parse(raw) as TenantConfigStore;
}

async function writeStore(store: TenantConfigStore) {
  await fs.writeFile(storeFile(), JSON.stringify(store, null, 2), 'utf8');
}

class FileTenantConfigRepository implements TenantConfigRepository {
  async upsert(config: Omit<TenantProviderConfig, 'updatedAt'>): Promise<TenantProviderConfig> {
    const store = await readStore();
    const updatedAt = nowIso();
    const normalized: TenantProviderConfig = {
      ...config,
      enabled: config.enabled ?? true,
      allowedHosts: config.allowedHosts ?? [],
      quotaPerHour: config.quotaPerHour ?? 1000,
      mappingVersion: config.mappingVersion ?? 'v1',
      authProfiles: config.authProfiles ?? {},
      mtlsProfiles: config.mtlsProfiles ?? {},
      failoverProviders: config.failoverProviders ?? [],
      routingStrategy: config.routingStrategy ?? 'ordered',
      routingWeight: config.routingWeight ?? 0,
      updatedAt
    };

    const existing = store.providerConfigs.find(
      (item) => item.tenantId === normalized.tenantId && item.provider === normalized.provider
    );
    if (existing) Object.assign(existing, normalized);
    else store.providerConfigs.unshift(normalized);

    await writeStore(store);
    return normalized;
  }

  async get(
    tenantId: string,
    provider: TenantProviderConfig['provider']
  ): Promise<TenantProviderConfig | null> {
    const store = await readStore();
    return (
      store.providerConfigs.find((item) => item.tenantId === tenantId && item.provider === provider) || null
    );
  }

  async list(tenantId: string): Promise<TenantProviderConfig[]> {
    const store = await readStore();
    return store.providerConfigs.filter((item) => item.tenantId === tenantId);
  }

  async listAll(): Promise<TenantProviderConfig[]> {
    const store = await readStore();
    return [...store.providerConfigs];
  }
}

class PostgresTenantConfigRepository implements TenantConfigRepository {
  private pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tap_tenant_provider_configs (
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
        allowed_hosts JSONB NOT NULL,
        quota_per_hour INTEGER NOT NULL,
        mapping_version TEXT NOT NULL,
        auth_profiles JSONB NOT NULL,
        mtls_profiles JSONB NOT NULL DEFAULT '{}'::jsonb,
        failover_providers JSONB NOT NULL DEFAULT '[]'::jsonb,
        routing_strategy TEXT NOT NULL DEFAULT 'ordered',
        routing_weight INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tenant_id, provider)
      )
    `);
    await this.pool.query(`
      ALTER TABLE tap_tenant_provider_configs
      ADD COLUMN IF NOT EXISTS mtls_profiles JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    await this.pool.query(`
      ALTER TABLE tap_tenant_provider_configs
      ADD COLUMN IF NOT EXISTS failover_providers JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await this.pool.query(`
      ALTER TABLE tap_tenant_provider_configs
      ADD COLUMN IF NOT EXISTS routing_strategy TEXT NOT NULL DEFAULT 'ordered'
    `);
    await this.pool.query(`
      ALTER TABLE tap_tenant_provider_configs
      ADD COLUMN IF NOT EXISTS routing_weight INTEGER NOT NULL DEFAULT 0
    `);
  }

  async upsert(config: Omit<TenantProviderConfig, 'updatedAt'>): Promise<TenantProviderConfig> {
    await this.init();
    const updatedAt = nowIso();
    const normalized: TenantProviderConfig = {
      ...config,
      enabled: config.enabled ?? true,
      allowedHosts: config.allowedHosts ?? [],
      quotaPerHour: config.quotaPerHour ?? 1000,
      mappingVersion: config.mappingVersion ?? 'v1',
      authProfiles: config.authProfiles ?? {},
      mtlsProfiles: config.mtlsProfiles ?? {},
      failoverProviders: config.failoverProviders ?? [],
      routingStrategy: config.routingStrategy ?? 'ordered',
      routingWeight: config.routingWeight ?? 0,
      updatedAt
    };

    await this.pool.query(
      `
        INSERT INTO tap_tenant_provider_configs (
          tenant_id, provider, enabled, allowed_hosts, quota_per_hour, mapping_version, auth_profiles, mtls_profiles, failover_providers, routing_strategy, routing_weight, updated_at
        )
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)
        ON CONFLICT (tenant_id, provider)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          allowed_hosts = EXCLUDED.allowed_hosts,
          quota_per_hour = EXCLUDED.quota_per_hour,
          mapping_version = EXCLUDED.mapping_version,
          auth_profiles = EXCLUDED.auth_profiles,
          mtls_profiles = EXCLUDED.mtls_profiles,
          failover_providers = EXCLUDED.failover_providers,
          routing_strategy = EXCLUDED.routing_strategy,
          routing_weight = EXCLUDED.routing_weight,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.tenantId,
        normalized.provider,
        normalized.enabled,
        JSON.stringify(normalized.allowedHosts),
        normalized.quotaPerHour,
        normalized.mappingVersion,
        JSON.stringify(normalized.authProfiles),
        JSON.stringify(normalized.mtlsProfiles),
        JSON.stringify(normalized.failoverProviders),
        normalized.routingStrategy,
        normalized.routingWeight,
        normalized.updatedAt
      ]
    );

    return normalized;
  }

  async get(
    tenantId: string,
    provider: TenantProviderConfig['provider']
  ): Promise<TenantProviderConfig | null> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_tenant_provider_configs WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      tenantId: r.tenant_id,
      provider: r.provider,
      enabled: r.enabled,
      allowedHosts: r.allowed_hosts || [],
      quotaPerHour: r.quota_per_hour,
      mappingVersion: r.mapping_version,
      authProfiles: r.auth_profiles || {},
      mtlsProfiles: r.mtls_profiles || {},
      failoverProviders: r.failover_providers || [],
      routingStrategy: r.routing_strategy || 'ordered',
      routingWeight: Number.isFinite(r.routing_weight) ? r.routing_weight : 0,
      updatedAt: new Date(r.updated_at).toISOString()
    };
  }

  async list(tenantId: string): Promise<TenantProviderConfig[]> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_tenant_provider_configs WHERE tenant_id = $1 ORDER BY updated_at DESC`,
      [tenantId]
    );
    return rows.map((r: any) => ({
      tenantId: r.tenant_id,
      provider: r.provider,
      enabled: r.enabled,
      allowedHosts: r.allowed_hosts || [],
      quotaPerHour: r.quota_per_hour,
      mappingVersion: r.mapping_version,
      authProfiles: r.auth_profiles || {},
      mtlsProfiles: r.mtls_profiles || {},
      failoverProviders: r.failover_providers || [],
      routingStrategy: r.routing_strategy || 'ordered',
      routingWeight: Number.isFinite(r.routing_weight) ? r.routing_weight : 0,
      updatedAt: new Date(r.updated_at).toISOString()
    }));
  }

  async listAll(): Promise<TenantProviderConfig[]> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_tenant_provider_configs ORDER BY updated_at DESC`
    );
    return rows.map((r: any) => ({
      tenantId: r.tenant_id,
      provider: r.provider,
      enabled: r.enabled,
      allowedHosts: r.allowed_hosts || [],
      quotaPerHour: r.quota_per_hour,
      mappingVersion: r.mapping_version,
      authProfiles: r.auth_profiles || {},
      mtlsProfiles: r.mtls_profiles || {},
      failoverProviders: r.failover_providers || [],
      routingStrategy: r.routing_strategy || 'ordered',
      routingWeight: Number.isFinite(r.routing_weight) ? r.routing_weight : 0,
      updatedAt: new Date(r.updated_at).toISOString()
    }));
  }
}

let repo: TenantConfigRepository | null = null;

async function resolveRepository(): Promise<TenantConfigRepository> {
  if (repo) return repo;
  const dbUrl = process.env.TAP_DATABASE_URL;
  if (!dbUrl) {
    repo = new FileTenantConfigRepository();
    return repo;
  }

  try {
    const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const pg = await importer('pg');
    const pool = new pg.Pool({ connectionString: dbUrl });
    repo = new PostgresTenantConfigRepository(pool);
    return repo;
  } catch (error) {
    throw new Error(
      `TAP_DATABASE_URL is set but Postgres driver is unavailable. Install 'pg' or unset TAP_DATABASE_URL. ${String(error)}`
    );
  }
}

export async function upsertTenantProviderConfig(
  config: Omit<TenantProviderConfig, 'updatedAt'>
): Promise<TenantProviderConfig> {
  return (await resolveRepository()).upsert(config);
}

export async function getTenantProviderConfig(
  tenantId: string,
  provider: TenantProviderConfig['provider']
): Promise<TenantProviderConfig | null> {
  return (await resolveRepository()).get(tenantId, provider);
}

export async function listTenantProviderConfigs(tenantId: string): Promise<TenantProviderConfig[]> {
  return (await resolveRepository()).list(tenantId);
}

export async function listAllTenantProviderConfigs(): Promise<TenantProviderConfig[]> {
  return (await resolveRepository()).listAll();
}
