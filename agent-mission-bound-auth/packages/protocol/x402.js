import { decodeJson, encodeJson, hmacSha256Hex, id, sha256Hex } from "./digest.js";
import { enabledRails, findRail } from "./rails.js";

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
  const { authorizationDigest: _authorizationDigest, ...rest } = payload;
  return rest;
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

export function verifyPayment(requirement, payment) {
  if (!payment || typeof payment !== "object") {
    return { ok: false, reason: "Missing x402 payment payload." };
  }

  const option = requirement.accepts.find((item) => (
    item.railId === payment.railId &&
    item.settlementRail === payment.settlementRail &&
    item.network === payment.networkId &&
    item.amount === payment.amount &&
    item.payTo === payment.payTo
  ));

  if (!option) {
    return { ok: false, reason: "Payment does not match any advertised x402 rail." };
  }

  if (payment.requestId !== requirement.requestId) {
    return { ok: false, reason: "Payment requestId does not match the requirement." };
  }

  if (Date.parse(payment.expiresAtIso) <= Date.now()) {
    return { ok: false, reason: "Payment authorization has expired." };
  }

  const expectedDigest = buildAuthorizationDigest(stripAuthorizationDigest(payment));
  if (expectedDigest !== payment.authorizationDigest) {
    return { ok: false, reason: "Payment authorization digest is invalid." };
  }

  return {
    ok: true,
    rail: findRail(payment.railId),
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
      txHash: `0x${sha256Hex({ payment, settledAt: "mock-stable" }).slice(0, 64)}`,
      settledAt: new Date().toISOString(),
      mocked: true
    }
  };
}
