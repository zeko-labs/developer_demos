import { createDecipheriv, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Field, MerkleMap } from 'o1js';
import { hashHexToField, hashStringToField, readOptionalEnv } from './utils.js';

export type EngineStateNote = {
  noteHash: string;
  asset: string;
  amount: number;
  createdAtUnixMs: number;
  spentAtUnixMs: number | null;
  ownerAccountId: string;
};

export type EngineStateSequencingReceipt = {
  orderId: string;
  participant: string;
  commitment: string;
  pair: string;
  side: string;
  sequenceNumber: number;
  operatorPublicKey: string;
  timestampBucketUnixMs: number;
  issuedAtUnixMs: number;
  signature: string;
  algorithm: string;
  receiptHash: string;
};

export type EngineStateSnapshot = {
  notes: EngineStateNote[];
  spentNullifiers: string[];
  sequencingReceipts: Array<[string, EngineStateSequencingReceipt]>;
};

function deriveSymmetricKey(raw: string) {
  if (!raw) return null;
  return createHash('sha256').update(String(raw), 'utf8').digest();
}

function decryptJson(value: any, rawKey: string) {
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

export async function loadEngineStateSnapshot(): Promise<EngineStateSnapshot> {
  const engineStatePath = readOptionalEnv(
    'ENGINE_STATE_FILE',
    path.resolve(process.cwd(), 'data', 'engine-state.json')
  );
  const raw = JSON.parse(await readFile(engineStatePath, 'utf8'));
  const decrypted = decryptJson(raw, process.env.ORDER_STATE_ENCRYPTION_KEY || '') || {};
  return {
    notes: Array.isArray(decrypted.notes) ? decrypted.notes : [],
    spentNullifiers: Array.isArray(decrypted.spentNullifiers) ? decrypted.spentNullifiers : [],
    sequencingReceipts: Array.isArray(decrypted.sequencingReceipts) ? decrypted.sequencingReceipts : []
  };
}

export function noteLeaf(note: EngineStateNote): Field {
  return hashStringToField(
    [
      String(note.noteHash || ''),
      String(note.ownerAccountId || ''),
      String(note.asset || '').toUpperCase(),
      Number(note.amount || 0).toFixed(9),
      String(note.createdAtUnixMs || 0)
    ].join('|')
  );
}

export function sequencingReceiptLeaf(receipt: EngineStateSequencingReceipt): Field {
  return hashStringToField(
    [
      String(receipt.receiptHash || ''),
      String(receipt.commitment || ''),
      String(receipt.participant || ''),
      String(receipt.pair || ''),
      String(receipt.side || ''),
      String(receipt.sequenceNumber || 0),
      String(receipt.timestampBucketUnixMs || 0)
    ].join('|')
  );
}

export function buildMap(entries: Array<{ key: Field; value: Field }>) {
  const map = new MerkleMap();
  for (const entry of entries) {
    map.set(entry.key, entry.value);
  }
  return map;
}

export async function buildPrivateStateMerkleSnapshot() {
  const state = await loadEngineStateSnapshot();
  const activeNotes = state.notes
    .filter((note) => note && typeof note.noteHash === 'string' && note.noteHash.trim() && note.spentAtUnixMs === null)
    .sort((a, b) => String(a.noteHash).localeCompare(String(b.noteHash)));
  const nullifiers = state.spentNullifiers
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .sort();
  const sequencingReceipts = state.sequencingReceipts
    .filter((entry) => Array.isArray(entry) && entry.length >= 2 && entry[1] && typeof entry[1] === 'object')
    .map((entry) => entry[1] as EngineStateSequencingReceipt)
    .filter((receipt) => typeof receipt.receiptHash === 'string' && receipt.receiptHash.trim())
    .sort((a, b) => String(a.receiptHash).localeCompare(String(b.receiptHash)));

  const noteMap = buildMap(
    activeNotes.map((note) => ({
      key: hashHexToField(String(note.noteHash)),
      value: noteLeaf(note)
    }))
  );
  const nullifierMap = buildMap(
    nullifiers.map((nullifier) => ({
      key: hashHexToField(String(nullifier)),
      value: Field(1)
    }))
  );
  const sequencingMap = buildMap(
    sequencingReceipts.map((receipt) => ({
      key: hashHexToField(String(receipt.receiptHash)),
      value: sequencingReceiptLeaf(receipt)
    }))
  );

  return {
    ok: true,
    counts: {
      activeNotes: activeNotes.length,
      spentNullifiers: nullifiers.length,
      sequencingReceipts: sequencingReceipts.length
    },
    roots: {
      noteMerkleRoot: noteMap.getRoot().toString(),
      nullifierMerkleRoot: nullifierMap.getRoot().toString(),
      sequencingMerkleRoot: sequencingMap.getRoot().toString()
    },
    samples: {
      activeNoteHash: activeNotes[0]?.noteHash || null,
      spentNullifier: nullifiers[0] || null,
      sequencingReceiptHash: sequencingReceipts[0]?.receiptHash || null
    }
  };
}
