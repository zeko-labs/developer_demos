import { decodeJson, encodeJson, hmacSha256Hex, id, sha256Hex } from "./digest.js";
import { enabledRails, findRail } from "./rails.js";
import { isProductionProfile } from "./runtime.js";
import { verifyJws } from "./authority-keys.js";

export const PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const PAYMENT = "PAYMENT";
export const PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

function baseUrl() {
  return process.env.BASE_URL ?? `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "8787"}`;
}

function paymentSecret() {
  return process.env.X402_DEMO_PAYMENT_SECRET ?? "local-x402-payment-secret";
}

function buildAuthorizationDigest(payload) {
  return sha256Hex(payload);
}

function stripAuthorizationDigest(payload) {
  const {
    authorizationDigest: _authorizationDigest,
    settlementProof: _settlementProof,
    facilitatorReceipt: _facilitatorReceipt,
    ...rest
  } = payload;
  return rest;
}

let cachedFacilitatorJwks = null;
let cachedFacilitatorJwksRaw = null;

function facilitatorJwks() {
  const raw = process.env.X402_FACILITATOR_JWKS_JSON;
  if (!raw) throw new Error("X402_FACILITATOR_JWKS_JSON is required for trusted facilitator receipts.");
  if (cachedFacilitatorJwks && cachedFacilitatorJwksRaw === raw) return cachedFacilitatorJwks;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.keys)) throw new Error("X402_FACILITATOR_JWKS_JSON must contain keys[].");
  cachedFacilitatorJwks = parsed;
  cachedFacilitatorJwksRaw = raw;
  return parsed;
}

function facilitatorClockToleranceSeconds() {
  const raw = process.env.X402_FACILITATOR_CLOCK_TOLERANCE_SECONDS ?? "60";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 300) {
    return { ok: false, reason: "X402_FACILITATOR_CLOCK_TOLERANCE_SECONDS must be a finite value between 0 and 300." };
  }
  return { ok: true, seconds: parsed };
}

function assertEqual(actual, expected, reason) {
  if (actual !== expected) return { ok: false, reason };
  return { ok: true };
}

function sameAsset(expected, actual) {
  if (actual === undefined || actual === null) return false;
  try {
    return sha256Hex(expected) === sha256Hex(actual);
  } catch {
    return false;
  }
}

function buildPaymentRequired(input) {
  return {
    protocol: "x402",
    version: "2",
    requestId: id("x402req", {
      serviceId: input.serviceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      accepts: input.rails.map((rail) => ({
        settlementRail: rail.settlementRail,
        network: rail.network,
        amount: rail.amount,
        asset: rail.asset,
        payTo: rail.payTo
      }))
    }),
    resource: `${input.baseUrl}/api/x402/proof?sessionId=${encodeURIComponent(input.sessionId)}`,
    description: input.description,
    mimeType: "application/json",
    seller: { serviceId: input.serviceId },
    accepts: input.rails.map((rail) => ({
      scheme: "exact",
      settlementRail: rail.settlementRail,
      network: rail.network,
      asset: rail.asset,
      price: rail.amount,
      amount: rail.amount,
      payTo: rail.payTo,
      settlementModel: rail.settlementModel,
      description: rail.description ?? input.description,
      mimeType: "application/json",
      outputSchema: {
        type: input.outputType,
        proofBundleUrl: input.proofBundleUrl,
        verifyUrl: input.verifyUrl
      },
      extensions: rail.extensions ?? {}
    }))
  };
}

export function buildPaymentRequirement(job) {
  const rails = enabledRails();
  const railByNetwork = new Map(rails.map((rail) => [rail.network, rail]));
  const requirement = buildPaymentRequired({
    serviceId: "agent-mission-bound-auth",
    baseUrl: baseUrl(),
    sessionId: job.jobId,
    turnId: job.operation,
    description: "Exact-price private compute over committed data with ZK-backed OAuth authorization.",
    outputType: "private-compute-receipt-v1",
    verifyUrl: `${baseUrl()}/api/x402/verify`,
    proofBundleUrl: `${baseUrl()}/api/compute/receipt`,
    rails
  });

  return {
    ...requirement,
    requestId: id("req", {
      upstreamRequestId: requirement.requestId,
      jobId: job.jobId,
      datasetId: job.datasetId,
      operation: job.operation
    }),
    accepts: requirement.accepts.map((option) => {
      const sourceRail = railByNetwork.get(option.network);
      return {
        ...option,
        railId: sourceRail?.id ?? option.network,
        chainName: sourceRail?.chainName ?? option.extensions?.evm?.chainName ?? option.network
      };
    })
  };
}

export function encodeRequirement(requirement) {
  return encodeJson(requirement);
}

export function decodePaymentHeader(header) {
  if (!header) return null;
  return decodeJson(header);
}

export function buildMockPayment(requirement, railId, payer = "demo-agent-wallet") {
  const option = requirement.accepts.find((item) => item.railId === railId);
  if (!option) {
    throw new Error(`Unknown rail ${railId}`);
  }

  const issuedAtIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const unsigned = {
    protocol: "x402",
    version: "2",
    requestId: requirement.requestId,
    paymentId: id("pay", { requestId: requirement.requestId, railId, payer, issuedAtIso }),
    scheme: "exact",
    settlementRail: option.settlementRail,
    railId,
    networkId: option.network,
    asset: option.asset,
    amount: option.amount,
    payer,
    payTo: option.payTo,
    sessionId: "demo-session",
    issuedAtIso,
    expiresAtIso,
    authorization: {
      primitive: option.settlementRail === "zeko" ? "zeko-signed-settlement-v1" : "eip3009-authorization-v1",
      settlementRail: option.settlementRail,
      mode: "mock-facilitator",
      authorizationHash: sha256Hex({ option, payer, issuedAtIso })
    }
  };
  const authorizationDigest = buildAuthorizationDigest(unsigned);
  const payload = { ...unsigned, authorizationDigest };

  return {
    payload,
    paymentHeader: encodeJson(payload),
    signature: hmacSha256Hex(paymentSecret(), payload)
  };
}

function verifySettlementProof(option, payment) {
  if (!isProductionProfile()) return { ok: true, mode: "demo" };
  if (payment.authorization?.mode === "mock-facilitator" || payment.mocked) {
    return { ok: false, reason: "Mock x402 payment authorization is disabled in production profile." };
  }
  const proof = payment.settlementProof ?? payment.facilitatorReceipt;
  if (!proof) {
    return { ok: false, reason: "Production x402 verification requires a settlement proof or facilitator receipt." };
  }
  if (proof.networkId && proof.networkId !== option.network) {
    return { ok: false, reason: "Settlement proof network does not match advertised rail." };
  }
  if (proof.payTo && proof.payTo !== option.payTo) {
    return { ok: false, reason: "Settlement proof payTo does not match advertised rail." };
  }
  if (proof.authorizationDigest && proof.authorizationDigest !== payment.authorizationDigest) {
    return { ok: false, reason: "Settlement proof digest does not match payment authorization." };
  }
  if (process.env.X402_TRUST_FACILITATOR_RECEIPTS !== "true") {
    return { ok: false, reason: "Live x402 settlement verifier is not configured." };
  }
  if (!process.env.X402_FACILITATOR_ISSUER) {
    return { ok: false, reason: "X402_FACILITATOR_ISSUER is required for trusted facilitator receipts." };
  }

  const receiptJws = proof.jws ?? proof.receiptJws;
  if (!receiptJws) {
    return { ok: false, reason: "Trusted facilitator receipts must include a signed receipt JWS." };
  }

  let receipt;
  try {
    receipt = verifyJws(receiptJws, facilitatorJwks(), { typ: "x402-facilitator-receipt+jwt" }).payload;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Facilitator receipt JWS is invalid." };
  }

  const expectedAudience = process.env.X402_FACILITATOR_AUDIENCE ?? "agent-mission-bound-auth";
  const checks = [
    assertEqual(receipt.iss, process.env.X402_FACILITATOR_ISSUER, "Facilitator receipt issuer mismatch."),
    assertEqual(receipt.aud, expectedAudience, "Facilitator receipt audience mismatch."),
    assertEqual(receipt.requestId, payment.requestId, "Facilitator receipt requestId mismatch."),
    assertEqual(receipt.paymentId, payment.paymentId, "Facilitator receipt paymentId mismatch."),
    assertEqual(receipt.railId, payment.railId, "Facilitator receipt railId mismatch."),
    assertEqual(receipt.settlementRail, payment.settlementRail, "Facilitator receipt settlement rail mismatch."),
    assertEqual(receipt.networkId, option.network, "Facilitator receipt network mismatch."),
    assertEqual(receipt.amount, option.amount, "Facilitator receipt amount mismatch."),
    assertEqual(receipt.assetHash, sha256Hex(option.asset), "Facilitator receipt asset mismatch."),
    assertEqual(receipt.payer, payment.payer, "Facilitator receipt payer mismatch."),
    assertEqual(receipt.payTo, option.payTo, "Facilitator receipt payTo mismatch."),
    assertEqual(receipt.authorizationDigest, payment.authorizationDigest, "Facilitator receipt authorization digest mismatch.")
  ];
  const failed = checks.find((check) => !check.ok);
  if (failed) return failed;
  const clockTolerance = facilitatorClockToleranceSeconds();
  if (!clockTolerance.ok) return clockTolerance;
  if (typeof receipt.exp !== "number" || receipt.exp <= Math.floor(Date.now() / 1000) - clockTolerance.seconds) {
    return { ok: false, reason: "Facilitator receipt is expired or missing exp." };
  }
  if (!receipt.txHash && !receipt.settlementId) {
    return { ok: false, reason: "Facilitator receipt must include txHash or settlementId." };
  }

  return { ok: true, mode: "trusted-facilitator-receipt", proof: receipt };
}

export function verifyPayment(requirement, payment) {
  if (!payment || typeof payment !== "object") {
    return { ok: false, reason: "Missing x402 payment payload." };
  }

  const option = requirement.accepts.find((item) => (
    item.railId === payment.railId &&
    item.settlementRail === payment.settlementRail &&
    item.network === payment.networkId &&
    item.amount === payment.amount &&
    sameAsset(item.asset, payment.asset) &&
    item.payTo === payment.payTo
  ));

  if (!option) {
    return { ok: false, reason: "Payment does not match any advertised x402 rail." };
  }

  if (payment.requestId !== requirement.requestId) {
    return { ok: false, reason: "Payment requestId does not match the requirement." };
  }

  const paymentExpiry = Date.parse(payment.expiresAtIso);
  if (Number.isNaN(paymentExpiry) || paymentExpiry <= Date.now()) {
    return { ok: false, reason: "Payment authorization has expired or has invalid expiry." };
  }

  const expectedDigest = buildAuthorizationDigest(stripAuthorizationDigest(payment));
  if (expectedDigest !== payment.authorizationDigest) {
    return { ok: false, reason: "Payment authorization digest is invalid." };
  }
  const settlementProof = verifySettlementProof(option, payment);
  if (!settlementProof.ok) {
    return settlementProof;
  }

  return {
    ok: true,
    rail: findRail(payment.railId),
    settlementProof: settlementProof.proof ?? null,
    paymentReceipt: {
      paymentId: payment.paymentId,
      requestId: payment.requestId,
      railId: payment.railId,
      networkId: payment.networkId,
      amount: payment.amount,
      asset: payment.asset,
      payer: payment.payer,
      payTo: payment.payTo,
      authorizationDigest: payment.authorizationDigest,
      txHash: settlementProof.proof?.txHash ?? `0x${sha256Hex({ payment, settledAt: "mock-stable" }).slice(0, 64)}`,
      settledAt: new Date().toISOString(),
      mocked: !isProductionProfile()
    }
  };
}
