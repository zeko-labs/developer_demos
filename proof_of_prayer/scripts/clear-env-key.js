#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.log('No .env file found.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const key = (await ask('Key to remove (e.g. ZKAPP_PRIVATE_KEY): ')).trim();
if (!key) {
  console.log('No key provided.');
  rl.close();
  process.exit(0);
}

const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const filtered = lines.filter((line) => !line.startsWith(`${key}=`));
fs.writeFileSync(envPath, filtered.join('\n') + '\n', 'utf8');
console.log(`Removed ${key} from .env`);
rl.close();
