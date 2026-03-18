import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  RecordSettlementRequest,
  RecordSettlementResponse,
  ProofEnvelope
} from '@tap/shared-types';

export type SettlementRecord = RecordSettlementResponse & {
  operation: RecordSettlementRequest['operation'];
  subjectCommitment: string;
  metadata?: Record<string, unknown>;
  proof: ProofEnvelope;
};

export interface SettlementFinalityUpdate {
  settlementId?: string;
  proofHash?: string;
  status: RecordSettlementResponse['status'];
  anchored?: boolean;
  txHash?: string;
  eventId?: string;
  confirmationSource?: string;
}

interface SettlementStore {
  upsertByProofHash(
    request: RecordSettlementRequest,
    initial: {
      status: RecordSettlementResponse['status'];
      anchored: boolean;
      txHash?: string;
      eventId?: string;
      confirmationSource?: string;
    }
  ): Promise<RecordSettlementResponse>;
  insert(request: RecordSettlementRequest, verifiedLocal: boolean): Promise<RecordSettlementResponse>;
  applyFinality(update: SettlementFinalityUpdate): Promise<SettlementRecord | null>;
  getByProofHash(proofHash: string): Promise<SettlementRecord | null>;
  getById(id: string): Promise<SettlementRecord | null>;
  listRecent(limit: number): Promise<SettlementRecord[]>;
  reset(): Promise<void>;
}

interface SettlementStoreFile {
  records: SettlementRecord[];
}

function nowIso() {
  return new Date().toISOString();
}

function randomHex(size = 16) {
  return crypto.randomBytes(size).toString('hex');
}

function dataDir() {
  return process.env.TAP_DATA_DIR || path.join(process.cwd(), 'output');
}

function settlementFile() {
  return path.join(dataDir(), 'settlements.json');
}

function parseString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseIntValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function extractPolicyIndex(metadata?: Record<string, unknown>) {
  return {
    tenantId: parseString(metadata?.tenantId),
    policyId: parseIntValue(metadata?.policyId),
    policyVersion: parseIntValue(metadata?.policyVersion),
    policySnapshotHash: parseString(metadata?.policySnapshotHash)
  };
}

function recordFrom(
  response: RecordSettlementResponse,
  request: RecordSettlementRequest
): SettlementRecord {
  return {
    ...response,
    operation: request.operation,
    subjectCommitment: request.subjectCommitment,
    metadata: request.metadata,
    proof: request.proof
  };
}

async function ensureStore() {
  await fs.mkdir(dataDir(), { recursive: true });
  try {
    await fs.access(settlementFile());
  } catch {
    await fs.writeFile(settlementFile(), JSON.stringify({ records: [] }, null, 2), 'utf8');
  }
}

async function readStore(): Promise<SettlementStoreFile> {
  await ensureStore();
  const raw = await fs.readFile(settlementFile(), 'utf8');
  return JSON.parse(raw) as SettlementStoreFile;
}

async function writeStore(store: SettlementStoreFile) {
  await fs.writeFile(settlementFile(), JSON.stringify(store, null, 2), 'utf8');
}

class FileSettlementStore implements SettlementStore {
  async insert(request: RecordSettlementRequest, verifiedLocal: boolean): Promise<RecordSettlementResponse> {
    const createdAt = nowIso();
    const settlementId = `set_${Date.now()}_${randomHex(4)}`;
    const txHash = `0x${randomHex(32)}`;
    const eventId = `evt_${Date.now()}_${randomHex(3)}`;

    const response: RecordSettlementResponse = {
      settlementId,
      status: verifiedLocal ? 'recorded' : 'rejected',
      anchored: verifiedLocal,
      txHash,
      proofHash: request.proof.proofHash,
      eventId,
      createdAt,
      finalizedAt: verifiedLocal ? createdAt : undefined,
      confirmationSource: verifiedLocal ? 'local_verifier' : undefined
    };

    const store = await readStore();
    store.records.unshift(recordFrom(response, request));
    await writeStore(store);
    return response;
  }

  async upsertByProofHash(
    request: RecordSettlementRequest,
    initial: {
      status: RecordSettlementResponse['status'];
      anchored: boolean;
      txHash?: string;
      eventId?: string;
      confirmationSource?: string;
    }
  ): Promise<RecordSettlementResponse> {
    const store = await readStore();
    const existing = store.records.find((record) => record.proofHash === request.proof.proofHash);
    const createdAt = nowIso();
    if (existing) {
      existing.status = initial.status;
      existing.anchored = initial.anchored;
      existing.txHash = initial.txHash || existing.txHash;
      existing.eventId = initial.eventId || existing.eventId;
      existing.confirmationSource = initial.confirmationSource || existing.confirmationSource;
      if (initial.status === 'confirmed' || initial.status === 'recorded') existing.finalizedAt = createdAt;
      existing.metadata = { ...(existing.metadata || {}), ...(request.metadata || {}) };
      await writeStore(store);
      return {
        settlementId: existing.settlementId,
        status: existing.status,
        anchored: existing.anchored,
        txHash: existing.txHash,
        proofHash: existing.proofHash,
        eventId: existing.eventId,
        createdAt: existing.createdAt,
        finalizedAt: existing.finalizedAt,
        confirmationSource: existing.confirmationSource
      };
    }

    const settlementId = `set_${Date.now()}_${randomHex(4)}`;
    const txHash = initial.txHash || `0x${randomHex(32)}`;
    const eventId = initial.eventId || `evt_${Date.now()}_${randomHex(3)}`;
    const response: RecordSettlementResponse = {
      settlementId,
      status: initial.status,
      anchored: initial.anchored,
      txHash,
      proofHash: request.proof.proofHash,
      eventId,
      createdAt,
      finalizedAt: initial.status === 'confirmed' || initial.status === 'recorded' ? createdAt : undefined,
      confirmationSource: initial.confirmationSource
    };
    store.records.unshift(recordFrom(response, request));
    await writeStore(store);
    return response;
  }

  async applyFinality(update: SettlementFinalityUpdate): Promise<SettlementRecord | null> {
    const store = await readStore();
    const target = store.records.find((record) =>
      update.settlementId ? record.settlementId === update.settlementId : record.proofHash === update.proofHash
    );
    if (!target) return null;

    target.status = update.status;
    if (typeof update.anchored === 'boolean') target.anchored = update.anchored;
    if (update.txHash) target.txHash = update.txHash;
    if (update.eventId) target.eventId = update.eventId;
    if (update.confirmationSource) target.confirmationSource = update.confirmationSource;
    if (update.status === 'confirmed' || update.status === 'recorded' || update.status === 'failed') {
      target.finalizedAt = nowIso();
    }

    await writeStore(store);
    return target;
  }

  async getByProofHash(proofHash: string): Promise<SettlementRecord | null> {
    const store = await readStore();
    return store.records.find((record) => record.proofHash === proofHash) || null;
  }

  async getById(id: string): Promise<SettlementRecord | null> {
    const store = await readStore();
    return store.records.find((record) => record.settlementId === id) || null;
  }

  async listRecent(limit: number): Promise<SettlementRecord[]> {
    const store = await readStore();
    return store.records.slice(0, limit);
  }

  async reset(): Promise<void> {
    await writeStore({ records: [] });
  }
}

class PostgresSettlementStore implements SettlementStore {
  constructor(private readonly pool: any) {}

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tap_settlements (
        settlement_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        anchored BOOLEAN NOT NULL,
        tx_hash TEXT NOT NULL,
        proof_hash TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        finalized_at TIMESTAMPTZ,
        confirmation_source TEXT,
        operation TEXT NOT NULL,
        subject_commitment TEXT NOT NULL,
        tenant_id TEXT,
        policy_id INTEGER,
        policy_version INTEGER,
        policy_snapshot_hash TEXT,
        metadata JSONB,
        proof JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS tap_settlements_created_at_idx ON tap_settlements (created_at DESC);
      CREATE INDEX IF NOT EXISTS tap_settlements_policy_idx ON tap_settlements (tenant_id, policy_id, policy_version, policy_snapshot_hash);
    `);
  }

  private mapRow(row: any): SettlementRecord {
    return {
      settlementId: row.settlement_id,
      status: row.status,
      anchored: row.anchored,
      txHash: row.tx_hash,
      proofHash: row.proof_hash,
      eventId: row.event_id,
      createdAt: new Date(row.created_at).toISOString(),
      finalizedAt: row.finalized_at ? new Date(row.finalized_at).toISOString() : undefined,
      confirmationSource: row.confirmation_source || undefined,
      operation: row.operation,
      subjectCommitment: row.subject_commitment,
      metadata: row.metadata || undefined,
      proof: row.proof
    };
  }

  private async insertRecord(record: SettlementRecord): Promise<void> {
    await this.init();
    const policyIndex = extractPolicyIndex(record.metadata);
    await this.pool.query(
      `
      INSERT INTO tap_settlements
      (
        settlement_id, status, anchored, tx_hash, proof_hash, event_id,
        created_at, finalized_at, confirmation_source, operation, subject_commitment,
        tenant_id, policy_id, policy_version, policy_snapshot_hash, metadata, proof
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)
      `,
      [
        record.settlementId,
        record.status,
        record.anchored,
        record.txHash,
        record.proofHash,
        record.eventId,
        record.createdAt,
        record.finalizedAt || null,
        record.confirmationSource || null,
        record.operation,
        record.subjectCommitment,
        policyIndex.tenantId,
        policyIndex.policyId,
        policyIndex.policyVersion,
        policyIndex.policySnapshotHash,
        JSON.stringify(record.metadata || {}),
        JSON.stringify(record.proof)
      ]
    );
  }

  async insert(request: RecordSettlementRequest, verifiedLocal: boolean): Promise<RecordSettlementResponse> {
    const createdAt = nowIso();
    const settlementId = `set_${Date.now()}_${randomHex(4)}`;
    const txHash = `0x${randomHex(32)}`;
    const eventId = `evt_${Date.now()}_${randomHex(3)}`;
    const response: RecordSettlementResponse = {
      settlementId,
      status: verifiedLocal ? 'recorded' : 'rejected',
      anchored: verifiedLocal,
      txHash,
      proofHash: request.proof.proofHash,
      eventId,
      createdAt,
      finalizedAt: verifiedLocal ? createdAt : undefined,
      confirmationSource: verifiedLocal ? 'local_verifier' : undefined
    };
    await this.insertRecord(recordFrom(response, request));
    return response;
  }

  async upsertByProofHash(
    request: RecordSettlementRequest,
    initial: {
      status: RecordSettlementResponse['status'];
      anchored: boolean;
      txHash?: string;
      eventId?: string;
      confirmationSource?: string;
    }
  ): Promise<RecordSettlementResponse> {
    await this.init();
    const existing = await this.getByProofHash(request.proof.proofHash);
    const now = nowIso();
    if (existing) {
      const nextStatus = initial.status;
      const nextAnchored = initial.anchored;
      const nextTxHash = initial.txHash || existing.txHash;
      const nextEventId = initial.eventId || existing.eventId;
      const nextConfirmationSource = initial.confirmationSource || existing.confirmationSource || null;
      const nextFinalizedAt =
        nextStatus === 'confirmed' || nextStatus === 'recorded' ? now : existing.finalizedAt || null;
      const mergedMetadata = { ...(existing.metadata || {}), ...(request.metadata || {}) };
      const policyIndex = extractPolicyIndex(mergedMetadata);

      await this.pool.query(
        `
        UPDATE tap_settlements
        SET
          status = $2,
          anchored = $3,
          tx_hash = $4,
          event_id = $5,
          confirmation_source = $6,
          finalized_at = $7,
          tenant_id = $8,
          policy_id = $9,
          policy_version = $10,
          policy_snapshot_hash = $11,
          metadata = $12::jsonb
        WHERE settlement_id = $1
        `,
        [
          existing.settlementId,
          nextStatus,
          nextAnchored,
          nextTxHash,
          nextEventId,
          nextConfirmationSource,
          nextFinalizedAt,
          policyIndex.tenantId,
          policyIndex.policyId,
          policyIndex.policyVersion,
          policyIndex.policySnapshotHash,
          JSON.stringify(mergedMetadata)
        ]
      );
      return {
        settlementId: existing.settlementId,
        status: nextStatus,
        anchored: nextAnchored,
        txHash: nextTxHash,
        proofHash: existing.proofHash,
        eventId: nextEventId,
        createdAt: existing.createdAt,
        finalizedAt: nextFinalizedAt || undefined,
        confirmationSource: nextConfirmationSource || undefined
      };
    }

    const createdAt = now;
    const settlementId = `set_${Date.now()}_${randomHex(4)}`;
    const txHash = initial.txHash || `0x${randomHex(32)}`;
    const eventId = initial.eventId || `evt_${Date.now()}_${randomHex(3)}`;
    const response: RecordSettlementResponse = {
      settlementId,
      status: initial.status,
      anchored: initial.anchored,
      txHash,
      proofHash: request.proof.proofHash,
      eventId,
      createdAt,
      finalizedAt: initial.status === 'confirmed' || initial.status === 'recorded' ? createdAt : undefined,
      confirmationSource: initial.confirmationSource
    };
    await this.insertRecord(recordFrom(response, request));
    return response;
  }

  async applyFinality(update: SettlementFinalityUpdate): Promise<SettlementRecord | null> {
    await this.init();
    const target = update.settlementId
      ? await this.getById(update.settlementId)
      : update.proofHash
        ? await this.getByProofHash(update.proofHash)
        : null;
    if (!target) return null;

    const nextStatus = update.status;
    const nextAnchored = typeof update.anchored === 'boolean' ? update.anchored : target.anchored;
    const nextTxHash = update.txHash || target.txHash;
    const nextEventId = update.eventId || target.eventId;
    const nextConfirmationSource = update.confirmationSource || target.confirmationSource || null;
    const nextFinalizedAt =
      nextStatus === 'confirmed' || nextStatus === 'recorded' || nextStatus === 'failed'
        ? nowIso()
        : target.finalizedAt || null;

    await this.pool.query(
      `
      UPDATE tap_settlements
      SET status = $2, anchored = $3, tx_hash = $4, event_id = $5, confirmation_source = $6, finalized_at = $7
      WHERE settlement_id = $1
      `,
      [target.settlementId, nextStatus, nextAnchored, nextTxHash, nextEventId, nextConfirmationSource, nextFinalizedAt]
    );

    return {
      ...target,
      status: nextStatus,
      anchored: nextAnchored,
      txHash: nextTxHash,
      eventId: nextEventId,
      confirmationSource: nextConfirmationSource || undefined,
      finalizedAt: nextFinalizedAt || undefined
    };
  }

  async getByProofHash(proofHash: string): Promise<SettlementRecord | null> {
    await this.init();
    const { rows } = await this.pool.query(`SELECT * FROM tap_settlements WHERE proof_hash = $1 LIMIT 1`, [proofHash]);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async getById(id: string): Promise<SettlementRecord | null> {
    await this.init();
    const { rows } = await this.pool.query(`SELECT * FROM tap_settlements WHERE settlement_id = $1 LIMIT 1`, [id]);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async listRecent(limit: number): Promise<SettlementRecord[]> {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT * FROM tap_settlements ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, limit)]
    );
    return rows.map((row: any) => this.mapRow(row));
  }

  async reset(): Promise<void> {
    await this.init();
    await this.pool.query(`TRUNCATE TABLE tap_settlements`);
  }
}

let storeInstance: SettlementStore | null = null;

async function settlementStore(): Promise<SettlementStore> {
  if (storeInstance) return storeInstance;
  const dbUrl = process.env.TAP_DATABASE_URL;
  if (!dbUrl) {
    storeInstance = new FileSettlementStore();
    return storeInstance;
  }
  try {
    const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const pg = await importer('pg');
    const pool = new pg.Pool({ connectionString: dbUrl });
    storeInstance = new PostgresSettlementStore(pool);
    return storeInstance;
  } catch (error) {
    throw new Error(
      `TAP_DATABASE_URL is set but Postgres driver is unavailable. Install 'pg' or unset TAP_DATABASE_URL. ${String(error)}`
    );
  }
}

export async function recordSettlement(
  request: RecordSettlementRequest,
  verifiedLocal: boolean
): Promise<RecordSettlementResponse> {
  return (await settlementStore()).insert(request, verifiedLocal);
}

export async function upsertSettlementByProofHash(
  request: RecordSettlementRequest,
  initial: {
    status: RecordSettlementResponse['status'];
    anchored: boolean;
    txHash?: string;
    eventId?: string;
    confirmationSource?: string;
  }
): Promise<RecordSettlementResponse> {
  return (await settlementStore()).upsertByProofHash(request, initial);
}

export async function applySettlementFinality(update: SettlementFinalityUpdate): Promise<SettlementRecord | null> {
  return (await settlementStore()).applyFinality(update);
}

export async function getSettlementByProofHash(proofHash: string): Promise<SettlementRecord | null> {
  return (await settlementStore()).getByProofHash(proofHash);
}

export async function getSettlementById(id: string): Promise<SettlementRecord | null> {
  return (await settlementStore()).getById(id);
}

export async function listRecentSettlements(limit = 50): Promise<SettlementRecord[]> {
  return (await settlementStore()).listRecent(limit);
}

export async function resetSettlementStore(): Promise<void> {
  await (await settlementStore()).reset();
}
