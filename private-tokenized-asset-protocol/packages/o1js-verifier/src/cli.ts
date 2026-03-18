#!/usr/bin/env node
import fs from 'node:fs';
import { verifyO1jsPayload, type O1jsVerifierPayload } from './index.js';

async function main() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw) as O1jsVerifierPayload;
    const result = await verifyO1jsPayload(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ verified: false, reason: 'invalid_stdin_json' })}\n`);
  }
}

main();
