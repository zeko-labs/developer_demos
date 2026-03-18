import { describe, expect, it } from "vitest";

import { buildDisclosedFields } from "../lib/disclosure.js";
import { hashUtf8StringPoseidon } from "../lib/poseidon.js";

describe("field extraction and disclosure", () => {
  it("Given attested employee payload When transformed Then disclosed fields and commitment are deterministic", () => {
    const disclosed = buildDisclosedFields({
      session_header_bytes_hex: "aa",
      signature: { r_hex: "bb", s_hex: "cc" },
      notary_public_key: { x_hex: "dd", y_hex: "ee" },
      response_body:
        '{"employee_id":"EMP-001","annual_salary":85000,"hire_date":"2023-06-15","employment_status":"active"}',
      server_name: "localhost",
      timestamp: 1700000000,
    });

    expect(disclosed.salary).toBe(85000);
    expect(disclosed.hire_date_unix).toBe(1686787200000);
    expect(disclosed.status_hash).toBe(hashUtf8StringPoseidon("active").toString());
    expect(disclosed.response_body_hash.length).toBeGreaterThan(0);
    expect(disclosed.data_commitment.length).toBeGreaterThan(0);
    expect(disclosed.ecdsa_signature.r).toBe("bb");
  });

  it("Given attested bank payload When transformed Then bank disclosed fields and aliases are deterministic", () => {
    const disclosed = buildDisclosedFields({
      session_header_bytes_hex: "aa",
      signature: { r_hex: "bb", s_hex: "cc" },
      notary_public_key: { x_hex: "dd", y_hex: "ee" },
      response_body:
        '{"account_id":"BANK-001","current_balance_cents":125000,"available_balance_cents":120000,"currency":"USD","account_status":"active","kyc_passed":true,"as_of_date":"2026-02-18"}',
      server_name: "localhost",
      timestamp: 1700000000,
    });

    expect(disclosed.source_profile).toBe("bank");
    expect(disclosed.current_balance_cents).toBe(125000);
    expect(disclosed.available_balance_cents).toBe(120000);
    expect(disclosed.statement_as_of_unix).toBe(1771372800000);
    expect(disclosed.account_status_hash).toBe(
      hashUtf8StringPoseidon("active|kyc:true").toString(),
    );
    expect(disclosed.salary).toBe(125000);
    expect(disclosed.hire_date_unix).toBe(1771372800000);
    expect(disclosed.status_hash).toBe(hashUtf8StringPoseidon("active|kyc:true").toString());
  });
});
