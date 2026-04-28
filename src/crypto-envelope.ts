import crypto from 'node:crypto';

export interface X25519Keypair {
  curve: 'x25519';
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
}

export interface X25519EncryptedEnvelope {
  mode: 'aes-256-gcm';
  curve: 'x25519';
  recipientPublicKeyFingerprint: string;
  ephemeralPublicKeyPem: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

const defaultEnvelopeContext = 'zeko-ai-builder-kit-client-envelope-v1';

export function fingerprintPublicKeyPem(publicKeyPem: string) {
  return crypto.createHash('sha256').update(String(publicKeyPem || '')).digest('hex').slice(0, 32);
}

export function generateX25519Keypair(): X25519Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  return {
    curve: 'x25519',
    publicKeyPem,
    privateKeyPem,
    fingerprint: fingerprintPublicKeyPem(publicKeyPem)
  };
}

function deriveEnvelopeKey(sharedSecret: Buffer, context: string) {
  return crypto.createHash('sha256').update(sharedSecret).update(context).digest();
}

export function encryptJsonEnvelope(
  payload: unknown,
  recipientPublicKeyPem: string,
  context: string = defaultEnvelopeContext
): X25519EncryptedEnvelope {
  const recipientPublicKey = crypto.createPublicKey(recipientPublicKeyPem);
  const ephemeral = crypto.generateKeyPairSync('x25519');
  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublicKey
  });
  const key = deriveEnvelopeKey(sharedSecret, context);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    mode: 'aes-256-gcm',
    curve: 'x25519',
    recipientPublicKeyFingerprint: fingerprintPublicKeyPem(recipientPublicKeyPem),
    ephemeralPublicKeyPem: ephemeral.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptJsonEnvelope(
  privateKeyPem: string,
  envelope: X25519EncryptedEnvelope,
  context: string = defaultEnvelopeContext
): unknown {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(envelope.ephemeralPublicKeyPem);
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey });
  const key = deriveEnvelopeKey(sharedSecret, context);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function getEnvelopeContext(label: 'client-output' | 'private-input' = 'client-output') {
  return label === 'private-input'
    ? 'zeko-ai-builder-kit-private-input-envelope-v1'
    : defaultEnvelopeContext;
}
