import { describe, expect, it } from "vitest";

import { outputDir } from "../lib/paths.js";

describe("output path contract", () => {
  it("Given OUTPUT_DIR is unset When resolving outputDir Then output/latest is used", () => {
    const previous = process.env.OUTPUT_DIR;
    delete process.env.OUTPUT_DIR;

    try {
      expect(outputDir()).toBe("output/latest");
    } finally {
      if (previous === undefined) {
        delete process.env.OUTPUT_DIR;
      } else {
        process.env.OUTPUT_DIR = previous;
      }
    }
  });
});
