import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("contract and circuit security contracts", () => {
  it("Given VerificationRegistry source When inspected Then decorator-based state and method declarations are used with EligibilityProof verification", () => {
    const source = readFileSync("poc/contracts/VerificationRegistry.ts", "utf8");

    expect(source).toMatch(/@state\(Field\)\s+lastProofHash\s*=\s*State<Field>\(\)/);
    expect(source).toMatch(/@state\(Field\)\s+lastResult\s*=\s*State<Field>\(\)/);
    expect(source).toMatch(/@method\s+async\s+recordVerification\(/);
    expect(source).toMatch(
      /async recordVerification\(proofHash: Field,\s*proof: EligibilityProof\)/,
    );
    expect(source).toMatch(/proof\.verify\(\)/);
    expect(source).not.toMatch(/\bdeclareState\s*\(/);
    expect(source).not.toMatch(/\bdeclareMethods\s*\(/);
  });

  it("Given eligibility circuit source When inspected Then private inputs include responseBodyHash and exclude prover-chosen notary key and policy parameters", () => {
    const source = readFileSync("poc/circuits/eligibility.ts", "utf8");

    expect(source).toMatch(
      /privateInputs:\s*\[\s*UInt64,\s*UInt64,\s*Field,\s*Field,\s*EcdsaSignature,\s*SessionHeaderBytes\s*\]/s,
    );
    expect(source).toMatch(/TRUSTED_NOTARY_PUBLIC_KEY_X_HEX/);
    expect(source).toMatch(/TRUSTED_NOTARY_PUBLIC_KEY_Y_HEX/);
    expect(source).not.toMatch(/\bnotaryPublicKey\b/);
    expect(source).not.toMatch(/\bminSalary\b/);
    expect(source).not.toMatch(/\bminTenureMonths\b/);
    expect(source).not.toMatch(/\bcurrentDateUnix\b/);
    expect(source).not.toMatch(/\brequiredStatusHash\b/);
  });

  it("Given eligibility circuit source When inspected Then publicOutput uses EligibilityOutput struct with eligible and responseBodyHash", () => {
    const source = readFileSync("poc/circuits/eligibility.ts", "utf8");

    expect(source).toMatch(/class\s+EligibilityOutput\s+extends\s+Struct/);
    expect(source).toMatch(/eligible:\s*Bool/);
    expect(source).toMatch(/responseBodyHash:\s*Field/);
    expect(source).toMatch(/publicOutput:\s*EligibilityOutput/);
  });

  it("Given disclosure module source When inspected Then DisclosedFields includes response_body_hash", () => {
    const source = readFileSync("poc/lib/disclosure.ts", "utf8");

    expect(source).toMatch(/response_body_hash:\s*string/);
    expect(source).toMatch(/hashUtf8StringPoseidon\(.*response_body\)/s);
  });

  it("Given verify module source When inspected Then off-chain attestation binding check is performed", () => {
    const source = readFileSync("poc/verify.ts", "utf8");

    expect(source).toMatch(/responseBodyHash/);
    expect(source).toMatch(/attestation/i);
  });
});
