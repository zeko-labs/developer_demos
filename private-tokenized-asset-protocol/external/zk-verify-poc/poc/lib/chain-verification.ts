export interface GraphqlEnvelope<TData> {
  data?: TData;
  errors?: Array<{
    message?: string;
  }>;
}

export interface GraphqlBalance {
  total: string;
}

export interface GraphqlVerificationKey {
  hash: string;
}

export interface GraphqlAccountSnapshot {
  publicKey: string;
  nonce: string | null;
  balance: GraphqlBalance;
  provedState?: boolean | null;
  zkappState?: string[] | null;
  verificationKey?: GraphqlVerificationKey | null;
}

export interface GraphqlTransactionInfo {
  hash: string;
  memo: string;
  status: string;
}

export interface GraphqlEventData {
  data: string[];
  transactionInfo: GraphqlTransactionInfo | null;
}

export interface GraphqlEventOutput {
  eventData: GraphqlEventData[];
}

export interface GraphqlDeploymentStateInput {
  feePayerPublicKey: string;
  zkAppPublicKey: string;
  feePayerAccount: GraphqlAccountSnapshot | null;
  zkAppAccount: GraphqlAccountSnapshot | null;
  events: GraphqlEventOutput[];
  expectedProofHash?: string;
}

export interface GraphqlDeploymentSummary {
  feePayerPublicKey: string;
  feePayerNonce: string;
  feePayerBalance: string;
  zkAppPublicKey: string;
  zkAppNonce: string;
  zkAppProofHash: string;
  zkAppResult: string;
  verificationKeyHash: string;
  settlementTxHash: string;
  matchingEventCount: number;
}

function stringifyMessage(message: unknown): string {
  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  return "unknown GraphQL error";
}

export function extractGraphqlData<TData>(payload: unknown, operation: string): TData {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`graphql ${operation} failed: response was not an object`);
  }

  const envelope = payload as GraphqlEnvelope<TData>;
  const errorMessages = (envelope.errors ?? []).map((error) => stringifyMessage(error.message));
  if (errorMessages.length > 0) {
    throw new Error(`graphql ${operation} failed: ${errorMessages.join("; ")}`);
  }

  if (envelope.data === undefined) {
    throw new Error(`graphql ${operation} failed: missing data field`);
  }

  return envelope.data;
}

export function assertGraphqlDeploymentState(
  input: GraphqlDeploymentStateInput,
): GraphqlDeploymentSummary {
  if (!input.feePayerAccount) {
    throw new Error(`fee payer account not found on node: ${input.feePayerPublicKey}`);
  }
  if (!input.zkAppAccount) {
    throw new Error(`zkapp account not found on node: ${input.zkAppPublicKey}`);
  }

  const verificationKeyHash = input.zkAppAccount.verificationKey?.hash;
  if (!verificationKeyHash) {
    throw new Error("zkapp account missing verification key hash");
  }

  const zkappState = input.zkAppAccount.zkappState ?? [];
  if (zkappState.length < 2) {
    throw new Error("zkapp account missing required state slots");
  }
  const zkAppProofHash = zkappState[0];
  const zkAppResult = zkappState[1];

  if (!zkAppProofHash || zkAppProofHash === "0") {
    throw new Error("zkapp proof hash state slot is empty");
  }
  if (!zkAppResult) {
    throw new Error("zkapp result state slot is empty");
  }

  if (input.expectedProofHash && input.expectedProofHash !== zkAppProofHash) {
    throw new Error(
      `expected proof hash ${input.expectedProofHash} does not match on-chain state ${zkAppProofHash}`,
    );
  }

  const eventEntries = input.events.flatMap((event) => event.eventData ?? []);
  const matchingEvents = eventEntries.filter((entry) => {
    const status = entry.transactionInfo?.status ?? "";
    return (
      entry.data?.[0] === zkAppProofHash &&
      entry.data?.[1] === zkAppResult &&
      status.includes("Applied")
    );
  });

  if (matchingEvents.length === 0) {
    throw new Error("no matching applied verification event found for current zkapp state");
  }

  const txHash = matchingEvents[0].transactionInfo?.hash;
  if (!txHash) {
    throw new Error("matching verification event missing transaction hash");
  }

  return {
    feePayerPublicKey: input.feePayerPublicKey,
    feePayerNonce: input.feePayerAccount.nonce ?? "0",
    feePayerBalance: input.feePayerAccount.balance.total,
    zkAppPublicKey: input.zkAppPublicKey,
    zkAppNonce: input.zkAppAccount.nonce ?? "0",
    zkAppProofHash,
    zkAppResult,
    verificationKeyHash,
    settlementTxHash: txHash,
    matchingEventCount: matchingEvents.length,
  };
}
