import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_TOKEN_PREFIX = 'nck_';
export const MAX_API_TOKENS_PER_USER = 20;

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateApiToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    token,
    tokenHash: hashApiToken(token),
    tokenPrefix: `${token.slice(0, 12)}…`
  };
}

export function apiTokenHashesEqual(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
