import { sha256Hex } from "./digest.js";
import { RAILS } from "./rails.js";

export function buildZekoContractPlan() {
  const zekoRail = RAILS.zeko;
  return {
    contract: {
      name: "PrivateComputeAccess",
      source: "zkapp/PrivateComputeAccess.ts",
      networkId: "zeko:testnet",
      graphql: zekoRail.extensions?.zeko?.graphql,
      archive: zekoRail.extensions?.zeko?.archive
    },
    state: {
      datasetRoot: "Field",
      authRoot: "Field",
      receiptRoot: "Field",
      beneficiary: "PublicKey"
    },
    methods: [
      "configureBeneficiary(PublicKey)",
      "registerDatasetCommitment(previousRoot, nextRoot)",
      "registerAuthCommitment(previousRoot, nextRoot)",
      "recordPrivateComputeReceipt(previousRoot, nextRoot, receipt)"
    ],
    x402Linkage: {
      settlementModel: zekoRail.settlementModel,
      payTo: zekoRail.payTo,
      kernelPath: zekoRail.extensions?.zeko?.kernelPath,
      receiptFields: [
        "authCommitment",
        "datasetCommitment",
        "policyHash",
        "outputHash",
        "paymentContextDigest",
        "amountNanomina",
        "payer",
        "beneficiary"
      ]
    },
    planDigest: sha256Hex({
      contract: "PrivateComputeAccess",
      rail: zekoRail,
      version: "private-compute-zkapp-plan-v1"
    })
  };
}
