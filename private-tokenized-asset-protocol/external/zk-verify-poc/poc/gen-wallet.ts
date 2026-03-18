import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { PrivateKey } from "o1js";

const ENV_PATH = ".env";

function parseEnvFile(contents: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    out.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }

  return out;
}

function stringifyEnv(values: Map<string, string>): string {
  const keys = [
    "ZEKO_GRAPHQL_URL",
    "FEE_PAYER_PRIVATE_KEY",
    "FEE_PAYER_PUBLIC_KEY",
    "ZKAPP_PRIVATE_KEY",
    "ZKAPP_PUBLIC_KEY",
    "TLSNOTARY_SIGNING_KEY_HEX",
  ];

  return `${keys.map((key) => `${key}=${values.get(key) ?? ""}`).join("\n")}\n`;
}

function main(): void {
  const existing = existsSync(ENV_PATH)
    ? parseEnvFile(readFileSync(ENV_PATH, "utf8"))
    : new Map<string, string>();

  const feePayerKey = PrivateKey.random();
  const feePayerPublic = feePayerKey.toPublicKey();

  const zkAppKey = PrivateKey.random();
  const zkAppPublic = zkAppKey.toPublicKey();

  existing.set(
    "ZEKO_GRAPHQL_URL",
    existing.get("ZEKO_GRAPHQL_URL") ?? "https://testnet.zeko.io/graphql",
  );
  existing.set("FEE_PAYER_PRIVATE_KEY", feePayerKey.toBase58());
  existing.set("FEE_PAYER_PUBLIC_KEY", feePayerPublic.toBase58());
  existing.set("ZKAPP_PRIVATE_KEY", zkAppKey.toBase58());
  existing.set("ZKAPP_PUBLIC_KEY", zkAppPublic.toBase58());
  existing.set("TLSNOTARY_SIGNING_KEY_HEX", randomBytes(32).toString("hex"));

  writeFileSync(ENV_PATH, stringifyEnv(existing), "utf8");

  console.log("[gen-wallet] Generated .env with fee payer and zkApp keys");
  console.log(`[gen-wallet] FEE_PAYER_PUBLIC_KEY=${feePayerPublic.toBase58()}`);
  console.log(`[gen-wallet] ZKAPP_PUBLIC_KEY=${zkAppPublic.toBase58()}`);
}

main();
