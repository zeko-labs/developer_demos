import { Field } from "o1js";

import { type AttestationJson, parseAttestationJson } from "./attestation.js";
import { type SourceProfile } from "./poc-security-config.js";
import { commitmentHash, hashUtf8StringPoseidon } from "./poseidon.js";

export interface DisclosedFields {
  source_profile: SourceProfile;
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

interface EmployeePayload {
  annual_salary: number;
  hire_date: string;
  employment_status: string;
}

interface BankPayload {
  current_balance_cents: number;
  available_balance_cents: number;
  currency: string;
  account_status: string;
  kyc_passed: boolean;
  as_of_date: string;
}

function parseEmployeePayload(responseBody: string): EmployeePayload {
  const parsed = JSON.parse(responseBody) as Partial<EmployeePayload>;

  if (typeof parsed.annual_salary !== "number") {
    throw new Error("response_body.annual_salary must be a number");
  }
  if (typeof parsed.hire_date !== "string") {
    throw new Error("response_body.hire_date must be a string");
  }
  if (typeof parsed.employment_status !== "string") {
    throw new Error("response_body.employment_status must be a string");
  }

  return {
    annual_salary: parsed.annual_salary,
    hire_date: parsed.hire_date,
    employment_status: parsed.employment_status,
  };
}

function parseBankPayload(responseBody: string): BankPayload {
  const parsed = JSON.parse(responseBody) as Partial<BankPayload>;

  if (typeof parsed.current_balance_cents !== "number") {
    throw new Error("response_body.current_balance_cents must be a number");
  }
  if (typeof parsed.available_balance_cents !== "number") {
    throw new Error("response_body.available_balance_cents must be a number");
  }
  if (typeof parsed.currency !== "string") {
    throw new Error("response_body.currency must be a string");
  }
  if (typeof parsed.account_status !== "string") {
    throw new Error("response_body.account_status must be a string");
  }
  if (typeof parsed.kyc_passed !== "boolean") {
    throw new Error("response_body.kyc_passed must be a boolean");
  }
  if (typeof parsed.as_of_date !== "string") {
    throw new Error("response_body.as_of_date must be a string");
  }

  return {
    current_balance_cents: parsed.current_balance_cents,
    available_balance_cents: parsed.available_balance_cents,
    currency: parsed.currency,
    account_status: parsed.account_status,
    kyc_passed: parsed.kyc_passed,
    as_of_date: parsed.as_of_date,
  };
}

function toUnixMsUtc(dateIso: string): number {
  const ts = Date.parse(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(ts)) {
    throw new Error(`invalid hire_date: ${dateIso}`);
  }

  return ts;
}

export function buildDisclosedFields(attestationInput: unknown): DisclosedFields {
  const attestation: AttestationJson = parseAttestationJson(attestationInput);
  const parsed = JSON.parse(attestation.response_body) as Record<string, unknown>;
  const isBankPayload =
    typeof parsed.current_balance_cents === "number" ||
    typeof parsed.available_balance_cents === "number";

  if (isBankPayload) {
    const bank = parseBankPayload(attestation.response_body);
    const statementAsOfUnix = toUnixMsUtc(bank.as_of_date);
    const statusHash = hashUtf8StringPoseidon(
      `${bank.account_status}|kyc:${bank.kyc_passed ? "true" : "false"}`,
    );
    const responseBodyHash = hashUtf8StringPoseidon(attestation.response_body);
    const dataCommitment = commitmentHash(
      bank.current_balance_cents,
      statementAsOfUnix,
      statusHash,
      responseBodyHash,
    );

    return {
      source_profile: "bank",
      salary: bank.current_balance_cents,
      hire_date_unix: statementAsOfUnix,
      status_hash: statusHash.toString(),
      response_body_hash: responseBodyHash.toString(),
      data_commitment: dataCommitment.toString(),
      current_balance_cents: bank.current_balance_cents,
      available_balance_cents: bank.available_balance_cents,
      statement_as_of_unix: statementAsOfUnix,
      account_status_hash: statusHash.toString(),
      ecdsa_signature: {
        r: attestation.signature.r_hex,
        s: attestation.signature.s_hex,
      },
      session_header_bytes: attestation.session_header_bytes_hex,
      notary_public_key: {
        x: attestation.notary_public_key.x_hex,
        y: attestation.notary_public_key.y_hex,
      },
    };
  }

  const employee = parseEmployeePayload(attestation.response_body);

  const hireDateUnix = toUnixMsUtc(employee.hire_date);
  const statusHash = hashUtf8StringPoseidon(employee.employment_status);
  const responseBodyHash = hashUtf8StringPoseidon(attestation.response_body);
  const dataCommitment = commitmentHash(
    employee.annual_salary,
    hireDateUnix,
    statusHash,
    responseBodyHash,
  );

  return {
    source_profile: "employment",
    salary: employee.annual_salary,
    hire_date_unix: hireDateUnix,
    status_hash: statusHash.toString(),
    response_body_hash: responseBodyHash.toString(),
    data_commitment: dataCommitment.toString(),
    ecdsa_signature: {
      r: attestation.signature.r_hex,
      s: attestation.signature.s_hex,
    },
    session_header_bytes: attestation.session_header_bytes_hex,
    notary_public_key: {
      x: attestation.notary_public_key.x_hex,
      y: attestation.notary_public_key.y_hex,
    },
  };
}

export function statusHashToField(value: string): Field {
  return Field(value);
}
