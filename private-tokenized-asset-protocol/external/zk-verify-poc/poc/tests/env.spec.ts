import { describe, expect, it } from "vitest";

import { loadRuntimeEnv } from "../lib/env.js";

describe("env loading", () => {
  it("Given all required env vars When loaded Then config is returned", () => {
    const previous = { ...process.env };
    process.env.ZEKO_GRAPHQL_URL = "https://testnet.zeko.io/graphql";
    process.env.FEE_PAYER_PRIVATE_KEY = "private";
    process.env.FEE_PAYER_PUBLIC_KEY = "public";

    const config = loadRuntimeEnv({ loadDotenv: false });
    expect(config.zekoGraphqlUrl).toBe("https://testnet.zeko.io/graphql");

    process.env = previous;
  });

  it("Given a missing required env var When loaded Then it throws", () => {
    const previous = { ...process.env };
    delete process.env.ZEKO_GRAPHQL_URL;
    delete process.env.FEE_PAYER_PRIVATE_KEY;
    delete process.env.FEE_PAYER_PUBLIC_KEY;

    expect(() => loadRuntimeEnv({ loadDotenv: false })).toThrow();

    process.env = previous;
  });
});
