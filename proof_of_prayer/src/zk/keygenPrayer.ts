import 'reflect-metadata';
import { PrivateKey } from 'o1js';

const key = PrivateKey.random();
const pub = key.toPublicKey();

console.log('PRAYER_ZKAPP_PRIVATE_KEY=', key.toBase58());
console.log('PRAYER_ZKAPP_PUBLIC_KEY=', pub.toBase58());
