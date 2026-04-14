import 'reflect-metadata';
import 'dotenv/config';
import process from 'node:process';
import { Field, PrivateKey, Signature } from 'o1js';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`missing_${name.toLowerCase()}`);
}

async function main() {
  const privateKey = PrivateKey.fromBase58(requiredEnv('ZEKO_VERIFIER_PRIVATE_KEY'));
  const signingFields = JSON.parse(requiredEnv('ZEKO_SIGNING_FIELDS')) as string[];
  const fields = signingFields.map((item) => Field(item));
  const signature = Signature.create(privateKey, fields);
  process.stdout.write(
    JSON.stringify(
      {
        verifierPublicKey: privateKey.toPublicKey().toBase58(),
        signature: signature.toBase58(),
        signingFields
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zeko-approval:sign] failed', error);
  process.exit(1);
});
