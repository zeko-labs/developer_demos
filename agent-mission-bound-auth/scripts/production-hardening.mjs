import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { buildAgentPassport, proposeMission, approveMission, enforceCheckpoint } from "../packages/protocol/missions.js";
import { buildAuthCommitment, normalizeOAuthClaims, verifyJwtWithJwks } from "../packages/protocol/oauth-production.js";
import { verifyPayment } from "../packages/protocol/x402.js";
import { sha256Hex } from "../packages/protocol/digest.js";

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signRsJwt(payload, privateKey, kid = "jwt-test") {
  const header = { typ: "JWT", alg: "RS256", kid };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

const previousEnv = { ...process.env };

try {
  process.env.MISSION_AUTH_PROFILE = "production";
  delete process.env.ZK_OAUTH_ISSUER_SECRET;
  assert.throws(
    () => buildAuthCommitment({ scopes: [], subject: "sub" }, "salt"),
    /ZK_OAUTH_ISSUER_SECRET/
  );

  process.env.ZK_OAUTH_ISSUER_SECRET = "production-test-issuer-secret";
  const authorityKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.MISSION_AUTHORITY_PRIVATE_JWK = JSON.stringify(authorityKeys.privateKey.export({ format: "jwk" }));

  const jwtKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = {
    ...jwtKeys.publicKey.export({ format: "jwk" }),
    kid: "jwt-test",
    alg: "RS256",
    use: "sig"
  };
  const now = Math.floor(Date.now() / 1000);
  const jwt = signRsJwt({
    iss: "https://issuer.example/",
    sub: "subject-123",
    aud: "client-123",
    scope: "compute:clinical dataset:clinical-failures-q1 rail:zeko",
    exp: now + 600,
    iat: now,
    nonce: "nonce-123"
  }, jwtKeys.privateKey);
  const claims = await verifyJwtWithJwks(jwt, {
    issuer: "https://issuer.example/",
    audience: "client-123",
    jwks: { keys: [publicJwk] }
  });
  assert.equal(claims.sub, "subject-123");

  const missingExpJwt = signRsJwt({
    iss: "https://issuer.example/",
    sub: "subject-123",
    aud: "client-123"
  }, jwtKeys.privateKey);
  await assert.rejects(
    () => verifyJwtWithJwks(missingExpJwt, {
      issuer: "https://issuer.example/",
      audience: "client-123",
      jwks: { keys: [publicJwk] }
    }),
    /exp is required/
  );

  process.env.AGENT_MAPPINGS_JSON = JSON.stringify([
    {
      subjectKey: "auth0:https://issuer.example/:subject-123",
      agentId: "agent-mapped-123",
      represents: { type: "organization", id: "Mapped Org" }
    }
  ]);
  const normalized = normalizeOAuthClaims(claims, "auth0");
  assert.equal(normalized.agentId, "agent-mapped-123");
  assert.equal(normalized.subjectKey, "auth0:https://issuer.example/:subject-123");

  const passport = buildAgentPassport({ agentId: normalized.agentId, organization: "Mapped Org" });
  const mission = proposeMission({
    agentId: passport.agentId,
    datasetId: "clinical-failures-q1",
    operation: "risk-summary",
    task: "production hardening check",
    allowedTools: ["private_compute.run", "x402.settle"],
    allowedScopes: ["compute:clinical", "dataset:clinical-failures-q1"],
    allowedRails: ["zeko"],
    maxSpendUsd: "1.00"
  });
  const approval = approveMission({
    missionId: mission.missionId,
    approverId: "policy@example.com",
    issuer: "policy-engine"
  });

  const missingExecution = enforceCheckpoint({
    checkpoint: "before_private_compute",
    approval,
    context: {
      agentId: passport.agentId,
      datasetId: mission.datasetId,
      operation: mission.operation,
      action: "private_compute.run",
      railId: "zeko"
    }
  });
  assert.equal(missingExecution.ok, false);
  assert.match(missingExecution.reason, /missionExecutionId/);

  const first = enforceCheckpoint({
    checkpoint: "before_private_compute",
    approval,
    context: {
      missionExecutionId: "exec-1",
      idempotencyKey: "compute-1",
      agentId: passport.agentId,
      datasetId: mission.datasetId,
      operation: mission.operation,
      action: "private_compute.run",
      railId: "zeko",
      spendUsd: "0.40"
    }
  });
  assert.equal(first.ok, true);

  const replay = enforceCheckpoint({
    checkpoint: "before_private_compute",
    approval,
    context: {
      missionExecutionId: "exec-1",
      idempotencyKey: "compute-1",
      agentId: passport.agentId,
      datasetId: mission.datasetId,
      operation: mission.operation,
      action: "private_compute.run",
      railId: "zeko",
      spendUsd: "0.40"
    }
  });
  assert.equal(replay.ok, false);
  assert.match(replay.reason, /Replay detected/);

  const budget = enforceCheckpoint({
    checkpoint: "before_private_compute",
    approval,
    context: {
      missionExecutionId: "exec-2",
      idempotencyKey: "compute-2",
      agentId: passport.agentId,
      datasetId: mission.datasetId,
      operation: mission.operation,
      action: "private_compute.run",
      railId: "zeko",
      spendUsd: "0.70"
    }
  });
  assert.equal(budget.ok, false);
  assert.match(budget.reason, /budget exceeded/i);

  const mockPayment = {
    requestId: "req-1",
    railId: "zeko",
    settlementRail: "zeko",
    networkId: "zeko:testnet",
    amount: "0.1",
    payTo: "B62test",
    expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    authorization: { mode: "mock-facilitator" }
  };
  mockPayment.authorizationDigest = sha256Hex(mockPayment);
  const paymentCheck = verifyPayment({
    requestId: "req-1",
    accepts: [{
      railId: "zeko",
      settlementRail: "zeko",
      network: "zeko:testnet",
      amount: "0.1",
      payTo: "B62test"
    }]
  }, mockPayment);
  assert.equal(paymentCheck.ok, false);
  assert.match(paymentCheck.reason, /Mock x402/);

  console.log(JSON.stringify({ ok: true, checks: ["strict-jwt", "agent-mapping", "production-keys", "replay-budget", "settlement-proof"] }, null, 2));
} finally {
  process.env = previousEnv;
}
