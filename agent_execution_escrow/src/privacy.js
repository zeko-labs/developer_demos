import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PRIVACY_KEY_PATH = path.resolve(process.cwd(), 'data', 'privacy.key');
const PRIVACY_SALT = process.env.PRIVACY_SALT || 'agent-execution-escrow-default-salt-change-me';
const STORE_ENCRYPTED_PAYLOADS = process.env.STORE_ENCRYPTED_PAYLOADS === 'true';

let cachedKey = null;

function getPrivacyKey() {
  if (cachedKey) return cachedKey;
  fs.mkdirSync(path.dirname(PRIVACY_KEY_PATH), { recursive: true });
  if (!fs.existsSync(PRIVACY_KEY_PATH)) {
    fs.writeFileSync(PRIVACY_KEY_PATH, crypto.randomBytes(32).toString('base64'), 'utf8');
  }
  const raw = fs.readFileSync(PRIVACY_KEY_PATH, 'utf8').trim();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('invalid_privacy_key_length');
  cachedKey = key;
  return key;
}

export function hashIdentifier(value) {
  return `usr_${crypto.createHash('sha256').update(`${PRIVACY_SALT}:${String(value)}`).digest('hex').slice(0, 24)}`;
}

export function hashPrompt(prompt) {
  return `ph_${crypto.createHash('sha256').update(String(prompt || '')).digest('hex')}`;
}

export function sealPayload(payload) {
  if (!STORE_ENCRYPTED_PAYLOADS) return null;
  const key = getPrivacyKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

const REDACTED_KEYS = new Set([
  'prompt',
  'email',
  'name',
  'address',
  'phone',
  'user',
  'userId',
  'signedMessage',
  'signature',
  'contextLogs'
]);

export function sanitizeMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (REDACTED_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
