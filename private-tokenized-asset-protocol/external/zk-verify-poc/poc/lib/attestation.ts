export interface AttestationJson {
  session_header_bytes_hex: string;
  signature: {
    r_hex: string;
    s_hex: string;
  };
  notary_public_key: {
    x_hex: string;
    y_hex: string;
  };
  response_body: string;
  server_name: string;
  timestamp: number;
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function assertNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }

  return value;
}

export function normalizeHex(value: string): string {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (
    normalized.length === 0 ||
    normalized.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(normalized)
  ) {
    throw new Error("invalid hex payload");
  }

  return normalized.toLowerCase();
}

export function splitCompactSignatureHex(signatureHex: string): { rHex: string; sHex: string } {
  const normalized = normalizeHex(signatureHex);
  if (normalized.length !== 128) {
    throw new Error("expected compact secp256k1 signature hex to be 64 bytes");
  }

  return {
    rHex: normalized.slice(0, 64),
    sHex: normalized.slice(64),
  };
}

export function parseAttestationJson(input: unknown): AttestationJson {
  if (typeof input !== "object" || input === null) {
    throw new Error("attestation payload must be an object");
  }

  const candidate = input as Record<string, unknown>;
  const signature = candidate.signature as Record<string, unknown>;
  const notaryPublicKey = candidate.notary_public_key as Record<string, unknown>;

  return {
    session_header_bytes_hex: normalizeHex(
      assertString(candidate.session_header_bytes_hex, "session_header_bytes_hex"),
    ),
    signature: {
      r_hex: normalizeHex(assertString(signature?.r_hex, "signature.r_hex")),
      s_hex: normalizeHex(assertString(signature?.s_hex, "signature.s_hex")),
    },
    notary_public_key: {
      x_hex: normalizeHex(assertString(notaryPublicKey?.x_hex, "notary_public_key.x_hex")),
      y_hex: normalizeHex(assertString(notaryPublicKey?.y_hex, "notary_public_key.y_hex")),
    },
    response_body: assertString(candidate.response_body, "response_body"),
    server_name: assertString(candidate.server_name, "server_name"),
    timestamp: assertNumber(candidate.timestamp, "timestamp"),
  };
}
