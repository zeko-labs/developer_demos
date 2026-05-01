import "../../zeko-x402/node_modules/reflect-metadata/Reflect.js";

import {
  Mina,
  PublicKey,
  fetchAccount
} from "../../zeko-x402/node_modules/o1js/dist/node/index.js";
import { PrivateComputeAccess } from "../dist-zkapp/PrivateComputeAccess.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const graphql = (process.env.ZEKO_GRAPHQL ?? "https://testnet.zeko.io/graphql").endsWith("/graphql")
  ? (process.env.ZEKO_GRAPHQL ?? "https://testnet.zeko.io/graphql")
  : `${(process.env.ZEKO_GRAPHQL ?? "https://testnet.zeko.io").replace(/\/$/, "")}/graphql`;
const archive = process.env.ZEKO_ARCHIVE ?? "https://archive.testnet.zeko.io/graphql";
const zkappAddress = PublicKey.fromBase58(requireEnv("PRIVATE_COMPUTE_ZKAPP_PUBLIC_KEY"));

Mina.setActiveInstance(Mina.Network({ mina: graphql, archive }));
const fetched = await fetchAccount({ publicKey: zkappAddress });
if (fetched.error) {
  const res = await fetch(graphql, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "query($pk:PublicKey!){ account(publicKey:$pk){ nonce inferredNonce zkappState } }",
      variables: { pk: zkappAddress.toBase58() }
    })
  });
  const body = await res.json();
  const account = body.data?.account;
  if (!account) {
    throw new Error(`zkApp account not found: ${zkappAddress.toBase58()}`);
  }
  console.log(JSON.stringify({
    ok: true,
    mode: "raw-graphql-fallback",
    zkappAddress: zkappAddress.toBase58(),
    nonce: account.nonce,
    inferredNonce: account.inferredNonce,
    datasetRoot: account.zkappState?.[0] ?? null,
    authRoot: account.zkappState?.[1] ?? null,
    receiptRoot: account.zkappState?.[2] ?? null,
    beneficiaryField: account.zkappState?.[3] ?? null,
    graphql
  }, null, 2));
  process.exit(0);
}

const zkapp = new PrivateComputeAccess(zkappAddress);
console.log(JSON.stringify({
  ok: true,
  zkappAddress: zkappAddress.toBase58(),
  datasetRoot: zkapp.datasetRoot.get().toString(),
  authRoot: zkapp.authRoot.get().toString(),
  receiptRoot: zkapp.receiptRoot.get().toString(),
  beneficiary: zkapp.beneficiary.get().toBase58(),
  graphql
}, null, 2));
