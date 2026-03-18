import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { PolicyVersion, UpsertPolicyRequest } from '@tap/shared-types';

interface PolicyStore {
  policies: PolicyVersion[];
}

interface PolicyRepository {
  upsert(input: UpsertPolicyRequest): Promise<PolicyVersion>;
  list(tenantId: string, policyId: number): Promise<PolicyVersion[]>;
  resolveActive(tenantId: string, policyId: number, asOfIso: string): Promise<PolicyVersion | null>;
}

function dataDir() {
  return process.env.TAP_DATA_DIR || path.join(process.cwd(), 'output');
}

function storeFile() {
  return path.join(dataDir(), 'policies.json');
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureStore() {
  await fs.mkdir(dataDir(), { recursive: true });
  try {
    await fs.access(storeFile());
  } catch {
    const initial: PolicyStore = { policies: [] };
    await fs.writeFile(storeFile(), JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function readStore(): Promise<PolicyStore> {
  await ensureStore();
  const raw = await fs.readFile(storeFile(), 'utf8');
  return JSON.parse(raw) as PolicyStore;
}

async function writeStore(store: PolicyStore) {
  await fs.writeFile(storeFile(), JSON.stringify(store, null, 2), 'utf8');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
    return sorted;
  }
  return value;
}

export function hashPolicy(input: {
  tenantId: string;
  policyId: number;
  version: number;
  jurisdiction: string;
  rules: Record<string, unknown>;
  effectiveAt: string;
}): string {
  const payload = JSON.stringify(canonicalize(input));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

class FilePolicyRepository implements PolicyRepository {
  async upsert(input: UpsertPolicyRequest): Promise<PolicyVersion> {
    const store = await readStore();
    const record: PolicyVersion = {
      tenantId: input.tenantId,
      policyId: input.policyId,
      version: input.version,
      jurisdiction: input.jurisdiction,
      rules: input.rules,
      effectiveAt: input.effectiveAt,
      status: input.status,
      policyHash: hashPolicy({
        tenantId: input.tenantId,
        policyId: input.policyId,
        version: input.version,
        jurisdiction: input.jurisdiction,
        rules: input.rules,
        effectiveAt: input.effectiveAt
      }),
      createdAt: nowIso()
    };

    const idx = store.policies.findIndex(
      (item) =>
        item.tenantId === input.tenantId &&
        item.policyId === input.policyId &&
        item.version === input.version
    );
    if (idx >= 0) store.policies[idx] = record;
    else store.policies.unshift(record);

    await writeStore(store);
    return record;
  }

  async list(tenantId: string, policyId: number): Promise<PolicyVersion[]> {
    const store = await readStore();
    return store.policies
      .filter((item) => item.tenantId === tenantId && item.policyId === policyId)
      .sort((a, b) => b.version - a.version);
  }

  async resolveActive(tenantId: string, policyId: number, asOfIso: string): Promise<PolicyVersion | null> {
    const versions = await this.list(tenantId, policyId);
    const asOf = new Date(asOfIso).getTime();
    const active = versions.filter(
      (item) => item.status === 'active' && new Date(item.effectiveAt).getTime() <= asOf
    );
    return active.length > 0 ? active[0] : null;
  }
}

class PostgresPolicyRepository implements PolicyRepository {
  private pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tap_policies (
        tenant_id TEXT NOT NULL,
        policy_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        jurisdiction TEXT NOT NULL,
        rules JSONB NOT NULL,
        effective_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tenant_id, policy_id, version)
      )
    `);
  }

  async upsert(input: UpsertPolicyRequest): Promise<PolicyVersion> {
    await this.init();
    const record: PolicyVersion = {
      tenantId: input.tenantId,
      policyId: input.policyId,
      version: input.version,
      jurisdiction: input.jurisdiction,
      rules: input.rules,
      effectiveAt: input.effectiveAt,
      status: input.status,
      policyHash: hashPolicy({
        tenantId: input.tenantId,
        policyId: input.policyId,
        version: input.version,
        jurisdiction: input.jurisdiction,
        rules: input.rules,
        effectiveAt: input.effectiveAt
      }),
      createdAt: nowIso()
    };

    await this.pool.query(
      `
        INSERT INTO tap_policies
        (tenant_id, policy_id, version, jurisdiction, rules, effective_at, status, policy_hash, created_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
        ON CONFLICT (tenant_id, policy_id, version)
        DO UPDATE SET
          jurisdiction = EXCLUDED.jurisdiction,
          rules = EXCLUDED.rules,
          effective_at = EXCLUDED.effective_at,
          status = EXCLUDED.status,
          policy_hash = EXCLUDED.policy_hash,
          created_at = EXCLUDED.created_at
      `,
      [
        record.tenantId,
        record.policyId,
        record.version,
        record.jurisdiction,
        JSON.stringify(record.rules),
        record.effectiveAt,
        record.status,
        record.policyHash,
        record.createdAt
      ]
    );
    return record;
  }

  async list(tenantId: string, policyId: number): Promise<PolicyVersion[]> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_policies WHERE tenant_id = $1 AND policy_id = $2 ORDER BY version DESC`,
      [tenantId, policyId]
    );
    return rows.map((r: any) => ({
      tenantId: r.tenant_id,
      policyId: r.policy_id,
      version: r.version,
      jurisdiction: r.jurisdiction,
      rules: r.rules || {},
      effectiveAt: new Date(r.effective_at).toISOString(),
      status: r.status,
      policyHash: r.policy_hash,
      createdAt: new Date(r.created_at).toISOString()
    }));
  }

  async resolveActive(tenantId: string, policyId: number, asOfIso: string): Promise<PolicyVersion | null> {
    await this.init();
    const { rows } = await this.pool.query(
      `
        SELECT * FROM tap_policies
        WHERE tenant_id = $1
          AND policy_id = $2
          AND status = 'active'
          AND effective_at <= $3
        ORDER BY version DESC
        LIMIT 1
      `,
      [tenantId, policyId, asOfIso]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      tenantId: r.tenant_id,
      policyId: r.policy_id,
      version: r.version,
      jurisdiction: r.jurisdiction,
      rules: r.rules || {},
      effectiveAt: new Date(r.effective_at).toISOString(),
      status: r.status,
      policyHash: r.policy_hash,
      createdAt: new Date(r.created_at).toISOString()
    };
  }
}

let repo: PolicyRepository | null = null;

async function resolveRepository(): Promise<PolicyRepository> {
  if (repo) return repo;
  const dbUrl = process.env.TAP_DATABASE_URL;
  if (!dbUrl) {
    repo = new FilePolicyRepository();
    return repo;
  }

  try {
    const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const pg = await importer('pg');
    const pool = new pg.Pool({ connectionString: dbUrl });
    repo = new PostgresPolicyRepository(pool);
    return repo;
  } catch (error) {
    throw new Error(
      `TAP_DATABASE_URL is set but Postgres driver is unavailable. Install 'pg' or unset TAP_DATABASE_URL. ${String(error)}`
    );
  }
}

export async function upsertPolicyVersion(input: UpsertPolicyRequest): Promise<PolicyVersion> {
  return (await resolveRepository()).upsert(input);
}

export async function listPolicyVersions(tenantId: string, policyId: number): Promise<PolicyVersion[]> {
  return (await resolveRepository()).list(tenantId, policyId);
}

export async function resolveActivePolicy(
  tenantId: string,
  policyId: number,
  asOfIso = nowIso()
): Promise<PolicyVersion | null> {
  return (await resolveRepository()).resolveActive(tenantId, policyId, asOfIso);
}
