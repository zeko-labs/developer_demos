import dotenv from "dotenv";
import { Field, Poseidon } from "o1js";

import {
  assertGraphqlDeploymentState,
  extractGraphqlData,
  type GraphqlAccountSnapshot,
  type GraphqlEventOutput,
} from "./lib/chain-verification.js";
import { readJsonFile } from "./lib/io.js";
import { outputDir } from "./lib/paths.js";

const PROOF_PATH = `${outputDir()}/proof.json`;
const GRAPHQL_TIMEOUT_MS = 15_000;

const ACCOUNT_QUERY = `
  query Account($pk: PublicKey!) {
    account(publicKey: $pk) {
      publicKey
      nonce
      balance { total }
      provedState
      zkappState
      verificationKey { hash }
    }
  }
`;

const EVENTS_QUERY = `
  query Events($address: PublicKey!) {
    events(input: { address: $address }) {
      eventData {
        data
        transactionInfo {
          hash
          memo
          status
        }
      }
    }
  }
`;

interface StoredProof {
  proof: unknown;
}

interface AccountQueryData {
  account: GraphqlAccountSnapshot | null;
}

interface EventsQueryData {
  events: GraphqlEventOutput[];
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }

  return value;
}

function proofHashFromJson(proofJson: unknown): string {
  const bytes = Buffer.from(JSON.stringify(proofJson), "utf8");
  const fields = [...bytes].map((value) => Field(value));
  return Poseidon.hash(fields).toString();
}

async function executeGraphql<TData>(
  graphqlUrl: string,
  query: string,
  variables: Record<string, unknown>,
  operation: string,
): Promise<TData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GRAPHQL_TIMEOUT_MS);

  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`graphql ${operation} failed with HTTP ${response.status}`);
    }

    const json = (await response.json()) as unknown;
    return extractGraphqlData<TData>(json, operation);
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  dotenv.config();

  const graphqlUrl = requiredEnv("ZEKO_GRAPHQL_URL");
  const feePayerPublicKey = requiredEnv("FEE_PAYER_PUBLIC_KEY");
  const zkAppPublicKey = requiredEnv("ZKAPP_PUBLIC_KEY");

  let expectedProofHash: string | undefined;
  try {
    const proof = await readJsonFile<StoredProof>(PROOF_PATH);
    expectedProofHash = proofHashFromJson(proof.proof);
  } catch {
    expectedProofHash = undefined;
  }

  const feePayerData = await executeGraphql<AccountQueryData>(
    graphqlUrl,
    ACCOUNT_QUERY,
    { pk: feePayerPublicKey },
    "fee payer account query",
  );

  const zkAppData = await executeGraphql<AccountQueryData>(
    graphqlUrl,
    ACCOUNT_QUERY,
    { pk: zkAppPublicKey },
    "zkapp account query",
  );

  const eventsData = await executeGraphql<EventsQueryData>(
    graphqlUrl,
    EVENTS_QUERY,
    { address: zkAppPublicKey },
    "events query",
  );

  const summary = assertGraphqlDeploymentState({
    feePayerPublicKey,
    zkAppPublicKey: zkAppPublicKey,
    feePayerAccount: feePayerData.account,
    zkAppAccount: zkAppData.account,
    events: eventsData.events,
    expectedProofHash,
  });

  console.log("[verify-chain] GraphQL source-of-truth verification passed");
  console.log(`[verify-chain] zkApp: ${summary.zkAppPublicKey}`);
  console.log(`[verify-chain] verification key hash: ${summary.verificationKeyHash}`);
  console.log(`[verify-chain] zkApp state proofHash: ${summary.zkAppProofHash}`);
  console.log(`[verify-chain] zkApp state result: ${summary.zkAppResult}`);
  console.log(`[verify-chain] settlement tx: ${summary.settlementTxHash}`);
  console.log(`[verify-chain] matching applied events: ${summary.matchingEventCount}`);
  console.log(`[verify-chain] fee payer nonce: ${summary.feePayerNonce}`);
  console.log(`[verify-chain] fee payer balance: ${summary.feePayerBalance}`);
}

main().catch((error: unknown) => {
  console.error("[verify-chain] failed:", error);
  process.exit(1);
});
