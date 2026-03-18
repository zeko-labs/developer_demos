import dotenv from "dotenv";

export interface RuntimeEnv {
  zekoGraphqlUrl: string;
  feePayerPrivateKey: string;
  feePayerPublicKey: string;
  zkappPrivateKey?: string;
  zkappPublicKey?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }

  return value;
}

export function loadRuntimeEnv(options?: { loadDotenv?: boolean }): RuntimeEnv {
  if (options?.loadDotenv !== false) {
    dotenv.config();
  }

  return {
    zekoGraphqlUrl: required("ZEKO_GRAPHQL_URL"),
    feePayerPrivateKey: required("FEE_PAYER_PRIVATE_KEY"),
    feePayerPublicKey: required("FEE_PAYER_PUBLIC_KEY"),
    zkappPrivateKey: process.env.ZKAPP_PRIVATE_KEY,
    zkappPublicKey: process.env.ZKAPP_PUBLIC_KEY,
  };
}
