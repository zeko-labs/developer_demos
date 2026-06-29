import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { AccountUpdate, Mina, PrivateKey, PublicKey, fetchAccount } from 'o1js';
import { AiVerdictProgram } from './aiVerdict.js';
import { AiVerdictContract } from './zekoContract.js';

const graphql = process.env.ZEKO_GRAPHQL || 'https://testnet.zeko.io';
function getKeychainSecret(service: string): string | null {
  try {
    const out = execSync(`security find-generic-password -a \"$USER\" -s \"${service}\" -w`, {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const value = out.toString().trim();
    return value || null;
  } catch {
    return null;
  }
}

function getSecret(envKey: string, service: string): string | null {
  return process.env[envKey] || getKeychainSecret(service);
}

const deployerKey = getSecret('DEPLOYER_PRIVATE_KEY', 'AIImageVerdictZK_SUBMITTER_PRIVATE_KEY');
const zkappKeyEnv = getSecret('ZKAPP_PRIVATE_KEY', 'AIImageVerdictZK_ZKAPP_PRIVATE_KEY');

const deployerSource = process.env.DEPLOYER_PRIVATE_KEY ? 'env' : 'keychain';
const zkappSource = process.env.ZKAPP_PRIVATE_KEY ? 'env' : 'keychain';

if (!deployerKey || !zkappKeyEnv) {
  throw new Error('Missing DEPLOYER_PRIVATE_KEY or ZKAPP_PRIVATE_KEY');
}

const networkId = process.env.ZEKO_NETWORK_ID ?? 'zeko';
const networkLabel = `Zeko ${networkId}`;
const network = Mina.Network({
  networkId: networkId as any,
  mina: graphql,
  archive: graphql
});
Mina.setActiveInstance(network);

const deployer = PrivateKey.fromBase58(deployerKey);
const zkappKey = PrivateKey.fromBase58(zkappKeyEnv);
const zkappAddress = zkappKey.toPublicKey();
console.log('Deploy key source:', deployerSource, '| zkApp key source:', zkappSource);
console.log('Derived ZKAPP_PUBLIC_KEY:', zkappAddress.toBase58());
console.log('Deployer public key:', deployer.toPublicKey().toBase58());

const deployerPub = deployer.toPublicKey();
const account = await fetchAccount({ publicKey: deployerPub });
if (account.error) {
  console.error(`Deployer account not found on ${networkLabel}.`);
  console.error(account.error);
} else {
  console.log('Deployer balance:', account.account.balance.toString(), 'nanomina');
  console.log('Deployer nonce:', account.account.nonce.toString());
}

const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
const zkappExists = !zkappAccount.error;
if (zkappExists) {
  console.log('ZkApp account already exists. Will redeploy without fundNewAccount.');
}

console.log('Compiling circuits...');
await AiVerdictProgram.compile();
await AiVerdictContract.compile();

console.log(`Deploying zkApp to ${networkLabel}...`);
const txFee = process.env.TX_FEE ?? '200000000'; // 0.2 MINA in nanomina
console.log('Using fee (nanomina):', txFee);
const tx = await Mina.transaction({ sender: deployer.toPublicKey(), fee: txFee }, async () => {
  if (!zkappExists) {
    AccountUpdate.fundNewAccount(deployer.toPublicKey());
  }
  const zkapp = new AiVerdictContract(zkappAddress);
  zkapp.deploy();
});

await tx.prove();
const txJson = tx.toJSON() as any;
console.log('tx.toJSON type:', typeof txJson);
if (typeof txJson === 'string') {
  try {
    const parsed = JSON.parse(txJson);
    console.log('Transaction fee in JSON:', parsed?.feePayer?.body?.fee);
  } catch {
    console.log('Transaction fee in JSON: (unable to parse string)');
  }
  console.log('tx.toJSON (string preview):', txJson.slice(0, 200));
} else {
  console.log('Transaction fee in JSON:', txJson?.feePayer?.body?.fee);
}
await tx.sign([deployer, zkappKey]).send();

console.log('Zeko zkApp deployed');
console.log('ZKAPP_PUBLIC_KEY=', zkappAddress.toBase58());
console.log('ZEKO_GRAPHQL=', graphql);
console.log('ZEKO_NETWORK_ID=', networkId);
