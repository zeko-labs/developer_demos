export const THIRTY_DAYS_MS = 2_592_000_000;

export interface EligibilityInput {
  salary: number;
  minSalary: number;
  hireDateUnixMs: number;
  currentDateUnixMs: number;
  minTenureMonths: number;
  statusHash: string;
  requiredStatusHash: string;
}

export function tenureMonthsFromUnixMs(hireDateUnixMs: number, currentDateUnixMs: number): number {
  if (currentDateUnixMs < hireDateUnixMs) {
    throw new Error("current date cannot be before hire date");
  }

  return Math.floor((currentDateUnixMs - hireDateUnixMs) / THIRTY_DAYS_MS);
}

export function evaluateEligibility(input: EligibilityInput): boolean {
  if (input.salary < input.minSalary) {
    return false;
  }

  if (input.statusHash !== input.requiredStatusHash) {
    return false;
  }

  return (
    tenureMonthsFromUnixMs(input.hireDateUnixMs, input.currentDateUnixMs) >= input.minTenureMonths
  );
}
