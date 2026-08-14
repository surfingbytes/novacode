import { describe, expect, it } from 'vitest';

import {
  clearSessionCookieHeader,
  isSecureRequest,
  parseCookieHeader,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  sessionCookieHeader
} from './sessionCookie';

describe('sessionCookie', () => {
  it('parses a session cookie out of a header', () => {
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=abc.def; other=1`)).toBe('abc.def');
    expect(readSessionCookie('other=1')).toBeNull();
    expect(readSessionCookie(undefined)).toBeNull();
  });

  it('decodes URI-encoded cookie values', () => {
    expect(parseCookieHeader('nc_session=a%2Eb')).toEqual({ nc_session: 'a.b' });
  });

  it('treats forwarded https as secure', () => {
    expect(isSecureRequest({ 'x-forwarded-proto': 'https, http' })).toBe(true);
    expect(isSecureRequest({}, 'http')).toBe(false);
    expect(isSecureRequest({}, 'https')).toBe(true);
  });

  it('builds httpOnly SameSite=Lax cookies', () => {
    const header = sessionCookieHeader('tok', { secure: true });
    expect(header).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(clearSessionCookieHeader(false)).toContain('Max-Age=0');
    expect(clearSessionCookieHeader(false)).not.toContain('Secure');
  });
});
