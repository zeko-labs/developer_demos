import 'reflect-metadata';
import { AccountUpdate, Mina, PrivateKey } from 'o1js';
import { AiVerdictProgram } from './aiVerdict.js';
import { AiVerdictContract } from './zekoContract.js';

const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
Mina.setActiveInstance(Local);

const deployer = (Local.testAccounts[0] as any).privateKey;
const zkappKey = PrivateKey.random();
const zkappAddress = zkappKey.toPublicKey();

console.log('Compiling circuits...');
await AiVerdictProgram.compile();
await AiVerdictContract.compile();

console.log('Deploying to local chain...');
const tx = await Mina.transaction(deployer.toPublicKey(), async () => {
  AccountUpdate.fundNewAccount(deployer.toPublicKey());
  const zkapp = new AiVerdictContract(zkappAddress);
  zkapp.deploy();
});

await tx.prove();
await tx.sign([deployer, zkappKey]).send();

console.log('Local zkApp deployed');
console.log('ZKAPP_PUBLIC_KEY=', zkappAddress.toBase58());
console.log('ZKAPP_PRIVATE_KEY=', zkappKey.toBase58());
