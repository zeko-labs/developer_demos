import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPaymentRequirement, buildMockPayment, decodePaymentHeader, encodeRequirement, PAYMENT, PAYMENT_REQUIRED, PAYMENT_RESPONSE, verifyPayment } from "../../packages/protocol/x402.js";
import { buildPolicy, loadDatasets, runPrivateCompute } from "./private-compute.js";
import { issueZkOAuthProof, verifyZkOAuthProof } from "./zk-oauth.js";
import { id } from "../../packages/protocol/digest.js";
import { enabledRails } from "../../packages/protocol/rails.js";
import { buildZekoContractPlan } from "../../packages/protocol/zeko-plan.js";
import { buildAuthCommitment, normalizeOAuthClaims, verifyJwtWithJwks } from "../../packages/protocol/oauth-production.js";
import { buildOidcAuthorization, completeOidcAuthorization, oidcProviderConfig, oidcProviderNames } from "../../packages/protocol/oidc.js";
import { listRevocations, revokeAuthCommitment } from "../../packages/protocol/revocations.js";
import {
  approveMission,
  buildAgentPassport,
  enforceCheckpoint,
  getApproval,
  getMission,
  listEnforcementLog,
  listMissions,
  proposeMission
} from "../../packages/protocol/missions.js";
import { buildDiscoveryDocument, buildMissionBundle } from "../../packages/protocol/protocol-bundles.js";
import { jwks } from "../../packages/protocol/authority-keys.js";
import { loadLocalEnv } from "../../packages/protocol/env-local.js";
import { isDemoMode, isProductionProfile, requireAuthorityBearer } from "../../packages/protocol/runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOT_DIR = path.join(__dirname, "..", "..");
const pendingJobs = new Map();
const oidcSessions = new Map();

loadLocalEnv(ROOT_DIR);

function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (isProductionProfile()) {
    throw new Error("PUBLIC_BASE_URL is required in production profile.");
  }
  const host = req.headers.host ?? process.env.BASE_URL?.replace(/^https?:\/\//, "") ?? "127.0.0.1:8787";
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  return `${proto}://${host}`;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > Number(process.env.MAX_JSON_BODY_BYTES ?? 1_000_000)) {
      throw new Error("request_body_too_large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requireDemoEndpoint(res, name) {
  if (isDemoMode()) return true;
  sendJson(res, 403, {
    error: "demo_endpoint_disabled",
    message: `${name} is disabled in production profile.`
  });
  return false;
}

function requireApprovalAuthority(req, res) {
  const auth = requireAuthorityBearer(req);
  if (auth.ok) return true;
  sendJson(res, auth.status, { error: "approval_authority_required", reason: auth.reason });
  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://local");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath);
  const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
  res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
  res.end(data);
}

async function serveVendor(req, res) {
  const filePath = path.join(ROOT_DIR, "node_modules", "@auth0", "auth0-spa-js", "dist", "auth0-spa-js.production.esm.js");
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(data);
}

async function handleCompute(req, res) {
  const body = await readJson(req);
  const datasets = await loadDatasets();
  const dataset = datasets.find((item) => item.id === body.datasetId);
  if (!dataset) {
    sendJson(res, 404, { error: "dataset_not_found" });
    return;
  }

  const operation = body.operation ?? "risk-summary";
  const policy = buildPolicy(dataset, operation);
  const job = {
    jobId: body.jobId ?? id("job", { datasetId: dataset.id, query: body.query, operation }),
    datasetId: dataset.id,
    query: body.query ?? "",
    operation,
    policy
  };
  const requirement = buildPaymentRequirement(job);
  pendingJobs.set(requirement.requestId, { job, requirement });

  const proof = body.zkOAuthProof;
  const payment = decodePaymentHeader(req.headers[PAYMENT.toLowerCase()]);
  const railId = payment?.railId ?? null;
  const auth = verifyZkOAuthProof(proof, {
    requiredScopes: policy.requiredScopes,
    railId
  });

  if (!auth.ok) {
    sendJson(res, 401, { error: "zk_oauth_unauthorized", reason: auth.reason, policy });
    return;
  }

  const missionContext = {
    agentId: auth.agentId,
    datasetId: dataset.id,
    operation,
    missionExecutionId: body.missionExecutionId ?? job.jobId,
    railId,
    action: payment ? "private_compute.run" : "x402.payment_offer"
  };
  const missionCheck = enforceCheckpoint({
    checkpoint: payment ? "before_private_compute" : "before_payment_offer",
    approval: body.missionApproval,
    context: missionContext
  });
  if (!missionCheck.ok) {
    sendJson(res, 403, {
      error: "mission_not_authorized",
      reason: missionCheck.reason,
      policy,
      checkpoint: missionCheck.event
    });
    return;
  }

  if (!payment) {
    sendJson(
      res,
      402,
      {
        error: "payment_required",
        requirement,
        policy,
        auth: {
          verified: true,
          agentId: auth.agentId,
          organization: auth.organization,
          authCommitment: auth.authCommitment,
          scopeCommitment: auth.scopeCommitment
        },
        mission: {
          missionId: missionCheck.mission.missionId,
          approvalId: missionCheck.approval.approvalId,
          missionHash: missionCheck.mission.missionHash,
          missionCommitment: missionCheck.missionCommitment,
          enforcementReceipt: missionCheck.enforcementReceipt
        }
      },
      { [PAYMENT_REQUIRED]: encodeRequirement(requirement) }
    );
    return;
  }

  const verifiedPayment = verifyPayment(requirement, payment);
  if (!verifiedPayment.ok) {
    sendJson(res, 402, { error: "payment_invalid", reason: verifiedPayment.reason, requirement }, { [PAYMENT_REQUIRED]: encodeRequirement(requirement) });
    return;
  }

  const sideEffectCheck = enforceCheckpoint({
    checkpoint: "before_external_side_effect",
    approval: body.missionApproval,
    context: {
      ...missionContext,
      railId: payment.railId,
      paymentId: payment.paymentId,
      idempotencyKey: payment.paymentId,
      action: "x402.settle"
    }
  });
  if (!sideEffectCheck.ok) {
    sendJson(res, 403, {
      error: "mission_side_effect_not_authorized",
      reason: sideEffectCheck.reason,
      checkpoint: sideEffectCheck.event
    });
    return;
  }

  const result = runPrivateCompute({
    dataset,
    query: job.query,
    operation,
    auth,
    paymentReceipt: verifiedPayment.paymentReceipt,
    mission: {
      missionId: missionCheck.mission.missionId,
      missionHash: missionCheck.mission.missionHash,
      missionCommitment: missionCheck.missionCommitment,
      enforcementReceipts: [
        missionCheck.enforcementReceipt,
        sideEffectCheck.enforcementReceipt
      ]
    }
  });

  sendJson(
    res,
    200,
    {
      job,
      result: result.output,
      receipt: result.receipt,
      rawDataReleased: false,
      mission: {
        missionId: missionCheck.mission.missionId,
        approvalId: missionCheck.approval.approvalId,
        missionHash: missionCheck.mission.missionHash,
        missionCommitment: missionCheck.missionCommitment
      }
    },
    { [PAYMENT_RESPONSE]: JSON.stringify(verifiedPayment.paymentReceipt) }
  );
}

async function route(req, res) {
  try {
    const url = new URL(req.url, "http://local");
    const baseUrl = publicBaseUrl(req);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "agent-mission-bound-auth" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/oauth/providers") {
      sendJson(res, 200, {
        providers: oidcProviderNames().map((provider) => {
          const config = oidcProviderConfig(provider, baseUrl);
          return {
            provider,
            configured: config.configured,
            issuer: config.issuer,
            clientId: config.clientId ? "set" : "missing",
            discoveryUrl: config.discoveryUrl,
            redirectUri: config.redirectUri
          };
        })
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/oauth/browser-config") {
      const domain = process.env.AUTH0_DOMAIN ?? process.env.VITE_AUTH0_DOMAIN ?? process.env.AUTH0_ISSUER?.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const clientId = process.env.AUTH0_CLIENT_ID ?? process.env.VITE_AUTH0_CLIENT_ID;
      const audience = process.env.AUTH0_AUDIENCE ?? process.env.VITE_AUTH0_AUDIENCE;
      sendJson(res, 200, {
        provider: "auth0",
        configured: Boolean(domain && clientId),
        domain: domain ?? null,
        clientId: clientId ?? null,
        audience: audience || null,
        issuer: domain ? `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/` : null,
        requiredUrls: {
          allowedCallbackUrls: baseUrl,
          allowedLogoutUrls: baseUrl,
          allowedWebOrigins: baseUrl
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/oauth/login") {
      const provider = url.searchParams.get("provider") ?? "auth0";
      const auth = await buildOidcAuthorization(oidcProviderConfig(provider, baseUrl), oidcSessions);
      if (url.searchParams.get("return") === "json") {
        sendJson(res, 200, auth);
      } else {
        res.writeHead(302, { location: auth.authorizationUrl });
        res.end();
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/oauth/callback") {
      if (url.searchParams.get("error")) {
        sendJson(res, 400, {
          error: url.searchParams.get("error"),
          errorDescription: url.searchParams.get("error_description")
        });
        return;
      }
      const result = await completeOidcAuthorization({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state")
      }, oidcSessions);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/rails") {
      sendJson(res, 200, { rails: enabledRails() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/zeko/contract-plan") {
      sendJson(res, 200, buildZekoContractPlan());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/datasets") {
      const datasets = await loadDatasets();
      sendJson(res, 200, {
        datasets: datasets.map((dataset) => ({
          id: dataset.id,
          owner: dataset.owner,
          title: dataset.title,
          classification: dataset.classification,
          rawRecordsHidden: true,
          allowedScopes: dataset.allowedScopes
        }))
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agents/passport") {
      if (!requireApprovalAuthority(req, res)) return;
      sendJson(res, 200, { agentPassport: buildAgentPassport(await readJson(req)) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/missions/propose") {
      if (!requireApprovalAuthority(req, res)) return;
      sendJson(res, 200, { mission: proposeMission(await readJson(req)) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/missions/approve") {
      if (!requireApprovalAuthority(req, res)) return;
      sendJson(res, 200, { approval: approveMission(await readJson(req)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/missions") {
      sendJson(res, 200, { missions: listMissions() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/enforcement-log") {
      sendJson(res, 200, { enforcementLog: listEnforcementLog() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/mission/verify-checkpoint") {
      const body = await readJson(req);
      const result = enforceCheckpoint({
        checkpoint: body.checkpoint,
        approval: body.approval,
        context: body.context
      });
      sendJson(res, result.ok ? 200 : 403, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/mission/export-bundle") {
      const body = await readJson(req);
      const mission = body.mission ?? getMission(body.missionId);
      const approval = body.approval ?? getApproval(body.approvalId ?? mission?.approvalId);
      sendJson(res, 200, {
        bundle: buildMissionBundle({
          agentPassport: body.agentPassport ?? null,
          mission,
          approval,
          auth: body.auth,
          payment: body.payment,
          receipt: body.receipt,
          zeko: body.zeko
        })
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/demo-domain/email/send") {
      const body = await readJson(req);
      const check = enforceCheckpoint({
        checkpoint: "before_external_side_effect",
        approval: body.missionApproval,
        context: {
          agentId: body.agentId,
          datasetId: body.datasetId,
          operation: body.operation,
          action: "email.send",
          toDomain: String(body.to ?? "").split("@").pop() ?? "unknown"
        }
      });
      if (!check.ok) {
        sendJson(res, 403, { error: "domain_action_not_authorized", reason: check.reason, checkpoint: check.event });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        sent: false,
        mode: "demo-adapter",
        message: "Domain adapter verified the mission before the side effect. No real email was sent.",
        enforcementReceipt: check.enforcementReceipt
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/x402.json") {
      sendJson(res, 200, {
        protocol: "x402",
        version: "2",
        serviceId: "agent-mission-bound-auth",
        routes: [{ method: "POST", resource: "/api/compute", accepts: enabledRails() }],
        features: ["402-response", "multi-rail", "zk-oauth", "private-compute", "programmable-privacy"]
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/agent-authorization.json") {
      sendJson(res, 200, buildDiscoveryDocument(baseUrl));
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/mission-authority-jwks.json") {
      sendJson(res, 200, jwks());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/oauth/zk-issue") {
      if (!requireDemoEndpoint(res, "demo zk OAuth proof issuance")) return;
      sendJson(res, 200, { zkOAuthProof: issueZkOAuthProof(await readJson(req)) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/oauth/zk-commit") {
      const body = await readJson(req);
      const token = body.token ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (isProductionProfile() && !token) {
        sendJson(res, 400, {
          error: "jwt_required",
          message: "Production commitment construction requires a verified JWT."
        });
        return;
      }
      const claims = token
        ? await verifyJwtWithJwks(token, {
            issuer: body.issuer ?? process.env.OIDC_ISSUER,
            audience: body.audience ?? process.env.OIDC_AUDIENCE,
            jwksUrl: body.jwksUrl ?? process.env.OIDC_JWKS_URL
          })
        : body.claims;
      const normalizedClaims = normalizeOAuthClaims(claims, body.provider);
      const commitment = buildAuthCommitment(
        normalizedClaims,
        body.salt ?? "server-side-demo-salt",
        process.env.ZK_OAUTH_ISSUER_SECRET
      );
      sendJson(res, 200, {
        normalizedClaims,
        authCommitment: commitment.authCommitment,
        scopeCommitment: commitment.scopeCommitment,
        issuerProofDigest: commitment.issuerProofDigest
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/oauth/revocations") {
      sendJson(res, 200, { revocations: listRevocations() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/oauth/revoke") {
      if (!requireApprovalAuthority(req, res)) return;
      const body = await readJson(req);
      sendJson(res, 200, { revoked: revokeAuthCommitment(body.authCommitment, body.reason) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/payments/mock-authorize") {
      if (!requireDemoEndpoint(res, "mock x402 authorization")) return;
      const body = await readJson(req);
      sendJson(res, 200, buildMockPayment(body.requirement, body.railId, body.payer));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/x402/verify") {
      const body = await readJson(req);
      const job = pendingJobs.get(body.requirement?.requestId);
      sendJson(res, 200, verifyPayment(body.requirement ?? job?.requirement, body.payment));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/compute") {
      await handleCompute(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/vendor/auth0-spa-js.production.esm.js") {
      await serveVendor(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: "internal_error", message: error instanceof Error ? error.message : String(error) });
  }
}

export function createServer() {
  return http.createServer(route);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 8787);
  createServer().listen(port, host, () => {
    console.log(`agent-mission-bound-auth listening on http://${host}:${port}`);
  });
}
