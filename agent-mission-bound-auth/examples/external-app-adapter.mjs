import { ZkMissionAuthClient } from "../packages/sdk/client.js";
import { verifyMissionBundle } from "../packages/sdk/verify.js";

const baseUrl = process.env.ZK_MISSION_AUTH_URL ?? "http://127.0.0.1:8787";
const client = new ZkMissionAuthClient({ baseUrl });

const bundle = JSON.parse(process.argv[2] ?? "{}");
if (!bundle.approval) {
  throw new Error("Pass a zk-mission-bundle-v1 JSON string as the first argument.");
}

const jwks = await client.jwks();
verifyMissionBundle(bundle, jwks);

const result = await client.verifyCheckpoint({
  checkpoint: "before_external_side_effect",
  approval: bundle.approval,
  context: {
    agentId: bundle.mission?.agentId,
    datasetId: bundle.mission?.datasetId,
    operation: bundle.mission?.operation,
    action: process.env.ACTION ?? "external_app.side_effect"
  }
});

console.log(JSON.stringify({
  ok: true,
  adapter: "external-app-adapter",
  bundleHash: bundle.bundleHash,
  allowed: result.ok,
  enforcementReceipt: result.enforcementReceipt
}, null, 2));
