import http from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer as createHarness } from "../apps/harness/server.js";

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function b64json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeJwt({ privateKey, kid, issuer, audience, clientId, nonce, provider }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid };
  const payload = {
    iss: issuer,
    sub: `${provider}|agent-sandbox-subject`,
    aud: audience,
    azp: clientId,
    nonce,
    organization: `${provider}-sandbox-org`,
    scope: "compute:clinical dataset:clinical-failures-q1 rail:zeko rail:base budget:small",
    max_spend_usd: "5.00",
    iat: now,
    exp: now + 900
  };
  const signingInput = `${b64json(header)}.${b64json(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function createFakeOidcProvider({ provider, clientId, audience }) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `${provider}-sandbox-kid`;
  const publicJwk = publicKey.export({ format: "jwk" });
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  const codes = new Map();

  const server = http.createServer(async (req, res) => {
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);

    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      sendJson(res, 200, {
        issuer: `${base}/`,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"]
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/jwks") {
      sendJson(res, 200, { keys: [publicJwk] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/authorize") {
      const code = `${provider}-code-${Date.now()}`;
      codes.set(code, {
        clientId: url.searchParams.get("client_id"),
        redirectUri: url.searchParams.get("redirect_uri"),
        nonce: url.searchParams.get("nonce"),
        audience: url.searchParams.get("audience") ?? audience
      });
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: redirect.toString() });
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(await readBody(req));
      const record = codes.get(form.get("code"));
      if (!record || record.clientId !== form.get("client_id")) {
        sendJson(res, 400, { error: "invalid_grant" });
        return;
      }
      codes.delete(form.get("code"));
      sendJson(res, 200, {
        token_type: "Bearer",
        expires_in: 900,
        id_token: makeJwt({
          privateKey,
          kid,
          issuer: `${base}/`,
          audience: record.audience,
          clientId,
          nonce: record.nonce,
          provider
        })
      });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });

  return server;
}

async function followRedirect(url) {
  const res = await fetch(url, { redirect: "manual" });
  if (res.status !== 302) throw new Error(`expected provider redirect, got ${res.status}`);
  return res.headers.get("location");
}

async function runProvider(provider) {
  const clientId = `${provider}-sandbox-client`;
  const audience = `${provider}-sandbox-audience`;
  const idp = createFakeOidcProvider({ provider, clientId, audience });
  const issuer = await listen(idp);

  const envKeys = provider === "auth0"
    ? ["AUTH0_ISSUER", "AUTH0_CLIENT_ID", "AUTH0_AUDIENCE"]
    : ["OKTA_ISSUER", "OKTA_CLIENT_ID", "OKTA_AUDIENCE"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  if (provider === "auth0") {
    process.env.AUTH0_ISSUER = `${issuer}/`;
    process.env.AUTH0_CLIENT_ID = clientId;
    process.env.AUTH0_AUDIENCE = audience;
  } else {
    process.env.OKTA_ISSUER = issuer;
    process.env.OKTA_CLIENT_ID = clientId;
    process.env.OKTA_AUDIENCE = audience;
  }

  const harness = createHarness();
  const harnessBase = await listen(harness);

  try {
    const login = await fetch(`${harnessBase}/api/oauth/login?provider=${provider}&return=json`);
    const loginBody = await login.json();
    if (!login.ok) throw new Error(`${provider} login failed: ${JSON.stringify(loginBody)}`);

    const callbackUrl = await followRedirect(loginBody.authorizationUrl);
    const callback = await fetch(callbackUrl);
    const callbackBody = await callback.json();
    if (!callback.ok) throw new Error(`${provider} callback failed: ${JSON.stringify(callbackBody)}`);
    if (callbackBody.provider !== provider) throw new Error(`${provider} callback returned wrong provider.`);
    if (!callbackBody.authCommitment || !callbackBody.normalizedClaims?.computeScopes?.includes("compute:clinical")) {
      throw new Error(`${provider} did not produce a valid auth commitment.`);
    }

    return {
      provider,
      ok: true,
      issuer: loginBody.issuer,
      authCommitment: callbackBody.authCommitment,
      organization: callbackBody.normalizedClaims.organization,
      scopes: callbackBody.normalizedClaims.scopes
    };
  } finally {
    harness.close();
    idp.close();
    for (const key of envKeys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  }
}

const results = [];
for (const provider of ["auth0", "okta"]) {
  results.push(await runProvider(provider));
}

console.log(JSON.stringify({ ok: true, providers: results }, null, 2));
