import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BANK_ACCOUNT_RECORD,
  EMPLOYEE_RECORD,
  INELIGIBLE_EMPLOYEE_RECORD,
  INELIGIBLE_BANK_ACCOUNT_RECORD,
  TLS_VERSION_OPTIONS,
  createTlsServerOptions,
} from "../server.js";

describe("mock server configuration", () => {
  it("Given mock server constants When inspected Then TLS is forced to 1.2", () => {
    expect(TLS_VERSION_OPTIONS.minVersion).toBe("TLSv1.2");
    expect(TLS_VERSION_OPTIONS.maxVersion).toBe("TLSv1.2");
  });

  it("Given employee endpoint fixture When inspected Then required fields are present", () => {
    expect(EMPLOYEE_RECORD.employee_id).toBe("EMP-001");
    expect(EMPLOYEE_RECORD.annual_salary).toBe(85000);
    expect(EMPLOYEE_RECORD.employment_status).toBe("active");
  });

  it("Given ineligible employee endpoint fixture When inspected Then salary is below policy minimum", () => {
    expect(INELIGIBLE_EMPLOYEE_RECORD.employee_id).toBe("EMP-002");
    expect(INELIGIBLE_EMPLOYEE_RECORD.annual_salary).toBeLessThan(50_000);
    expect(INELIGIBLE_EMPLOYEE_RECORD.employment_status).toBe("active");
  });

  it("Given bank balance endpoint fixture When inspected Then required balance and KYC fields are present", () => {
    expect(BANK_ACCOUNT_RECORD.account_id).toBe("BANK-001");
    expect(BANK_ACCOUNT_RECORD.current_balance_cents).toBeGreaterThanOrEqual(10_000);
    expect(BANK_ACCOUNT_RECORD.account_status).toBe("active");
    expect(BANK_ACCOUNT_RECORD.kyc_passed).toBe(true);
  });

  it("Given ineligible bank balance endpoint fixture When inspected Then balance or KYC falls below policy", () => {
    expect(INELIGIBLE_BANK_ACCOUNT_RECORD.account_id).toBe("BANK-002");
    expect(INELIGIBLE_BANK_ACCOUNT_RECORD.current_balance_cents).toBeLessThan(10_000);
    expect(INELIGIBLE_BANK_ACCOUNT_RECORD.kyc_passed).toBe(false);
  });

  it("Given invalid cert and key paths When TLS server options are loaded Then fail-fast diagnostics include file paths", () => {
    expect(() =>
      createTlsServerOptions({
        certPath: "/tmp/does-not-exist-cert.pem",
        keyPath: "/tmp/does-not-exist-key.pem",
      }),
    ).toThrow(/failed to read TLS cert file at \/tmp\/does-not-exist-cert\.pem/);
  });

  it("Given readable cert and key files When TLS server options are loaded Then TLS 1.2 options are preserved", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "mock-server-cert-fixture-"));
    const certPath = join(fixtureDir, "cert.pem");
    const keyPath = join(fixtureDir, "key.pem");
    writeFileSync(certPath, "CERTIFICATE-DATA", "utf8");
    writeFileSync(keyPath, "KEY-DATA", "utf8");

    const options = createTlsServerOptions({
      certPath,
      keyPath,
    });

    expect(options.minVersion).toBe("TLSv1.2");
    expect(options.maxVersion).toBe("TLSv1.2");
  });
});
