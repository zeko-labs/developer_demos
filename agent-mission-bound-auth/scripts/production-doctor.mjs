import fs from "node:fs";
import { loadLocalEnv } from "../packages/protocol/env-local.js";

loadLocalEnv();

function required(name) {
  return {
    name,
    present: Boolean(process.env[name]),
    value: process.env[name] ? "set" : "missing"
  };
}

async function checkJwks() {
  const url = process.env.OIDC_JWKS_URL;
  if (!url) {
    return { ok: false, skipped: true, reason: "OIDC_JWKS_URL missing" };
  }

  try {
    const res = await fetch(url);
    const body = await res.json();
    return {
      ok: res.ok && Array.isArray(body.keys),
      status: res.status,
      keyCount: Array.isArray(body.keys) ? body.keys.length : 0
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkZeko() {
  const graphql = process.env.ZEKO_GRAPHQL?.endsWith("/graphql")
    ? process.env.ZEKO_GRAPHQL
    : `${(process.env.ZEKO_GRAPHQL ?? "https://testnet.zeko.io").replace(/\/$/, "")}/graphql`;

  try {
    const res = await fetch(graphql, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "query SequencerPK { sequencerPk }" })
    });
    const body = await res.json();
    return {
      ok: res.ok && Boolean(body.data?.sequencerPk),
      graphql,
      sequencerPk: body.data?.sequencerPk ?? null,
      errors: body.errors ?? null
    };
  } catch (error) {
    return { ok: false, graphql, error: error instanceof Error ? error.message : String(error) };
  }
}

const oidc = [
  required("MISSION_AUTH_PROFILE"),
  required("DEMO_MODE"),
  required("PUBLIC_BASE_URL"),
  required("OIDC_ISSUER"),
  required("OIDC_AUDIENCE"),
  required("OIDC_JWKS_URL")
];
const authority = [
  required("ZK_OAUTH_ISSUER_SECRET"),
  required("MISSION_AUTHORITY_PRIVATE_JWK"),
  required("MISSION_APPROVAL_BEARER_TOKEN")
];
const settlement = [
  required("X402_TRUST_FACILITATOR_RECEIPTS")
];
const zekoDeploy = [
  required("DEPLOYER_PRIVATE_KEY"),
  required("ZKAPP_PRIVATE_KEY"),
  required("PRIVATE_COMPUTE_BENEFICIARY_PUBLIC_KEY"),
  required("ZEKO_GRAPHQL")
];
const zkappBuild = {
  ok: fs.existsSync("dist-zkapp/PrivateComputeAccess.js"),
  path: "dist-zkapp/PrivateComputeAccess.js"
};
const jwks = await checkJwks();
const zeko = await checkZeko();

const ok =
  oidc.every((item) => item.present) &&
  authority.every((item) => item.present) &&
  settlement.every((item) => item.present) &&
  jwks.ok &&
  zekoDeploy.every((item) => item.present) &&
  zeko.ok &&
  zkappBuild.ok;

console.log(JSON.stringify({
  ok,
  oidc,
  authority,
  settlement,
  jwks,
  zekoDeploy,
  zeko,
  zkappBuild,
  nextMissing: [
    ...oidc.filter((item) => !item.present).map((item) => item.name),
    ...authority.filter((item) => !item.present).map((item) => item.name),
    ...settlement.filter((item) => !item.present).map((item) => item.name),
    ...(jwks.ok ? [] : ["valid OIDC JWKS"]),
    ...zekoDeploy.filter((item) => !item.present).map((item) => item.name),
    ...(zeko.ok ? [] : ["reachable Zeko GraphQL"]),
    ...(zkappBuild.ok ? [] : ["npm run zkapp:build"])
  ]
}, null, 2));

process.exit(ok ? 0 : 1);
