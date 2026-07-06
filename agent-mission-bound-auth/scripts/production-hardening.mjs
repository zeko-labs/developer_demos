import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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

function signEsJws(payload, privateKey, kid = "facilitator-test") {
  const header = { typ: "x402-facilitator-receipt+jwt", alg: "ES256", kid };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

function requestJson({ port, path: requestPath, method = "GET", body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method,
      headers: body ? { "content-type": "application/json" } : {}
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const previousEnv = { ...process.env };
const previousFetch = globalThis.fetch;

try {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-auth-hardening-"));
  process.env.MISSION_AUTH_PROFILE = "production";
  process.env.DEMO_MODE = "false";
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1:0";
  process.env.MISSION_STATE_PATH = path.join(stateDir, "mission-state.json");
  process.env.REVOCATION_STATE_PATH = path.join(stateDir, "revocation-state.json");
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

  const attackerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const attackerPublicJwk = {
    ...attackerKeys.publicKey.export({ format: "jwk" }),
    kid: "attacker-key",
    alg: "RS256",
    use: "sig"
  };
  const attackerJwt = signRsJwt({
    iss: "https://attacker.example/",
    sub: "attacker-subject",
    aud: "attacker-audience",
    scope: "compute:clinical dataset:clinical-failures-q1 rail:zeko",
    exp: now + 600,
    iat: now
  }, attackerKeys.privateKey, "attacker-key");
  process.env.OIDC_ISSUER = "https://issuer.example/";
  process.env.OIDC_AUDIENCE = "client-123";
  process.env.OIDC_JWKS_URL = "https://issuer.example/jwks.json";
  globalThis.fetch = async (url) => {
    if (String(url) === process.env.OIDC_JWKS_URL) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url) === "https://attacker.example/jwks.json") {
      return new Response(JSON.stringify({ keys: [attackerPublicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return previousFetch(url);
  };
  const { createServer } = await import("../apps/harness/server.js");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const forgedCommitment = await requestJson({
      port,
      method: "POST",
      path: "/api/oauth/zk-commit",
      body: {
        token: attackerJwt,
        provider: "generic-oidc",
        issuer: "https://attacker.example/",
        audience: "attacker-audience",
        jwksUrl: "https://attacker.example/jwks.json"
      }
    });
    assert.notEqual(forgedCommitment.status, 200);
    assert.match(forgedCommitment.body.message ?? forgedCommitment.body.error, /No JWKS key|internal_error/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

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
  const normalized = normalizeOAuthClaims({ ...claims, agent_id: "attacker-controlled-agent" }, "auth0");
  assert.equal(normalized.agentId, "agent-mapped-123");
  assert.equal(normalized.subjectKey, "auth0:https://issuer.example/:subject-123");
  assert.throws(
    () => normalizeOAuthClaims({ ...claims, sub: "unmapped-subject" }, "auth0"),
    /No production agent mapping/
  );

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

  const hmacOnlyApproval = { ...approval };
  delete hmacOnlyApproval.authorityJws;
  const hmacDowngrade = enforceCheckpoint({
    checkpoint: "before_private_compute",
    approval: hmacOnlyApproval,
    context: {
      missionExecutionId: "exec-hmac",
      idempotencyKey: "compute-hmac",
      agentId: passport.agentId,
      datasetId: mission.datasetId,
      operation: mission.operation,
      action: "private_compute.run",
      railId: "zeko"
    }
  });
  assert.equal(hmacDowngrade.ok, false);
  assert.match(hmacDowngrade.reason, /JWS is required/);

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
    asset: { symbol: "tMINA", decimals: 9, standard: "native" },
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
      asset: { symbol: "tMINA", decimals: 9, standard: "native" },
      payTo: "B62test"
    }]
  }, mockPayment);
  assert.equal(paymentCheck.ok, false);
  assert.match(paymentCheck.reason, /Mock x402/);

  const facilitatorKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const facilitatorPublicJwk = {
    ...facilitatorKeys.publicKey.export({ format: "jwk" }),
    kid: "facilitator-test",
    alg: "ES256",
    use: "sig"
  };
  process.env.X402_TRUST_FACILITATOR_RECEIPTS = "true";
  process.env.X402_FACILITATOR_ISSUER = "https://facilitator.example/";
  process.env.X402_FACILITATOR_JWKS_JSON = JSON.stringify({ keys: [facilitatorPublicJwk] });
  const option = {
    railId: "zeko",
    settlementRail: "zeko",
    network: "zeko:testnet",
    amount: "0.1",
    asset: { symbol: "tMINA", decimals: 9, standard: "native" },
    payTo: "B62test"
  };
  const signedPayment = {
    protocol: "x402",
    version: "2",
    requestId: "req-2",
    paymentId: "pay-2",
    railId: option.railId,
    settlementRail: option.settlementRail,
    networkId: option.network,
    amount: option.amount,
    asset: option.asset,
    payer: "B62payer",
    payTo: option.payTo,
    expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    authorization: { mode: "facilitator" }
  };
  signedPayment.authorizationDigest = sha256Hex(signedPayment);
  const receiptPayload = {
    iss: process.env.X402_FACILITATOR_ISSUER,
    aud: "agent-mission-bound-auth",
    requestId: signedPayment.requestId,
    paymentId: signedPayment.paymentId,
    railId: signedPayment.railId,
    settlementRail: signedPayment.settlementRail,
    networkId: option.network,
    amount: option.amount,
    assetHash: sha256Hex(option.asset),
    payer: signedPayment.payer,
    payTo: option.payTo,
    authorizationDigest: signedPayment.authorizationDigest,
    txHash: "0xabc123",
    exp: now + 600
  };
  const signedReceipt = signEsJws(receiptPayload, facilitatorKeys.privateKey);
  const signedPaymentCheck = verifyPayment({
    requestId: signedPayment.requestId,
    accepts: [option]
  }, {
    ...signedPayment,
    facilitatorReceipt: {
      networkId: option.network,
      payTo: option.payTo,
      authorizationDigest: signedPayment.authorizationDigest,
      jws: signedReceipt
    }
  });
  assert.equal(signedPaymentCheck.ok, true);

  const unsignedReceiptCheck = verifyPayment({
    requestId: signedPayment.requestId,
    accepts: [option]
  }, {
    ...signedPayment,
    facilitatorReceipt: {
      networkId: option.network,
      payTo: option.payTo,
      authorizationDigest: signedPayment.authorizationDigest
    }
  });
  assert.equal(unsignedReceiptCheck.ok, false);
  assert.match(unsignedReceiptCheck.reason, /signed receipt JWS/);

  console.log(JSON.stringify({ ok: true, checks: ["strict-jwt", "provider-pinned-jwks", "agent-mapping", "production-keys", "replay-budget", "settlement-proof"] }, null, 2));
} finally {
  process.env = previousEnv;
  globalThis.fetch = previousFetch;
}
