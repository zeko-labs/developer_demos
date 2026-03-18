import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("README output documentation", () => {
  it("Given output artifact docs When inspected Then timestamped runs and output/latest defaults are both documented", () => {
    const source = readFileSync("README.md", "utf8");

    expect(source).toMatch(/output\/<timestamp>/i);
    expect(source).toMatch(/output\/latest/i);
  });
});
