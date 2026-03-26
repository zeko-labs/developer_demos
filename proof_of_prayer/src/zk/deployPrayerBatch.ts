import 'reflect-metadata';
import 'dotenv/config';
import { AccountUpdate, Mina, PrivateKey, PublicKey, fetchAccount } from 'o1js';
import { PrayerBatchContract } from './prayerBatch.js';

const graphql = process.env.ZEKO_GRAPHQL || 'https://testnet.zeko.io';
function getSecret(envKey: string): string | null {
  return process.env[envKey] || null;
}

const deployerKey = getSecret('DEPLOYER_PRIVATE_KEY');
const zkappKeyEnv = getSecret('PRAYER_ZKAPP_PRIVATE_KEY');

const deployerSource = process.env.DEPLOYER_PRIVATE_KEY ? 'env' : 'missing';
const zkappSource = process.env.PRAYER_ZKAPP_PRIVATE_KEY ? 'env' : 'missing';

if (!deployerKey || !zkappKeyEnv) {
  throw new Error('Missing DEPLOYER_PRIVATE_KEY or PRAYER_ZKAPP_PRIVATE_KEY in .env');
}

const networkId = process.env.ZEKO_NETWORK_ID ?? 'zeko';
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
console.log('Derived PRAYER_ZKAPP_PUBLIC_KEY:', zkappAddress.toBase58());
console.log('Deployer public key:', deployer.toPublicKey().toBase58());

const deployerPub = deployer.toPublicKey();
const account = await fetchAccount({ publicKey: deployerPub });
if (account.error) {
  console.error('Deployer account not found on Zeko testnet.');
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

console.log('Compiling prayer batch contract...');
await PrayerBatchContract.compile();

console.log('Deploying PrayerBatchContract to Zeko testnet...');
const txFee = process.env.TX_FEE ?? '200000000';
console.log('Using fee (nanomina):', txFee);
const tx = await Mina.transaction({ sender: deployer.toPublicKey(), fee: txFee }, async () => {
  if (!zkappExists) {
    AccountUpdate.fundNewAccount(deployer.toPublicKey());
  }
  const zkapp = new PrayerBatchContract(zkappAddress);
  zkapp.deploy();
});

await tx.prove();
await tx.sign([deployer, zkappKey]).send();

console.log('PrayerBatch zkApp deployed');
console.log('PRAYER_ZKAPP_PUBLIC_KEY=', zkappAddress.toBase58());
console.log('ZEKO_GRAPHQL=', graphql);
console.log('ZEKO_NETWORK_ID=', networkId);
