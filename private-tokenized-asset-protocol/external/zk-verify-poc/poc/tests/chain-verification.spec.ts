import { describe, expect, it } from "vitest";

import {
  assertGraphqlDeploymentState,
  extractGraphqlData,
  type GraphqlEventOutput,
} from "../lib/chain-verification.js";

describe("graphql deployment verification", () => {
  it("Given GraphQL errors When extracting data Then fail-fast diagnostics are returned", () => {
    expect(() =>
      extractGraphqlData<{ account: unknown }>(
        {
          errors: [{ message: "boom" }],
        },
        "account query",
      ),
    ).toThrow(/graphql account query failed: boom/i);
  });

  it("Given missing zkApp account data When asserting deployment state Then it fails", () => {
    expect(() =>
      assertGraphqlDeploymentState({
        feePayerPublicKey: "B62q-fee-payer",
        zkAppPublicKey: "B62q-zkapp",
        feePayerAccount: {
          publicKey: "B62q-fee-payer",
          nonce: "3",
          balance: { total: "100" },
        },
        zkAppAccount: null,
        events: [],
      }),
    ).toThrow(/zkapp account not found on node/i);
  });

  it("Given matching zkApp state and emitted event When asserting deployment state Then verification summary succeeds", () => {
    const events: GraphqlEventOutput[] = [
      {
        eventData: [
          {
            data: ["1234", "1"],
            transactionInfo: {
              hash: "5JtxHash",
              memo: "",
              status: '["Applied"]',
            },
          },
        ],
      },
    ];

    const summary = assertGraphqlDeploymentState({
      feePayerPublicKey: "B62q-fee-payer",
      zkAppPublicKey: "B62q-zkapp",
      feePayerAccount: {
        publicKey: "B62q-fee-payer",
        nonce: "3",
        balance: { total: "100" },
      },
      zkAppAccount: {
        publicKey: "B62q-zkapp",
        nonce: "1",
        balance: { total: "0" },
        provedState: true,
        zkappState: ["1234", "1", "0", "0", "0", "0", "0", "0"],
        verificationKey: {
          hash: "999",
        },
      },
      events,
      expectedProofHash: "1234",
    });

    expect(summary.settlementTxHash).toBe("5JtxHash");
    expect(summary.zkAppProofHash).toBe("1234");
    expect(summary.zkAppResult).toBe("1");
  });

  it("Given expected proof hash mismatch When asserting deployment state Then it fails with mismatch diagnostics", () => {
    const events: GraphqlEventOutput[] = [
      {
        eventData: [
          {
            data: ["1234", "1"],
            transactionInfo: {
              hash: "5JtxHash",
              memo: "",
              status: '["Applied"]',
            },
          },
        ],
      },
    ];

    expect(() =>
      assertGraphqlDeploymentState({
        feePayerPublicKey: "B62q-fee-payer",
        zkAppPublicKey: "B62q-zkapp",
        feePayerAccount: {
          publicKey: "B62q-fee-payer",
          nonce: "3",
          balance: { total: "100" },
        },
        zkAppAccount: {
          publicKey: "B62q-zkapp",
          nonce: "1",
          balance: { total: "0" },
          provedState: true,
          zkappState: ["1234", "1", "0", "0", "0", "0", "0", "0"],
          verificationKey: {
            hash: "999",
          },
        },
        events,
        expectedProofHash: "7777",
      }),
    ).toThrow(/expected proof hash 7777 does not match on-chain state 1234/i);
  });
});
