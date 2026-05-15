// node_modules
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// classes
import { db } from './database';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32;

async function getEncryptionKey(): Promise<Buffer> {
  const envKey = process.env['ENCRYPTION_KEY'];
  if (envKey) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length === KEY_LEN) {
      return buf;
    }
    const b64 = Buffer.from(envKey, 'base64');
    if (b64.length === KEY_LEN) {
      return b64;
    }
  }
  throw new Error('ENCRYPTION_KEY environment variable is required');
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
