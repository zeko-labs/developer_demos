const revokedAuthCommitments = new Map();

export function revokeAuthCommitment(authCommitment, reason = "revoked") {
  revokedAuthCommitments.set(authCommitment, {
    authCommitment,
    reason,
    revokedAt: new Date().toISOString()
  });
  return revokedAuthCommitments.get(authCommitment);
}

export function isAuthCommitmentRevoked(authCommitment) {
  return revokedAuthCommitments.has(authCommitment);
}

export function listRevocations() {
  return Array.from(revokedAuthCommitments.values());
}
