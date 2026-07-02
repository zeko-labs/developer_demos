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

function validJsonJwks(name) {
  const value = process.env[name];
  if (!value) return { name, present: false, ok: false, reason: "missing" };
  try {
    const parsed = JSON.parse(value);
    return {
      name,
      present: true,
      ok: Array.isArray(parsed.keys) && parsed.keys.length > 0,
      keyCount: Array.isArray(parsed.keys) ? parsed.keys.length : 0
    };
  } catch (error) {
    return {
      name,
      present: true,
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
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
  required("MISSION_APPROVAL_BEARER_TOKEN"),
  required("MISSION_STATE_PATH"),
  required("REVOCATION_STATE_PATH")
];
const settlement = [
  {
    name: "X402_TRUST_FACILITATOR_RECEIPTS",
    present: Boolean(process.env.X402_TRUST_FACILITATOR_RECEIPTS),
    value: process.env.X402_TRUST_FACILITATOR_RECEIPTS ? "set" : "missing",
    ok: process.env.X402_TRUST_FACILITATOR_RECEIPTS === "true"
  },
  required("X402_FACILITATOR_ISSUER"),
  required("X402_FACILITATOR_AUDIENCE"),
  validJsonJwks("X402_FACILITATOR_JWKS_JSON")
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
  settlement.every((item) => item.ok ?? item.present) &&
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
    ...settlement.filter((item) => !(item.ok ?? item.present)).map((item) => item.name),
    ...(jwks.ok ? [] : ["valid OIDC JWKS"]),
    ...zekoDeploy.filter((item) => !item.present).map((item) => item.name),
    ...(zeko.ok ? [] : ["reachable Zeko GraphQL"]),
    ...(zkappBuild.ok ? [] : ["npm run zkapp:build"])
  ]
}, null, 2));

process.exit(ok ? 0 : 1);
