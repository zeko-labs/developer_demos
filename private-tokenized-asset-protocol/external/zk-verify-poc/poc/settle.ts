import { AccountUpdate, Field, Mina, Poseidon, PrivateKey, PublicKey, fetchAccount } from "o1js";

import { EligibilityProgram, EligibilityProof } from "./circuits/eligibility.js";
import { VerificationRegistry } from "./contracts/VerificationRegistry.js";
import { writeDeployedAddressMetadata } from "./lib/deploy-metadata.js";
import { loadRuntimeEnv } from "./lib/env.js";
import { readJsonFile } from "./lib/io.js";
import { outputDir } from "./lib/paths.js";

const PROOF_PATH = `${outputDir()}/proof.json`;
const TX_FEE = 100_000_000;
const POLL_DELAY_MS = 3_000;
const MAX_NONCE_POLL_ATTEMPTS = 30;

interface StoredProof {
  proof: {
    publicInput: string[];
    publicOutput: string[];
    maxProofsVerified: 0 | 1 | 2;
    proof: string;
  };
}

function proofHashFromJson(proofJson: unknown): Field {
  const bytes = Buffer.from(JSON.stringify(proofJson), "utf8");
  const fields = [...bytes].map((value) => Field(value));
  return Poseidon.hash(fields);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readAccountNonce(publicKey: PublicKey): Promise<number> {
  const account = await fetchAccount({ publicKey });
  if (account.error || !account.account) {
    throw new Error(
      `account fetch failed while polling nonce: ${account.error?.statusText ?? "unknown"}`,
    );
  }

  return Number(account.account.nonce.toString());
}

async function waitForNonceIncrement(publicKey: PublicKey, baselineNonce: number): Promise<number> {
  for (let attempt = 1; attempt <= MAX_NONCE_POLL_ATTEMPTS; attempt += 1) {
    const nonce = await readAccountNonce(publicKey);
    if (nonce > baselineNonce) {
      return nonce;
    }

    await sleep(POLL_DELAY_MS);
  }

  throw new Error(
    `transaction was submitted but account nonce did not increment above ${baselineNonce} within polling window`,
  );
}

async function main(): Promise<void> {
  const env = loadRuntimeEnv();
  const network = Mina.Network(env.zekoGraphqlUrl);
  Mina.setActiveInstance(network);

  const feePayerKey = PrivateKey.fromBase58(env.feePayerPrivateKey);
  const feePayerPublicKey = feePayerKey.toPublicKey();

  const feePayerAccount = await fetchAccount({ publicKey: feePayerPublicKey });
  if (feePayerAccount.error) {
    throw new Error(`fee payer account fetch failed: ${feePayerAccount.error.statusText}`);
  }
  let feePayerNonceBefore = Number(feePayerAccount.account?.nonce.toString() ?? "0");

  const zkAppAddress = env.zkappPublicKey;
  if (!zkAppAddress) {
    throw new Error("missing required env var: ZKAPP_PUBLIC_KEY (set in .env or deploy first)");
  }

  const storedProof = await readJsonFile<StoredProof>(PROOF_PATH);
  const eligibilityProof = await EligibilityProof.fromJSON(storedProof.proof);

  console.log("[settle] Compiling EligibilityProgram...");
  await EligibilityProgram.compile();
  console.log("[settle] Compiling VerificationRegistry contract...");
  const { verificationKey } = await VerificationRegistry.compile();

  const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
  const zkAppAccount = await fetchAccount({ publicKey: zkAppPublicKey });
  if (zkAppAccount.error) {
    throw new Error(`zkApp account fetch failed: ${zkAppAccount.error.statusText}`);
  }
  const onChainVkHash = zkAppAccount.account?.zkapp?.verificationKey?.hash?.toString();
  const targetVkHash = verificationKey.hash.toString();

  if (onChainVkHash !== targetVkHash) {
    console.log(
      `[settle] Verification key mismatch — on-chain: ${onChainVkHash ?? "none"}, local: ${targetVkHash}`,
    );
    const zkAppPrivateKeyStr = env.zkappPrivateKey;
    if (!zkAppPrivateKeyStr) {
      throw new Error(
        "on-chain verification key does not match compiled contract and ZKAPP_PRIVATE_KEY is not set — cannot auto-redeploy",
      );
    }

    const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyStr);
    const hasExistingAccount = !zkAppAccount.error && Boolean(zkAppAccount.account);
    const zkApp = new VerificationRegistry(zkAppPublicKey);

    const deployTx = await Mina.transaction(
      { sender: feePayerPublicKey, fee: TX_FEE, nonce: feePayerNonceBefore },
      async () => {
        if (!hasExistingAccount) {
          AccountUpdate.fundNewAccount(feePayerPublicKey);
        }
        await zkApp.deploy({ verificationKey });
      },
    );

    console.log("[settle] Proving redeployment transaction...");
    await deployTx.prove();
    const deployPendingTx = await deployTx.sign([feePayerKey, zkAppPrivateKey]).send();
    console.log(`[settle] Redeployment tx: ${deployPendingTx.hash}`);

    const nonceAfterDeploy = await waitForNonceIncrement(feePayerPublicKey, feePayerNonceBefore);
    feePayerNonceBefore = nonceAfterDeploy;
    console.log(`[settle] Redeployment confirmed, nonce now ${nonceAfterDeploy}`);

    await writeDeployedAddressMetadata({
      zkappPublicKey: zkAppPublicKey.toBase58(),
      zkappPrivateKeyGenerated: false,
      deployTxHash: deployPendingTx.hash,
      alreadyDeployed: hasExistingAccount,
      verificationKeyHash: targetVkHash,
    });
    console.log("[settle] Saved output/deployed-address.json");
  }

  const registry = new VerificationRegistry(zkAppPublicKey);
  const proofHash = proofHashFromJson(storedProof.proof);

  const tx = await Mina.transaction(
    { sender: feePayerPublicKey, fee: TX_FEE, nonce: feePayerNonceBefore },
    async () => {
      await registry.recordVerification(proofHash, eligibilityProof);
    },
  );

  console.log("[settle] Proving settlement transaction...");
  await tx.prove();

  const pendingTx = await tx.sign([feePayerKey]).send();

  console.log(`[settle] Transaction hash: ${pendingTx.hash}`);
  console.log(`[settle] Explorer: https://zekoscan.io/testnet/tx/${pendingTx.hash}`);

  const feePayerNonceAfter = await waitForNonceIncrement(feePayerPublicKey, feePayerNonceBefore);
  console.log(`[settle] Fee payer nonce advanced ${feePayerNonceBefore} -> ${feePayerNonceAfter}`);
}

main().catch((error: unknown) => {
  console.error("[settle] failed:", error);
  process.exit(1);
});
