import { sha256Hex } from "../protocol/digest.js";
import { verifyJws } from "../protocol/authority-keys.js";

function assertJwsMatchesBody(jws, body, jwks, label) {
  const verified = verifyJws(jws, jwks);
  if (sha256Hex(verified.payload) !== sha256Hex(body)) {
    throw new Error(`${label} JWS payload does not match object body.`);
  }
  return verified;
}

export function verifyAgentPassport(passport, jwks) {
  const {
    passportId: _passportId,
    passportCommitment: _passportCommitment,
    authoritySignature: _authoritySignature,
    authorityJws,
    ...body
  } = passport;
  if (!authorityJws) throw new Error("agent passport missing authorityJws");
  return {
    ok: true,
    ...assertJwsMatchesBody(authorityJws, body, jwks, "agent passport")
  };
}

export function verifyApproval(approval, jwks) {
  const {
    approvalId: _approvalId,
    approvalHash: _approvalHash,
    authoritySignature: _authoritySignature,
    authorityJws,
    zekoAnchor: _zekoAnchor,
    ...body
  } = approval;
  if (!authorityJws) throw new Error("approval missing authorityJws");
  if (Date.parse(approval.expiresAt) <= Date.now()) throw new Error("approval expired");
  return {
    ok: true,
    ...assertJwsMatchesBody(authorityJws, body, jwks, "approval")
  };
}

export function verifyMissionBundle(bundle, jwks) {
  if (bundle.version !== "zk-mission-bundle-v1") {
    throw new Error("unsupported mission bundle version");
  }
  const { bundleHash: _bundleHash, ...body } = bundle;
  const expectedHash = sha256Hex(body);
  if (expectedHash !== bundle.bundleHash) {
    throw new Error("mission bundle hash mismatch");
  }
  if (bundle.agentPassport) verifyAgentPassport(bundle.agentPassport, jwks);
  if (bundle.approval) verifyApproval(bundle.approval, jwks);
  return { ok: true, bundleHash: bundle.bundleHash };
}
