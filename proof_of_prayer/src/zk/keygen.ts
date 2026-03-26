import { PrivateKey } from 'o1js';

const key = PrivateKey.random();
console.log('ZKAPP_PRIVATE_KEY=', key.toBase58());
console.log('ZKAPP_PUBLIC_KEY=', key.toPublicKey().toBase58());
