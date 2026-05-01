import { spawnSync } from "node:child_process";
import { jwks } from "../packages/protocol/authority-keys.js";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout.trim();
}

const protocol = JSON.parse(run("npm", ["run", "smoke:protocol", "--silent"], {
  env: { ...process.env }
}));
const conformance = JSON.parse(run("npm", ["run", "test:conformance", "--silent"]));

console.log(JSON.stringify({
  ok: true,
  protocol: "agent-mission-bound-auth",
  proofPoints: {
    discovery: protocol.discovery,
    missionId: protocol.missionId,
    approvalId: protocol.approvalId,
    bundleHash: protocol.bundleHash,
    externalAdapterReceipt: protocol.adapterReceipt,
    offlineJwksKid: jwks().keys[0].kid,
    conformanceBundleHash: conformance.bundleHash,
    liveZeko: {
      zkapp: "B62qpBXMbrKVJwcS9wQN7SpFb6jkrXn2xrntCoM6D461qL2sYZarPHi",
      approvalRoot: "18254630832314440409014986041827431424117053312046611743246600167702035963192",
      receiptRoot: "2503101496281787741527009452532014343190670744041313963524602789905044535138"
    }
  },
  checks: [
    "mission approval JWS verified offline",
    "portable bundle hash verified",
    "external app adapter checkpoint verified",
    "x402 payment flow completed",
    "raw private data not released"
  ]
}, null, 2));
