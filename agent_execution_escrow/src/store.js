import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_PATH = path.resolve(process.cwd(), 'data', 'state.json');

const defaultState = () => ({
  navaTransactions: [],
  anchorSubmissions: [],
  settlementRegistry: [],
  verifierChallenges: {}
});

function withDefaults(raw = {}) {
  raw.navaTransactions = raw.navaTransactions ?? [];
  raw.anchorSubmissions = raw.anchorSubmissions ?? [];
  raw.settlementRegistry = raw.settlementRegistry ?? [];
  raw.verifierChallenges = raw.verifierChallenges ?? {};
  return raw;
}

function safeReadState() {
  try {
    return withDefaults(JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')));
  } catch {
    return defaultState();
  }
}

let state = safeReadState();

function persistState() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
}

function nextId(prefix) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

persistState();

export function getPersistenceStatus() {
  return {
    driver: 'file',
    databaseConfigured: false,
    dataPath: DATA_PATH,
    ready: true,
    pendingWrites: 'sync'
  };
}

export function createNavaTransaction(entry) {
  const now = new Date().toISOString();
  const row = {
    id: nextId('navatx'),
    createdAt: now,
    updatedAt: now,
    ...entry
  };
  state.navaTransactions.push(row);
  persistState();
  return row;
}

export function getNavaTransaction(id) {
  return state.navaTransactions.find((row) => row.id === id) ?? null;
}

export function findNavaTransactionByRequestHash(requestHash) {
  return state.navaTransactions.find((row) => row.requestHash === requestHash) ?? null;
}

export function listNavaTransactions({ escrowAddress = null, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const normalizedEscrow = String(escrowAddress || '').trim().toLowerCase();
  return state.navaTransactions
    .filter((row) => {
      if (!normalizedEscrow) return true;
      return String(row.escrowAddress || '').trim().toLowerCase() === normalizedEscrow;
    })
    .slice(-safeLimit)
    .reverse();
}

export function updateNavaTransaction(id, patch) {
  const index = state.navaTransactions.findIndex((row) => row.id === id);
  if (index < 0) return null;
  state.navaTransactions[index] = {
    ...state.navaTransactions[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  persistState();
  return state.navaTransactions[index];
}

export function createAnchorSubmission(entry) {
  const now = new Date().toISOString();
  const row = {
    id: nextId('anchor'),
    createdAt: now,
    updatedAt: now,
    ...entry
  };
  state.anchorSubmissions.push(row);
  persistState();
  return row;
}

export function getAnchorSubmission(id) {
  return state.anchorSubmissions.find((row) => row.id === id) ?? null;
}

export function updateAnchorSubmission(id, patch) {
  const index = state.anchorSubmissions.findIndex((row) => row.id === id);
  if (index < 0) return null;
  state.anchorSubmissions[index] = {
    ...state.anchorSubmissions[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  persistState();
  return state.anchorSubmissions[index];
}

export function createSettlementRegistryEntry(entry) {
  const now = new Date().toISOString();
  const row = {
    id: nextId('zreg'),
    createdAt: now,
    updatedAt: now,
    ...entry
  };
  state.settlementRegistry.push(row);
  persistState();
  return row;
}

export function updateSettlementRegistryEntry(id, patch) {
  const index = state.settlementRegistry.findIndex((row) => row.id === id);
  if (index < 0) return null;
  state.settlementRegistry[index] = {
    ...state.settlementRegistry[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  persistState();
  return state.settlementRegistry[index];
}

export function listSettlementRegistryEntries(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return state.settlementRegistry.slice(-safeLimit).reverse();
}

export function getSettlementRegistryEntry(id) {
  return state.settlementRegistry.find((row) => row.id === id) ?? null;
}

export function createVerifierChallenge(entry) {
  const now = new Date().toISOString();
  const challengeId = entry.challengeId || nextId('vch');
  state.verifierChallenges[challengeId] = {
    id: challengeId,
    createdAt: now,
    ...entry
  };
  persistState();
  return state.verifierChallenges[challengeId];
}

export function getVerifierChallenge(challengeId) {
  return state.verifierChallenges[challengeId] ?? null;
}

export function consumeVerifierChallenge(challengeId, patch = {}) {
  const existing = state.verifierChallenges[challengeId];
  if (!existing) return null;
  state.verifierChallenges[challengeId] = {
    ...existing,
    ...patch,
    consumedAt: patch.consumedAt || new Date().toISOString()
  };
  persistState();
  return state.verifierChallenges[challengeId];
}
