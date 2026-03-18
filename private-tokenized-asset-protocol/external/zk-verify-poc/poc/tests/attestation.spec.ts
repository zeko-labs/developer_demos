import { describe, expect, it } from "vitest";

import { parseAttestationJson, splitCompactSignatureHex } from "../lib/attestation.js";

describe("attestation helpers", () => {
  it("Given compact secp256k1 signature hex When split Then r and s are extracted", () => {
    const compactHex = "11".repeat(64);
    const split = splitCompactSignatureHex(compactHex);

    expect(split.rHex).toHaveLength(64);
    expect(split.sHex).toHaveLength(64);
    expect(split.rHex).toBe("11".repeat(32));
    expect(split.sHex).toBe("11".repeat(32));
  });

  it("Given invalid compact signature length When split Then it throws", () => {
    expect(() => splitCompactSignatureHex("ab".repeat(10))).toThrow();
  });

  it("Given a valid attestation payload When parsed Then required fields are returned", () => {
    const parsed = parseAttestationJson({
      session_header_bytes_hex: "aa",
      signature: { r_hex: "bb", s_hex: "cc" },
      notary_public_key: { x_hex: "dd", y_hex: "ee" },
      response_body:
        '{"annual_salary":85000,"hire_date":"2023-06-15","employment_status":"active"}',
      server_name: "localhost",
      timestamp: 1700000000,
    });

    expect(parsed.server_name).toBe("localhost");
    expect(parsed.signature.r_hex).toBe("bb");
  });
});
