#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const root = process.cwd();
const envPath = path.join(root, '.env');

function readEnv() {
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    out[key.trim()] = rest.join('=').trim();
  }
  return out;
}

function writeEnv(next) {
  const entries = Object.entries(next)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(envPath, entries + '\n', 'utf8');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const current = readEnv();

console.log('== Set zkApp keys (.env) ==');

const publicKey = await ask(`ZKAPP_PUBLIC_KEY [${current.ZKAPP_PUBLIC_KEY || ''}]: `);
const privateKey = await ask(`ZKAPP_PRIVATE_KEY [${current.ZKAPP_PRIVATE_KEY || ''}]: `);

const next = {
  ZEKO_GRAPHQL: current.ZEKO_GRAPHQL || 'https://testnet.zeko.io',
  ZEKO_NETWORK_ID: current.ZEKO_NETWORK_ID || 'testnet',
  TX_FEE: current.TX_FEE || '100000000',
  ZKAPP_PUBLIC_KEY: publicKey || current.ZKAPP_PUBLIC_KEY || '',
  ZKAPP_PRIVATE_KEY: privateKey || current.ZKAPP_PRIVATE_KEY || '',
  SUBMITTER_PRIVATE_KEY: current.SUBMITTER_PRIVATE_KEY || '',
  AI_DETECTOR_PROVIDER: current.AI_DETECTOR_PROVIDER || 'sightengine',
  AI_DETECTOR_USER: current.AI_DETECTOR_USER || '',
  AI_DETECTOR_SECRET: current.AI_DETECTOR_SECRET || ''
};

writeEnv(next);

console.log('Updated .env');
rl.close();
