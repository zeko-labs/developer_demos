import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("ui spa contracts", () => {
  it("Given Cloudflare Worker static deployment requirements When inspecting wrangler config Then worker entrypoint and static assets binding are configured", () => {
    const wranglerPath = resolve(process.cwd(), "ui/wrangler.jsonc");
    expect(existsSync(wranglerPath)).toBe(true);

    const source = readFileSync(wranglerPath, "utf8");
    expect(source).toMatch(/"main"\s*:\s*"\.\/\.output\/server\/index\.mjs"/);
    expect(source).toMatch(/"binding"\s*:\s*"ASSETS"/);
    expect(source).toMatch(/"directory"\s*:\s*"\.\/\.output\/public"/);
  });

  it("Given deploy workflow requirements When inspecting ui Moon tasks Then ui:deploy depends on ui:build", () => {
    const moonPath = resolve(process.cwd(), "ui/moon.yml");
    expect(existsSync(moonPath)).toBe(true);

    const source = readFileSync(moonPath, "utf8");
    expect(source).toMatch(/deploy:\s*\n(?:\s+.*\n)*\s+deps:\s*\n\s+-\s*["']ui:build["']/m);
  });
});
