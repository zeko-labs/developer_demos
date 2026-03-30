import { Field } from 'o1js';
import { createHash } from 'node:crypto';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} env var is required`);
  }
  return value.trim();
}

export function readOptionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export function hashHexToField(hex: string): Field {
  const clean = hex.replace(/^0x/i, '').trim();
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('batch hash must be hex');
  }
  const bigint = BigInt(`0x${clean}`);
  return Field(bigint);
}

export function hashStringToField(value: string): Field {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  return hashHexToField(digest);
}
