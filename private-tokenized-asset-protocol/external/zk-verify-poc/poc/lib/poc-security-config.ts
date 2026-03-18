import { createECDH } from "node:crypto";

export const SESSION_HEADER_LENGTH_BYTES = 54;
export const CURRENT_DATE_UNIX_MS = Date.UTC(2026, 1, 18);

export type SourceProfile = "employment" | "bank";

interface ProfilePolicy {
  minThreshold: number;
  minTenureMonths: number;
  requiredStatus: string;
}

export function resolveSourceProfile(value: string | undefined): SourceProfile {
  return value === "bank" ? "bank" : "employment";
}

export function policyForProfile(profile: SourceProfile): ProfilePolicy {
  if (profile === "bank") {
    return {
      minThreshold: 10_000,
      minTenureMonths: 0,
      requiredStatus: "active|kyc:true",
    };
  }

  return {
    minThreshold: 50_000,
    minTenureMonths: 12,
    requiredStatus: "active",
  };
}

const activeProfile = resolveSourceProfile(process.env.POC_SOURCE_PROFILE);
const activePolicy = policyForProfile(activeProfile);

export const MIN_SALARY = activePolicy.minThreshold;
export const MIN_TENURE_MONTHS = activePolicy.minTenureMonths;
export const REQUIRED_EMPLOYMENT_STATUS = activePolicy.requiredStatus;

function normalizePrivateKeyHex(value: string): string {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("trusted notary private key must be 32-byte hex");
  }
  return normalized.toLowerCase();
}

function deriveTrustedNotaryPublicKey():
  | {
      x: string;
      y: string;
    }
  | undefined {
  const privateKeyHex =
    process.env.TRUSTED_NOTARY_PRIVATE_KEY_HEX || process.env.TLSNOTARY_SIGNING_KEY_HEX;
  if (!privateKeyHex) {
    return undefined;
  }

  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(normalizePrivateKeyHex(privateKeyHex), "hex"));
  const publicKey = ecdh.getPublicKey(undefined, "uncompressed");
  return {
    x: publicKey.subarray(1, 33).toString("hex"),
    y: publicKey.subarray(33, 65).toString("hex"),
  };
}

const derivedTrustedNotaryPublicKey = deriveTrustedNotaryPublicKey();

export const TRUSTED_NOTARY_PUBLIC_KEY_X_HEX =
  derivedTrustedNotaryPublicKey?.x ||
  "fac7d8ab2d097d429f572a77ce324add36ccad426425b68cd54777b6f261ca14";
export const TRUSTED_NOTARY_PUBLIC_KEY_Y_HEX =
  derivedTrustedNotaryPublicKey?.y ||
  "0f0e1b6a6998bc97e853edd33c919ff3028b9cc1da02bd7236079e74847ba0b2";
