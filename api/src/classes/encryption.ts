// node_modules
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// classes
import { config, decodeEncryptionKey, ENCRYPTION_KEY_BYTES } from './config';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const KEY_LEN = ENCRYPTION_KEY_BYTES;

async function getEncryptionKey(): Promise<Buffer> {
  const envKey = config.encryptionKey;
  if (envKey) {
    const key = decodeEncryptionKey(envKey);
    if (key) {
      return key;
    }
    throw new Error('ENCRYPTION_KEY must be 32 bytes, hex or base64 encoded');
  }
  // ENCRYPTION_KEY is optional (not provisioned by the compose/install files): derive a key
  // from the always-required JWT_SECRET. Rotating JWT_SECRET then invalidates stored ciphertext.
  const jwtSecret = config.jwtSecret.trim();
  if (jwtSecret) {
    return Buffer.from(hkdfSync('sha256', jwtSecret, '', 'novacode:encryption-key', KEY_LEN));
  }
  throw new Error('ENCRYPTION_KEY or JWT_SECRET environment variable is required');
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export async function decrypt(payload: string): Promise<string> {
  const key = await getEncryptionKey();
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error('Invalid encrypted payload');
  }
  const iv = raw.subarray(0, IV_LEN);
  const authTag = raw.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
