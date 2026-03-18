import { describe, expect, it } from "vitest";

import { evaluateEligibility, THIRTY_DAYS_MS, tenureMonthsFromUnixMs } from "../lib/eligibility.js";

describe("eligibility rules", () => {
  it("Given valid salary status and tenure When evaluated Then candidate is eligible", () => {
    const result = evaluateEligibility({
      salary: 85000,
      minSalary: 50000,
      hireDateUnixMs: Date.UTC(2023, 5, 15),
      currentDateUnixMs: Date.UTC(2025, 5, 15),
      minTenureMonths: 12,
      statusHash: "123",
      requiredStatusHash: "123",
    });

    expect(result).toBe(true);
  });

  it("Given current date before hire date When tenure is computed Then it throws", () => {
    expect(() => tenureMonthsFromUnixMs(10_000, 1_000)).toThrow();
  });

  it("Given 90 days span When tenure months computed Then floor-based months are returned", () => {
    expect(tenureMonthsFromUnixMs(0, THIRTY_DAYS_MS * 3 + 10)).toBe(3);
  });
});
