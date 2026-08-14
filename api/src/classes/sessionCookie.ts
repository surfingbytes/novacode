/** httpOnly session cookie for dashboard JWTs. API keys stay on Authorization. */

export const SESSION_COOKIE_NAME = 'nc_session';
export const JWT_EXPIRES_IN = '7d';
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    if (!key) {
      continue;
    }
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  const token = parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME];
  return token ? token : null;
}

export function isSecureRequest(headers: Record<string, unknown>, protocol?: string): boolean {
  if (protocol === 'https') {
    return true;
  }
  const forwarded = headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof proto === 'string') {
    return proto.split(',')[0]?.trim() === 'https';
  }
  return false;
}

export function sessionCookieHeader(
  token: string,
  opts: { secure: boolean; maxAgeSec?: number }
): string {
  const maxAge = opts.maxAgeSec ?? SESSION_MAX_AGE_SEC;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
