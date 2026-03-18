import { afterEach, describe, expect, it, vi } from "vitest";

interface MockFetchAccountResult {
  account?: {
    nonce?: { toString(): string };
    zkapp?: {
      verificationKey?: {
        hash?: { toString(): string };
      };
    };
  };
  error?: {
    statusText: string;
  };
}

interface SettleTestState {
  deployMetadataWrites: Array<Record<string, unknown>>;
  errors: string[];
  exitCodes: number[];
  fetchAccountCalls: string[];
  fetchAccountResponses: MockFetchAccountResult[];
  logs: string[];
  recordVerificationCalls: Array<{ proofHash: unknown; proof: unknown }>;
  transactionCalls: number;
}

function stringifyConsoleArg(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function makeNonce(value: number): { toString(): string } {
  return {
    toString: () => value.toString(),
  };
}

function makeAccount(nonce: number, verificationKeyHash?: string): MockFetchAccountResult {
  return {
    account: {
      nonce: makeNonce(nonce),
      zkapp: verificationKeyHash
        ? {
            verificationKey: {
              hash: {
                toString: () => verificationKeyHash,
              },
            },
          }
        : undefined,
    },
  };
}

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function setupSettleMocks(options: {
  fetchAccountResponses: MockFetchAccountResult[];
  failIfTransactionRuns?: string;
}): SettleTestState {
  const state: SettleTestState = {
    deployMetadataWrites: [],
    errors: [],
    exitCodes: [],
    fetchAccountCalls: [],
    fetchAccountResponses: [...options.fetchAccountResponses],
    logs: [],
    recordVerificationCalls: [],
    transactionCalls: 0,
  };

  const publicKeyFactory = (base58: string) => ({
    toBase58: () => base58,
  });

  const privateKeyFactory = (base58: string) => ({
    toPublicKey: () => {
      if (base58 === "fee-payer-private-key") {
        return publicKeyFactory("fee-payer-public-key");
      }

      if (base58 === "zkapp-private-key") {
        return publicKeyFactory("zkapp-public-key");
      }

      return publicKeyFactory(`public:${base58}`);
    },
  });

  vi.doMock("o1js", () => ({
    AccountUpdate: {
      fundNewAccount: vi.fn(),
    },
    Field: vi.fn((value: number) => value),
    Mina: {
      Network: vi.fn((url: string) => ({ url })),
      setActiveInstance: vi.fn(),
      transaction: vi.fn(async (_txConfig: unknown, callback: () => Promise<void>) => {
        state.transactionCalls += 1;

        if (options.failIfTransactionRuns) {
          throw new Error(options.failIfTransactionRuns);
        }

        await callback();
        const txIndex = state.transactionCalls;

        return {
          prove: vi.fn(async () => {}),
          sign: vi.fn(() => ({
            send: vi.fn(async () => ({
              hash: txIndex === 1 ? "deploy-tx-hash" : "settle-tx-hash",
            })),
          })),
        };
      }),
    },
    Poseidon: {
      hash: vi.fn(() => ({
        toString: () => "proof-hash",
      })),
    },
    PrivateKey: {
      fromBase58: vi.fn((base58: string) => privateKeyFactory(base58)),
      random: vi.fn(() => privateKeyFactory("random-private-key")),
    },
    PublicKey: {
      fromBase58: vi.fn((base58: string) => publicKeyFactory(base58)),
    },
    fetchAccount: vi.fn(async ({ publicKey }: { publicKey: { toBase58(): string } }) => {
      state.fetchAccountCalls.push(publicKey.toBase58());
      const next = state.fetchAccountResponses.shift();
      if (!next) {
        throw new Error("unexpected fetchAccount call");
      }

      return next;
    }),
  }));

  vi.doMock("../circuits/eligibility.js", () => ({
    EligibilityProgram: {
      compile: vi.fn(async () => {}),
    },
    EligibilityProof: {
      fromJSON: vi.fn(async () => ({ kind: "eligibility-proof" })),
    },
  }));

  vi.doMock("../contracts/VerificationRegistry.js", () => {
    class MockVerificationRegistry {
      static compile = vi.fn(async () => ({
        verificationKey: {
          hash: {
            toString: () => "local-vk-hash",
          },
        },
      }));

      public constructor(_publicKey: unknown) {}

      public async deploy(_args: unknown): Promise<void> {}

      public async recordVerification(proofHash: unknown, proof: unknown): Promise<void> {
        state.recordVerificationCalls.push({ proofHash, proof });
      }
    }

    return {
      VerificationRegistry: MockVerificationRegistry,
    };
  });

  vi.doMock("../lib/env.js", () => ({
    loadRuntimeEnv: vi.fn(() => ({
      feePayerPrivateKey: "fee-payer-private-key",
      zekoGraphqlUrl: "https://example.test/graphql",
      zkappPrivateKey: "zkapp-private-key",
      zkappPublicKey: "zkapp-public-key",
    })),
  }));

  vi.doMock("../lib/io.js", () => ({
    readJsonFile: vi.fn(async () => ({
      proof: {
        maxProofsVerified: 0,
        proof: "proof-bytes",
        publicInput: [],
        publicOutput: [],
      },
    })),
    writeJsonFile: vi.fn(async () => {}),
  }));

  vi.doMock("../lib/paths.js", () => ({
    outputDir: vi.fn(() => "output/latest"),
  }));

  vi.doMock("../lib/deploy-metadata.js", () => ({
    writeDeployedAddressMetadata: vi.fn(async (payload: Record<string, unknown>) => {
      state.deployMetadataWrites.push(payload);
    }),
  }));

  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    state.logs.push(args.map(stringifyConsoleArg).join(" "));
  });

  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    state.errors.push(args.map(stringifyConsoleArg).join(" "));
  });

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    state.exitCodes.push(code ?? 0);
    return undefined as never;
  }) as unknown as typeof process.exit);

  return state;
}

async function runSettleScript(): Promise<void> {
  await import("../settle.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("settle reviewer regressions", () => {
  it("Given zkApp fetchAccount returns an error When settle runs Then it fails before verification-key mismatch comparison or auto-redeploy", async () => {
    const state = setupSettleMocks({
      fetchAccountResponses: [
        makeAccount(5),
        {
          error: {
            statusText: "zkapp lookup failed",
          },
        },
      ],
      failIfTransactionRuns: "Mina.transaction should not run for zkApp fetch errors",
    });

    await runSettleScript();
    await waitForCondition(() => state.errors.length > 0, "settle failure logging");

    expect(state.transactionCalls).toBe(0);
    expect(state.logs.some((line) => line.includes("Verification key mismatch"))).toBe(false);
    expect(state.errors.join("\n")).toContain("zkApp account fetch failed: zkapp lookup failed");
  });

  it("Given a settle-triggered redeploy from verification-key mismatch When redeploy succeeds Then deployed-address metadata is persisted via shared deploy metadata logic", async () => {
    const state = setupSettleMocks({
      fetchAccountResponses: [
        makeAccount(5),
        makeAccount(0, "on-chain-vk-hash"),
        makeAccount(6),
        makeAccount(7),
      ],
    });

    await runSettleScript();
    await waitForCondition(
      () => state.logs.some((line) => line.includes("Fee payer nonce advanced")),
      "settle success completion",
    );

    expect(state.deployMetadataWrites).toHaveLength(1);
    expect(state.deployMetadataWrites[0]).toMatchObject({
      alreadyDeployed: true,
      deployTxHash: "deploy-tx-hash",
      verificationKeyHash: "local-vk-hash",
      zkappPrivateKeyGenerated: false,
      zkappPublicKey: "zkapp-public-key",
    });
    expect(state.logs.some((line) => line.includes("Saved output/deployed-address.json"))).toBe(
      true,
    );
  });
});
