import { spawn } from "node:child_process";
import { createServer } from "../apps/harness/server.js";
import { ZkMissionAuthClient } from "../packages/sdk/client.js";
import { verifyMissionBundle } from "../packages/sdk/verify.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function runExternalAdapter(bundle, baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["examples/external-app-adapter.mjs", JSON.stringify(bundle)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ZK_MISSION_AUTH_URL: baseUrl
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `external adapter exited ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

const server = createServer();
const baseUrl = await listen(server);
const client = new ZkMissionAuthClient({ baseUrl });

try {
  const discovery = await client.discover();
  if (discovery.protocol !== "zk-mission-auth") throw new Error("discovery failed");

  const { zkOAuthProof } = await client.issueDemoProof();
  const { agentPassport } = await client.createAgentPassport({
    agentId: zkOAuthProof.revealed.agentId,
    organization: zkOAuthProof.revealed.organization
  });
  const { mission } = await client.proposeMission({
    agentId: zkOAuthProof.revealed.agentId,
    datasetId: "clinical-failures-q1",
    operation: "risk-summary",
    task: "Summarize private clinical failure risks for an internal board memo.",
    title: "Protocol smoke mission",
    allowedTools: ["private_compute.run", "x402.payment_offer", "x402.pay", "x402.settle", "external_app.side_effect", "zeko.receipt.anchor"],
    allowedScopes: ["compute:clinical", "dataset:clinical-failures-q1", "x402:pay"],
    allowedRails: ["zeko", "ethereum", "base", "arc", "tempo"]
  });
  const { approval } = await client.approveMission({
    missionId: mission.missionId,
    approverId: "protocol-smoke@example.com",
    issuer: "demo-enterprise-sso"
  });

  const computeRequest = {
    datasetId: mission.datasetId,
    operation: mission.operation,
    query: mission.task,
    zkOAuthProof,
    missionApproval: approval
  };

  let paymentOffer;
  try {
    await client.requestCompute(computeRequest);
  } catch (error) {
    if (error.status !== 402) throw error;
    paymentOffer = error.body.requirement;
  }
  if (!paymentOffer) throw new Error("missing x402 payment offer");

  const payment = await client.authorizeMockPayment({
    requirement: paymentOffer,
    railId: "zeko",
    payer: zkOAuthProof.revealed.agentId
  });
  const compute = await client.requestCompute(computeRequest, payment.paymentHeader);
  if (compute.rawDataReleased !== false) throw new Error("raw data leaked");

  const { bundle } = await client.exportBundle({
    agentPassport,
    mission,
    approval,
    auth: {
      authCommitment: zkOAuthProof.authCommitment,
      scopeCommitment: zkOAuthProof.scopeCommitment
    },
    payment: compute.receipt.paymentReceipt,
    receipt: compute.receipt,
    zeko: compute.receipt.zekoAuditReceipt
  });
  const jwks = await client.jwks();
  const offline = verifyMissionBundle(bundle, jwks);
  if (!offline.ok) throw new Error("offline bundle verification failed");

  const adapter = await runExternalAdapter(bundle, baseUrl);
  if (!adapter.allowed) throw new Error("external adapter rejected bundle");

  console.log(JSON.stringify({
    ok: true,
    discovery: discovery.protocol,
    missionId: mission.missionId,
    approvalId: approval.approvalId,
    bundleHash: bundle.bundleHash,
    adapterReceipt: adapter.enforcementReceipt.receiptHash,
    paymentRail: compute.receipt.paymentReceipt.railId,
    rawDataReleased: compute.rawDataReleased
  }, null, 2));
} finally {
  server.close();
}
