import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { encodeJson, decodeJson, sha256Hex } from "./digest.js";
import { isProductionProfile } from "./runtime.js";

const DEFAULT_PRIVATE_JWK = {
  kty: "EC",
  x: "6cZLhq1D-ymtzR7TUSCvLaZEJ-xYlF_Egs45kvUrpTY",
  y: "3cJRswFdlZFsa7myftv7zrSgFQn2_OUH91mKO_SUF6k",
  crv: "P-256",
  d: "2CplkGUdbHHC9KvvNP0PSyQR3McXr3OR5nhjGPSbOr4"
};

function privateJwk() {
  if (process.env.MISSION_AUTHORITY_PRIVATE_JWK) {
    return JSON.parse(process.env.MISSION_AUTHORITY_PRIVATE_JWK);
  }
  if (isProductionProfile()) {
    throw new Error("MISSION_AUTHORITY_PRIVATE_JWK is required in production profile.");
  }
  return DEFAULT_PRIVATE_JWK;
}

export function publicJwk() {
  const { d: _d, ...pub } = privateJwk();
  return {
    ...pub,
    kid: `mission-authority-${sha256Hex(pub).slice(0, 12)}`,
    alg: "ES256",
    use: "sig"
  };
}

export function jwks() {
  return { keys: [publicJwk()] };
}

export function signJws(payload, header = {}) {
  const jwk = privateJwk();
  const publicKey = publicJwk();
  const protectedHeader = {
    typ: "JWT",
    alg: "ES256",
    kid: publicKey.kid,
    ...header
  };
  const encodedHeader = encodeJson(protectedHeader);
  const encodedPayload = encodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey({ key: jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyJws(jws, jwkSet = jwks(), options = {}) {
  const [encodedHeader, encodedPayload, encodedSignature] = String(jws ?? "").split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("JWS must have three parts.");
  }
  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  if (header.alg !== "ES256") {
    throw new Error("JWS alg must be ES256.");
  }
  if (options.typ && header.typ !== options.typ) {
    throw new Error(`JWS typ must be ${options.typ}.`);
  }
  const key = jwkSet.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) {
    throw new Error(`No verification key found for kid ${header.kid}.`);
  }
  if (key.kty !== "EC" || key.crv !== "P-256") {
    throw new Error("JWS verification key must be P-256 EC.");
  }
  if (key.use && key.use !== "sig") {
    throw new Error("JWS verification key must be for signatures.");
  }
  if (key.alg && key.alg !== "ES256") {
    throw new Error("JWS verification key alg must be ES256.");
  }
  const ok = verify(
    "sha256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    {
      key: createPublicKey({ key, format: "jwk" }),
      dsaEncoding: "ieee-p1363"
    },
    Buffer.from(encodedSignature, "base64url")
  );
  if (!ok) throw new Error("JWS signature is invalid.");
  return { header, payload };
}
