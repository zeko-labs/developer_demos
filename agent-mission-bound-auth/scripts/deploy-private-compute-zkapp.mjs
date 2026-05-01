import "../../zeko-x402/node_modules/reflect-metadata/Reflect.js";

import {
  AccountUpdate,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  fetchAccount
} from "../../zeko-x402/node_modules/o1js/dist/node/index.js";
import { PrivateComputeAccess } from "../dist-zkapp/PrivateComputeAccess.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function accountExists(publicKey) {
  try {
    const result = await fetchAccount({ publicKey });
    return !result.error;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAccountVisible(publicKey, attempts = 40, intervalMs = 3000) {
  for (let index = 0; index < attempts; index += 1) {
    if (await accountExists(publicKey)) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

const graphql = requireEnv("ZEKO_GRAPHQL").endsWith("/graphql")
  ? requireEnv("ZEKO_GRAPHQL")
  : `${requireEnv("ZEKO_GRAPHQL").replace(/\/$/, "")}/graphql`;
const archive = process.env.ZEKO_ARCHIVE ?? "https://archive.testnet.zeko.io/graphql";
const txFee = UInt64.from(process.env.TX_FEE ?? "2000000000");
const deployerKey = PrivateKey.fromBase58(requireEnv("DEPLOYER_PRIVATE_KEY"));
const zkappKey = PrivateKey.fromBase58(requireEnv("ZKAPP_PRIVATE_KEY"));
const beneficiary = PublicKey.fromBase58(requireEnv("PRIVATE_COMPUTE_BENEFICIARY_PUBLIC_KEY"));
const deployer = deployerKey.toPublicKey();
const zkappAddress = zkappKey.toPublicKey();

Mina.setActiveInstance(Mina.Network({ mina: graphql, archive }));

console.log("[private-compute:zkapp:deploy] compiling...");
await PrivateComputeAccess.compile();

const alreadyExists = await accountExists(zkappAddress);
const zkapp = new PrivateComputeAccess(zkappAddress);

console.log("[private-compute:zkapp:deploy] sending deploy transaction...");
const deployTx = await Mina.transaction({ sender: deployer, fee: txFee }, async () => {
  if (!alreadyExists) {
    AccountUpdate.fundNewAccount(deployer);
  }
  await zkapp.deploy();
});

await deployTx.prove();
deployTx.sign([deployerKey, zkappKey]);
const sentDeploy = await deployTx.send();

const visible = await waitForAccountVisible(zkappAddress);
if (!visible) {
  throw new Error(`zkApp account ${zkappAddress.toBase58()} not visible after deploy transaction.`);
}

await fetchAccount({ publicKey: zkappAddress });

console.log("[private-compute:zkapp:deploy] sending configure transaction...");
const configureTx = await Mina.transaction({ sender: deployer, fee: txFee }, async () => {
  await zkapp.configureBeneficiary(beneficiary);
});

await configureTx.prove();
configureTx.sign([deployerKey, zkappKey]);
const sentConfigure = await configureTx.send();

console.log(JSON.stringify({
  ok: true,
  zkappAddress: zkappAddress.toBase58(),
  beneficiary: beneficiary.toBase58(),
  deployer: deployer.toBase58(),
  deployHash: sentDeploy.hash ?? null,
  deployStatus: sentDeploy.status ?? null,
  configureHash: sentConfigure.hash ?? null,
  configureStatus: sentConfigure.status ?? null,
  graphql
}, null, 2));
