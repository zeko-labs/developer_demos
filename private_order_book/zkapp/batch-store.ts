import { readFile, writeFile } from 'node:fs/promises';

export type StoredSettlementBatch = {
  batchId: number;
  batchType?: string;
  batchHash: string;
  bookRootHash?: string | null;
  noteRootHash?: string | null;
  nullifierRootHash?: string | null;
  sequencingRootHash?: string | null;
  privateStateTransitionHash?: string | null;
  privateStateProofSubmission?: {
    submittedAtUnixMs: number;
    source?: string | null;
    batchHash?: string | null;
    proofTransitionHash?: string | null;
    artifactPath?: string | null;
  } | null;
  privateStateDelta?: {
    noteSpends?: Array<Record<string, any>>;
    noteOutputs?: Array<Record<string, any>>;
    sequencingReceipts?: Array<Record<string, any>>;
    eventCount?: number;
  } | null;
  tradeCount: number;
  status: 'pending' | 'committed';
  createdAtUnixMs: number;
  committedAtUnixMs: number | null;
  txHash: string | null;
};

export type SettlementBatchFile = {
  nextSettlementBatchId: number;
  batches: StoredSettlementBatch[];
};

export async function loadBatchFile(path: string): Promise<SettlementBatchFile> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as SettlementBatchFile;
    const batches = Array.isArray(parsed?.batches) ? parsed.batches : [];
    const nextSettlementBatchId = Number(parsed?.nextSettlementBatchId || 1);
    return {
      nextSettlementBatchId: Number.isFinite(nextSettlementBatchId) && nextSettlementBatchId > 0 ? nextSettlementBatchId : 1,
      batches
    };
  } catch {
    return {
      nextSettlementBatchId: 1,
      batches: []
    };
  }
}

export async function saveBatchFile(path: string, file: SettlementBatchFile): Promise<void> {
  await writeFile(path, JSON.stringify(file, null, 2), 'utf8');
}

export function getNextPending(file: SettlementBatchFile): StoredSettlementBatch | null {
  const pending = file.batches
    .filter((batch) => batch.status === 'pending')
    .sort((a, b) => a.batchId - b.batchId);
  return pending[0] || null;
}
