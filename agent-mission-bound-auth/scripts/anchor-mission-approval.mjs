import "../../zeko-x402/node_modules/reflect-metadata/Reflect.js";

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  fetchAccount
} from "../../zeko-x402/node_modules/o1js/dist/node/index.js";
import { PrivateComputeAccess } from "../dist-zkapp/PrivateComputeAccess.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function graphqlUrl() {
  const endpoint = process.env.ZEKO_GRAPHQL ?? "https://testnet.zeko.io/graphql";
  return endpoint.endsWith("/graphql") ? endpoint : `${endpoint.replace(/\/$/, "")}/graphql`;
}

function digestToField(value) {
  return Field(BigInt(`0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`));
}

function statePath() {
  return process.env.PRIVATE_COMPUTE_APPROVAL_STATE_PATH ?? path.join(process.cwd(), "data", "approval-anchor-state.json");
}

function readState() {
  const file = statePath();
  if (!fs.existsSync(file)) {
    return { authRoot: "0", anchors: [] };
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeState(state) {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

const stdin = await new Promise((resolve) => {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    body += chunk;
  });
  process.stdin.on("end", () => resolve(body));
});
const input = stdin.trim().length > 0 ? JSON.parse(stdin) : {};

const graphql = graphqlUrl();
const archive = process.env.ZEKO_ARCHIVE ?? "https://archive.testnet.zeko.io/graphql";
const deployerKey = PrivateKey.fromBase58(requireEnv("DEPLOYER_PRIVATE_KEY"));
const zkappAddress = PublicKey.fromBase58(requireEnv("PRIVATE_COMPUTE_ZKAPP_PUBLIC_KEY"));
const txFee = UInt64.from(process.env.TX_FEE ?? "2000000000");

Mina.setActiveInstance(Mina.Network({ mina: graphql, archive }));
await PrivateComputeAccess.compile();

const fetched = await fetchAccount({ publicKey: zkappAddress });
if (fetched.error) {
  throw new Error(`zkApp account not found: ${zkappAddress.toBase58()}`);
}

const localState = readState();
const previousRoot = Field(BigInt(localState.authRoot ?? "0"));
const approvalDigestInput = {
  missionId: input.missionId,
  missionHash: input.missionHash,
  approvalId: input.approvalId,
  approvalHash: input.approvalHash,
  approver: input.approver,
  previousRoot: previousRoot.toString(),
  index: localState.anchors.length
};
const nextRoot = digestToField(approvalDigestInput);
const zkapp = new PrivateComputeAccess(zkappAddress);

const tx = await Mina.transaction({ sender: deployerKey.toPublicKey(), fee: txFee }, async () => {
  await zkapp.registerAuthCommitment(previousRoot, nextRoot);
});

await tx.prove();
tx.sign([deployerKey]);
const sent = await tx.send();

const anchor = {
  anchoredAt: new Date().toISOString(),
  zkappAddress: zkappAddress.toBase58(),
  previousRoot: previousRoot.toString(),
  nextRoot: nextRoot.toString(),
  hash: sent.hash ?? null,
  status: sent.status ?? null,
  approvalDigestInput
};

localState.authRoot = nextRoot.toString();
localState.anchors.push(anchor);
writeState(localState);

console.log(JSON.stringify({
  ok: true,
  ...anchor,
  statePath: statePath()
}, null, 2));
