import path from 'node:path';
import { promises as fs } from 'node:fs';

export type IssuerRequestKind = 'mint' | 'burn' | 'issue' | 'allocate' | 'restrict' | 'redeem';

export interface IssuerApproval {
  checkerKeyId: string;
  checkerRole: string;
  approvedAt: string;
  reasonCode?: string;
  note?: string;
  policySnapshotHash?: string;
  policyEffectiveAt?: string;
  policyVersion?: number;
}

export interface IssuerRequestRecord {
  requestId: string;
  kind: IssuerRequestKind;
  tenantId?: string;
  policyId?: number;
  payload: Record<string, unknown>;
  status: 'requested' | 'approved' | 'rejected' | 'settled';
  makerKeyId: string;
  makerRole: string;
  createdAt: string;
  updatedAt: string;
  approvals?: IssuerApproval[];
  approval?: IssuerApproval;
  rejection?: { checkerKeyId: string; checkerRole: string; rejectedAt: string; reasonCode?: string; note?: string };
}

export interface IssuerControlConfig {
  tenantId: string;
  approvalExpiryMinutes: number;
  dualApprovalThresholdCents: string;
  requireReasonCode: boolean;
  allowedReasonCodes: string[];
  updatedAt: string;
}

interface IssuerStoreStateFile {
  requests: IssuerRequestRecord[];
  controls: IssuerControlConfig[];
}

interface IssuerStore {
  upsertRequest(record: IssuerRequestRecord): Promise<IssuerRequestRecord>;
  getRequest(kind: IssuerRequestKind, requestId: string): Promise<IssuerRequestRecord | null>;
  listRequests(filters?: {
    tenantId?: string;
    kind?: IssuerRequestKind;
    status?: IssuerRequestRecord['status'];
  }): Promise<IssuerRequestRecord[]>;
  upsertControl(config: IssuerControlConfig): Promise<IssuerControlConfig>;
  getControl(tenantId: string): Promise<IssuerControlConfig | null>;
  reset(): Promise<void>;
}

function dataDir() {
  return process.env.TAP_DATA_DIR || path.join(process.cwd(), 'output');
}

function stateFilePath() {
  return path.join(dataDir(), 'issuer-workflows.json');
}

async function ensureStateFile() {
  await fs.mkdir(dataDir(), { recursive: true });
  try {
    await fs.access(stateFilePath());
  } catch {
    const initial: IssuerStoreStateFile = { requests: [], controls: [] };
    await fs.writeFile(stateFilePath(), JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function readStateFile(): Promise<IssuerStoreStateFile> {
  await ensureStateFile();
  const raw = await fs.readFile(stateFilePath(), 'utf8');
  return JSON.parse(raw) as IssuerStoreStateFile;
}

async function writeStateFile(state: IssuerStoreStateFile): Promise<void> {
  await fs.writeFile(stateFilePath(), JSON.stringify(state, null, 2), 'utf8');
}

class FileIssuerStore implements IssuerStore {
  async upsertRequest(record: IssuerRequestRecord): Promise<IssuerRequestRecord> {
    const state = await readStateFile();
    const idx = state.requests.findIndex((v) => v.requestId === record.requestId && v.kind === record.kind);
    if (idx >= 0) state.requests[idx] = record;
    else state.requests.unshift(record);
    await writeStateFile(state);
    return record;
  }

  async getRequest(kind: IssuerRequestKind, requestId: string): Promise<IssuerRequestRecord | null> {
    const state = await readStateFile();
    return state.requests.find((v) => v.kind === kind && v.requestId === requestId) || null;
  }

  async listRequests(filters?: {
    tenantId?: string;
    kind?: IssuerRequestKind;
    status?: IssuerRequestRecord['status'];
  }): Promise<IssuerRequestRecord[]> {
    const state = await readStateFile();
    return state.requests.filter((v) => {
      if (filters?.tenantId && v.tenantId !== filters.tenantId) return false;
      if (filters?.kind && v.kind !== filters.kind) return false;
      if (filters?.status && v.status !== filters.status) return false;
      return true;
    });
  }

  async upsertControl(config: IssuerControlConfig): Promise<IssuerControlConfig> {
    const state = await readStateFile();
    const idx = state.controls.findIndex((v) => v.tenantId === config.tenantId);
    if (idx >= 0) state.controls[idx] = config;
    else state.controls.unshift(config);
    await writeStateFile(state);
    return config;
  }

  async getControl(tenantId: string): Promise<IssuerControlConfig | null> {
    const state = await readStateFile();
    return state.controls.find((v) => v.tenantId === tenantId) || null;
  }

  async reset(): Promise<void> {
    await writeStateFile({ requests: [], controls: [] });
  }
}

class PostgresIssuerStore implements IssuerStore {
  constructor(private readonly pool: any) {}

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tap_issuer_requests (
        request_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        tenant_id TEXT,
        policy_id INTEGER,
        payload JSONB NOT NULL,
        status TEXT NOT NULL,
        maker_key_id TEXT NOT NULL,
        maker_role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        approvals JSONB,
        approval JSONB,
        rejection JSONB
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS tap_issuer_requests_tenant_idx
      ON tap_issuer_requests (tenant_id, kind, status, updated_at DESC)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tap_issuer_controls (
        tenant_id TEXT PRIMARY KEY,
        approval_expiry_minutes INTEGER NOT NULL,
        dual_approval_threshold_cents TEXT NOT NULL,
        require_reason_code BOOLEAN NOT NULL,
        allowed_reason_codes JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
  }

  private mapRequest(row: any): IssuerRequestRecord {
    return {
      requestId: row.request_id,
      kind: row.kind,
      tenantId: row.tenant_id || undefined,
      policyId: Number.isFinite(row.policy_id) ? row.policy_id : undefined,
      payload: row.payload || {},
      status: row.status,
      makerKeyId: row.maker_key_id,
      makerRole: row.maker_role,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      approvals: row.approvals || undefined,
      approval: row.approval || undefined,
      rejection: row.rejection || undefined
    };
  }

  async upsertRequest(record: IssuerRequestRecord): Promise<IssuerRequestRecord> {
    await this.init();
    await this.pool.query(
      `
      INSERT INTO tap_issuer_requests
      (
        request_id, kind, tenant_id, policy_id, payload, status, maker_key_id, maker_role,
        created_at, updated_at, approvals, approval, rejection
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
      ON CONFLICT (request_id) DO UPDATE SET
        kind = EXCLUDED.kind,
        tenant_id = EXCLUDED.tenant_id,
        policy_id = EXCLUDED.policy_id,
        payload = EXCLUDED.payload,
        status = EXCLUDED.status,
        maker_key_id = EXCLUDED.maker_key_id,
        maker_role = EXCLUDED.maker_role,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        approvals = EXCLUDED.approvals,
        approval = EXCLUDED.approval,
        rejection = EXCLUDED.rejection
      `,
      [
        record.requestId,
        record.kind,
        record.tenantId || null,
        record.policyId ?? null,
        JSON.stringify(record.payload || {}),
        record.status,
        record.makerKeyId,
        record.makerRole,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record.approvals || null),
        JSON.stringify(record.approval || null),
        JSON.stringify(record.rejection || null)
      ]
    );
    return record;
  }

  async getRequest(kind: IssuerRequestKind, requestId: string): Promise<IssuerRequestRecord | null> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_issuer_requests WHERE request_id = $1 AND kind = $2 LIMIT 1`,
      [requestId, kind]
    );
    if (rows.length === 0) return null;
    return this.mapRequest(rows[0]);
  }

  async listRequests(filters?: {
    tenantId?: string;
    kind?: IssuerRequestKind;
    status?: IssuerRequestRecord['status'];
  }): Promise<IssuerRequestRecord[]> {
    await this.init();
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filters?.tenantId) {
      clauses.push(`tenant_id = $${values.length + 1}`);
      values.push(filters.tenantId);
    }
    if (filters?.kind) {
      clauses.push(`kind = $${values.length + 1}`);
      values.push(filters.kind);
    }
    if (filters?.status) {
      clauses.push(`status = $${values.length + 1}`);
      values.push(filters.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_issuer_requests ${where} ORDER BY updated_at DESC`,
      values
    );
    return rows.map((row: any) => this.mapRequest(row));
  }

  async upsertControl(config: IssuerControlConfig): Promise<IssuerControlConfig> {
    await this.init();
    await this.pool.query(
      `
      INSERT INTO tap_issuer_controls
      (tenant_id, approval_expiry_minutes, dual_approval_threshold_cents, require_reason_code, allowed_reason_codes, updated_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (tenant_id) DO UPDATE SET
        approval_expiry_minutes = EXCLUDED.approval_expiry_minutes,
        dual_approval_threshold_cents = EXCLUDED.dual_approval_threshold_cents,
        require_reason_code = EXCLUDED.require_reason_code,
        allowed_reason_codes = EXCLUDED.allowed_reason_codes,
        updated_at = EXCLUDED.updated_at
      `,
      [
        config.tenantId,
        config.approvalExpiryMinutes,
        config.dualApprovalThresholdCents,
        config.requireReasonCode,
        JSON.stringify(config.allowedReasonCodes || []),
        config.updatedAt
      ]
    );
    return config;
  }

  async getControl(tenantId: string): Promise<IssuerControlConfig | null> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_issuer_controls WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      tenantId: row.tenant_id,
      approvalExpiryMinutes: row.approval_expiry_minutes,
      dualApprovalThresholdCents: row.dual_approval_threshold_cents,
      requireReasonCode: row.require_reason_code,
      allowedReasonCodes: row.allowed_reason_codes || [],
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async reset(): Promise<void> {
    await this.init();
    await this.pool.query(`TRUNCATE TABLE tap_issuer_requests, tap_issuer_controls`);
  }
}

let issuerStoreInstance: IssuerStore | null = null;

async function issuerStore(): Promise<IssuerStore> {
  if (issuerStoreInstance) return issuerStoreInstance;
  const dbUrl = process.env.TAP_DATABASE_URL;
  if (!dbUrl) {
    issuerStoreInstance = new FileIssuerStore();
    return issuerStoreInstance;
  }
  try {
    const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const pg = await importer('pg');
    const pool = new pg.Pool({ connectionString: dbUrl });
    issuerStoreInstance = new PostgresIssuerStore(pool);
    return issuerStoreInstance;
  } catch (error) {
    throw new Error(
      `TAP_DATABASE_URL is set but Postgres driver is unavailable. Install 'pg' or unset TAP_DATABASE_URL. ${String(error)}`
    );
  }
}

export async function upsertIssuerRequest(record: IssuerRequestRecord): Promise<IssuerRequestRecord> {
  return (await issuerStore()).upsertRequest(record);
}

export async function getIssuerRequest(
  kind: IssuerRequestKind,
  requestId: string
): Promise<IssuerRequestRecord | null> {
  return (await issuerStore()).getRequest(kind, requestId);
}

export async function listIssuerRequests(filters?: {
  tenantId?: string;
  kind?: IssuerRequestKind;
  status?: IssuerRequestRecord['status'];
}): Promise<IssuerRequestRecord[]> {
  return (await issuerStore()).listRequests(filters);
}

export async function upsertIssuerControl(config: IssuerControlConfig): Promise<IssuerControlConfig> {
  return (await issuerStore()).upsertControl(config);
}

export async function getIssuerControl(tenantId: string): Promise<IssuerControlConfig | null> {
  return (await issuerStore()).getControl(tenantId);
}

export async function resetIssuerStore(): Promise<void> {
  await (await issuerStore()).reset();
}
