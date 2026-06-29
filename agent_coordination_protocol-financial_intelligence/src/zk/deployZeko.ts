import 'reflect-metadata';
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { AccountUpdate, Mina, Permissions, PrivateKey, fetchAccount } from 'o1js';
import { AgentRequestContract } from './agentContract.js';

const graphql = process.env.ZEKO_GRAPHQL || 'https://testnet.zeko.io';
function getKeychainSecret(service: string): string | null {
  try {
    const out = execSync(`security find-generic-password -a "$USER" -s "${service}" -w`, {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const value = out.toString().trim();
    return value || null;
  } catch {
    return null;
  }
}

function getSecret(envKey: string, service: string): string | null {
  const raw = process.env[envKey] || getKeychainSecret(service);
  return raw ? raw.trim() : null;
}

const deployerKey = getSecret('DEPLOYER_PRIVATE_KEY', 'ZekoAI_SUBMITTER_PRIVATE_KEY');
const feePayerKeyEnv = getSecret('FEE_PAYER_PRIVATE_KEY', 'ZekoAI_FEE_PAYER_PRIVATE_KEY');
const zkappKeyEnv = getSecret('ZKAPP_PRIVATE_KEY', 'ZekoAI_ZKAPP_PRIVATE_KEY');

const deployerSource = process.env.DEPLOYER_PRIVATE_KEY ? 'env' : 'keychain';
const zkappSource = process.env.ZKAPP_PRIVATE_KEY ? 'env' : 'keychain';

if (!deployerKey || !zkappKeyEnv) {
  throw new Error('Missing DEPLOYER_PRIVATE_KEY or ZKAPP_PRIVATE_KEY');
}

const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
const networkLabel = `Zeko ${networkId}`;
const network = Mina.Network({
  networkId: networkId as any,
  mina: graphql,
  archive: graphql
});
Mina.setActiveInstance(network);

const deployer = PrivateKey.fromBase58(deployerKey);
const feePayer = feePayerKeyEnv ? PrivateKey.fromBase58(feePayerKeyEnv) : deployer;
const zkappKey = PrivateKey.fromBase58(zkappKeyEnv);
const zkappAddress = zkappKey.toPublicKey();
console.log('Deploy key source:', deployerSource, '| zkApp key source:', zkappSource);
console.log('Derived ZKAPP_PUBLIC_KEY:', zkappAddress.toBase58());
console.log('Deployer public key:', deployer.toPublicKey().toBase58());
console.log('Fee payer public key:', feePayer.toPublicKey().toBase58());
if (deployer.toPublicKey().toBase58() === zkappAddress.toBase58()) {
  console.log('Warning: deployer and zkApp public keys are identical.');
}

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
await AgentRequestContract.compile();

console.log(`Deploying zkApp to ${networkLabel}...`);
const txFee = process.env.TX_FEE ?? '200000000'; // 0.2 MINA in nanomina
console.log('Using fee (nanomina):', txFee);
const tx = await Mina.transaction({ sender: feePayer.toPublicKey(), fee: txFee }, async () => {
  if (!zkappExists) {
    AccountUpdate.fundNewAccount(deployer.toPublicKey());
  }
  const zkapp = new AgentRequestContract(zkappAddress);
  zkapp.deploy();
  // Allow proofs for state edits to avoid signature-only constraints
  zkapp.account.permissions.set({
    ...Permissions.default(),
    editState: Permissions.proof()
  });
});

await tx.prove();
const signers = feePayer.toPublicKey().toBase58() === deployer.toPublicKey().toBase58() ? [deployer] : [deployer, feePayer];
const signed = await tx.sign([...signers, zkappKey]);
const txJson = signed.toJSON() as any;
if (typeof txJson === 'object') {
  console.log('Fee payer public key (tx JSON):', txJson?.feePayer?.body?.publicKey);
  console.log('Account updates:', Array.isArray(txJson?.accountUpdates) ? txJson.accountUpdates.length : 'n/a');
}
try {
  await signed.send();
} catch (err) {
  console.log('Send failed. Fee payer public key (tx JSON):', txJson?.feePayer?.body?.publicKey);
  console.log('Deployer public key:', deployer.toPublicKey().toBase58());
  console.log('ZkApp public key:', zkappAddress.toBase58());
  console.error(err);
  throw err;
}

console.log('Zeko zkApp deployed');
console.log('ZKAPP_PUBLIC_KEY=', zkappAddress.toBase58());
console.log('ZEKO_GRAPHQL=', graphql);
console.log('ZEKO_NETWORK_ID=', networkId);
