import fs from "node:fs";
import path from "node:path";
import { isProductionProfile } from "./runtime.js";

const revokedAuthCommitments = new Map();
let loadedRevocationPath = null;

function durableRevocationsEnabled() {
  return isProductionProfile() || Boolean(process.env.REVOCATION_STATE_PATH);
}

function revocationStatePath() {
  return process.env.REVOCATION_STATE_PATH ??
    process.env.MISSION_REVOCATION_STATE_PATH ??
    path.join(process.cwd(), "data", "revocation-state.json");
}

function ensureRevocationsLoaded() {
  const key = durableRevocationsEnabled() ? revocationStatePath() : "memory";
  if (loadedRevocationPath === key) return;
  loadedRevocationPath = key;
  if (!durableRevocationsEnabled()) return;
  if (!fs.existsSync(key)) return;
  const state = JSON.parse(fs.readFileSync(key, "utf8"));
  revokedAuthCommitments.clear();
  for (const entry of state.revocations ?? []) {
    revokedAuthCommitments.set(entry.authCommitment, entry);
  }
}

function persistRevocations() {
  if (!durableRevocationsEnabled()) return;
  const file = revocationStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: "revocation-state-v1",
    savedAt: new Date().toISOString(),
    revocations: Array.from(revokedAuthCommitments.values())
  }, null, 2));
}

export function revokeAuthCommitment(authCommitment, reason = "revoked") {
  ensureRevocationsLoaded();
  revokedAuthCommitments.set(authCommitment, {
    authCommitment,
    reason,
    revokedAt: new Date().toISOString()
  });
  persistRevocations();
  return revokedAuthCommitments.get(authCommitment);
}

export function isAuthCommitmentRevoked(authCommitment) {
  ensureRevocationsLoaded();
  return revokedAuthCommitments.has(authCommitment);
}

export function listRevocations() {
  ensureRevocationsLoaded();
  return Array.from(revokedAuthCommitments.values());
}
