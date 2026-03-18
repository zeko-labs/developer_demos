import { describe, expect, it } from "vitest";

import { assertEligibilityPolicy, validateProofInputIntegrity } from "../lib/prove-input.js";
import { commitmentHash, hashUtf8StringPoseidon } from "../lib/poseidon.js";
import { buildDisclosedFields } from "../lib/disclosure.js";

const REAL_RESPONSE_BODY =
  '{"employee_id":"EMP-001","annual_salary":85000,"hire_date":"2023-06-15","employment_status":"active"}';

const RESPONSE_BODY_HASH = hashUtf8StringPoseidon(REAL_RESPONSE_BODY).toString();

interface DisclosedFieldsFixture {
  source_profile?: string;
  salary: number;
  hire_date_unix: number;
  status_hash: string;
  response_body_hash: string;
  data_commitment: string;
  current_balance_cents?: number;
  available_balance_cents?: number;
  statement_as_of_unix?: number;
  account_status_hash?: string;
  ecdsa_signature: {
    r: string;
    s: string;
  };
  session_header_bytes: string;
  notary_public_key: {
    x: string;
    y: string;
  };
}

const STATUS_HASH = hashUtf8StringPoseidon("active");
const DATA_COMMITMENT = commitmentHash(
  85_000,
  1_686_787_200_000,
  STATUS_HASH,
  hashUtf8StringPoseidon(REAL_RESPONSE_BODY),
).toString();

const VALID_FIXTURE: DisclosedFieldsFixture = {
  salary: 85_000,
  hire_date_unix: 1_686_787_200_000,
  status_hash: STATUS_HASH.toString(),
  response_body_hash: RESPONSE_BODY_HASH,
  data_commitment: DATA_COMMITMENT,
  ecdsa_signature: {
    r: "10d2cd6d0473c33419478bf071c5b97a3f93f5e9b69db1102f0217c3cd3b3715",
    s: "1d5d94fe820061e7f6f90a04147a1984294e397f999bc2850b7ef2f19c8853d8",
  },
  session_header_bytes:
    "46825a9e1e4db04dea5516d0dffe7c4000000000022048e82c788b93ad9ea5fcb1d26a41842b429f88278727497e491e1987517da559",
  notary_public_key: {
    x: "fac7d8ab2d097d429f572a77ce324add36ccad426425b68cd54777b6f261ca14",
    y: "0f0e1b6a6998bc97e853edd33c919ff3028b9cc1da02bd7236079e74847ba0b2",
  },
};

function buildFixture(): DisclosedFieldsFixture {
  return {
    ...VALID_FIXTURE,
    ecdsa_signature: {
      ...VALID_FIXTURE.ecdsa_signature,
    },
    notary_public_key: {
      ...VALID_FIXTURE.notary_public_key,
    },
  };
}

describe("prove input integrity", () => {
  it("Given valid disclosed fields When integrity is validated Then proving preflight passes", () => {
    const fixture = buildFixture();

    const statusHash = hashUtf8StringPoseidon("active");
    const responseBodyHash = hashUtf8StringPoseidon(REAL_RESPONSE_BODY);
    const recomputedCommitment = commitmentHash(
      fixture.salary,
      fixture.hire_date_unix,
      statusHash,
      responseBodyHash,
    ).toString();
    expect(recomputedCommitment).toBe(fixture.data_commitment);

    expect(() => validateProofInputIntegrity(fixture)).not.toThrow();
  });

  it("Given a tampered session header When integrity is validated Then ECDSA mismatch fails fast", () => {
    const fixture = buildFixture();
    const tampered = {
      ...fixture,
      session_header_bytes: fixture.session_header_bytes.slice(0, -2) + "00",
    };

    expect(() => validateProofInputIntegrity(tampered)).toThrow(
      /ecdsa signature does not match session header bytes/i,
    );
  });

  it("Given salary below required threshold When eligibility policy is validated Then it fails with salary diagnostics", () => {
    const fixture = buildFixture();

    expect(() =>
      assertEligibilityPolicy({
        ...fixture,
        salary: 49_999,
      }),
    ).toThrow(/salary .* below required minimum/i);
  });

  it("Given tenure below required threshold When eligibility policy is validated Then it fails with tenure diagnostics", () => {
    const fixture = buildFixture();

    expect(() =>
      assertEligibilityPolicy({
        ...fixture,
        hire_date_unix: Date.UTC(2026, 1, 10),
      }),
    ).toThrow(/tenure .* below required minimum/i);
  });

  it("Given status hash mismatch When eligibility policy is validated Then it fails with status diagnostics", () => {
    const fixture = buildFixture();

    expect(() =>
      assertEligibilityPolicy({
        ...fixture,
        status_hash: hashUtf8StringPoseidon("inactive").toString(),
      }),
    ).toThrow(/status hash mismatch/i);
  });

  it("Given a valid signature under an untrusted key When integrity is validated Then it fails with trusted-key diagnostics", () => {
    const fixture = buildFixture();

    expect(() =>
      validateProofInputIntegrity({
        ...fixture,
        notary_public_key: {
          ...fixture.notary_public_key,
          x: fixture.notary_public_key.x.slice(0, -1) + "f",
        },
      }),
    ).toThrow(/notary public key does not match trusted key/i);
  });

  it("Given fabricated salary values with valid ECDSA signature When off-chain verifier re-derives commitment from response body Then fabricated data commitment does not match real commitment", () => {
    const realAttestation = {
      session_header_bytes_hex: VALID_FIXTURE.session_header_bytes,
      signature: {
        r_hex: VALID_FIXTURE.ecdsa_signature.r,
        s_hex: VALID_FIXTURE.ecdsa_signature.s,
      },
      notary_public_key: {
        x_hex: VALID_FIXTURE.notary_public_key.x,
        y_hex: VALID_FIXTURE.notary_public_key.y,
      },
      response_body: REAL_RESPONSE_BODY,
      server_name: "localhost",
      timestamp: 1700000000,
    };

    const realDisclosed = buildDisclosedFields(realAttestation);

    const fabricatedSalary = 999_999;
    const fabricatedStatusHash = hashUtf8StringPoseidon("active");
    const fabricatedHireDateUnix = 1_686_787_200_000;
    const responseBodyHash = hashUtf8StringPoseidon(realAttestation.response_body);
    const fabricatedCommitment = commitmentHash(
      fabricatedSalary,
      fabricatedHireDateUnix,
      fabricatedStatusHash,
      responseBodyHash,
    ).toString();

    expect(fabricatedCommitment).not.toBe(realDisclosed.data_commitment);

    const realCommitmentFromBody = commitmentHash(
      realDisclosed.salary,
      realDisclosed.hire_date_unix,
      hashUtf8StringPoseidon("active"),
      responseBodyHash,
    ).toString();
    expect(realCommitmentFromBody).toBe(realDisclosed.data_commitment);
  });

  it("Given valid bank disclosed fields When integrity is validated Then proving preflight passes", () => {
    const responseBody =
      '{"account_id":"BANK-001","current_balance_cents":125000,"available_balance_cents":120000,"currency":"USD","account_status":"active","kyc_passed":true,"as_of_date":"2026-02-18"}';
    const responseBodyHash = hashUtf8StringPoseidon(responseBody);
    const statusHash = hashUtf8StringPoseidon("active|kyc:true");
    const statementAsOfUnix = Date.UTC(2026, 1, 18);
    const fixture = {
      ...buildFixture(),
      source_profile: "bank",
      salary: 125_000,
      hire_date_unix: statementAsOfUnix,
      status_hash: statusHash.toString(),
      response_body_hash: responseBodyHash.toString(),
      data_commitment: commitmentHash(
        125_000,
        statementAsOfUnix,
        statusHash,
        responseBodyHash,
      ).toString(),
      current_balance_cents: 125_000,
      available_balance_cents: 120_000,
      statement_as_of_unix: statementAsOfUnix,
      account_status_hash: statusHash.toString(),
    };

    expect(() => validateProofInputIntegrity(fixture)).not.toThrow();
    expect(() => assertEligibilityPolicy(fixture)).not.toThrow();
  });

  it("Given bank balance below required threshold When eligibility policy is validated Then it fails with balance diagnostics", () => {
    const responseBodyHash = hashUtf8StringPoseidon(
      '{"account_id":"BANK-001","current_balance_cents":9000,"available_balance_cents":9000,"currency":"USD","account_status":"active","kyc_passed":true,"as_of_date":"2026-02-18"}',
    );
    const statusHash = hashUtf8StringPoseidon("active|kyc:true");
    const fixture = {
      ...buildFixture(),
      source_profile: "bank",
      salary: 9_000,
      hire_date_unix: Date.UTC(2026, 1, 18),
      status_hash: statusHash.toString(),
      response_body_hash: responseBodyHash.toString(),
      data_commitment: commitmentHash(
        9_000,
        Date.UTC(2026, 1, 18),
        statusHash,
        responseBodyHash,
      ).toString(),
      current_balance_cents: 9_000,
      available_balance_cents: 9_000,
      statement_as_of_unix: Date.UTC(2026, 1, 18),
      account_status_hash: statusHash.toString(),
    };

    expect(() => assertEligibilityPolicy(fixture)).toThrow(/balance .* below required minimum/i);
  });

  it("Given bank status hash mismatch When eligibility policy is validated Then it fails with bank status diagnostics", () => {
    const responseBodyHash = hashUtf8StringPoseidon(
      '{"account_id":"BANK-001","current_balance_cents":125000,"available_balance_cents":120000,"currency":"USD","account_status":"active","kyc_passed":false,"as_of_date":"2026-02-18"}',
    );
    const actualStatusHash = hashUtf8StringPoseidon("active|kyc:false");
    const fixture = {
      ...buildFixture(),
      source_profile: "bank",
      salary: 125_000,
      hire_date_unix: Date.UTC(2026, 1, 18),
      status_hash: actualStatusHash.toString(),
      response_body_hash: responseBodyHash.toString(),
      data_commitment: commitmentHash(
        125_000,
        Date.UTC(2026, 1, 18),
        actualStatusHash,
        responseBodyHash,
      ).toString(),
      current_balance_cents: 125_000,
      available_balance_cents: 120_000,
      statement_as_of_unix: Date.UTC(2026, 1, 18),
      account_status_hash: actualStatusHash.toString(),
    };

    expect(() => assertEligibilityPolicy(fixture)).toThrow(/account status hash mismatch/i);
  });
});
