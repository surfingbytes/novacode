import { describe, expect, it } from 'vitest';

import { extractWsToken } from './wsToken';

describe('extractWsToken', () => {
  it('reads the bearer subprotocol', () => {
    const token = extractWsToken({
      headers: { 'sec-websocket-protocol': 'bearer.abc.def' }
    });
    expect(token).toBe('abc.def');
  });

  it('picks bearer among multiple subprotocols', () => {
    const token = extractWsToken({
      headers: { 'sec-websocket-protocol': 'chat, bearer.the-jwt, extra' }
    });
    expect(token).toBe('the-jwt');
  });

  it('ignores a query-string token', () => {
    const token = extractWsToken({
      headers: {},
      // @ts-expect-error leftover query must not be consulted
      query: { token: 'should-not-be-used' }
    });
    expect(token).toBeNull();
  });

  it('returns null when no bearer subprotocol is present', () => {
    expect(extractWsToken({ headers: { 'sec-websocket-protocol': 'chat' } })).toBeNull();
    expect(extractWsToken({ headers: {} })).toBeNull();
  });

  it('falls back to the session cookie', () => {
    expect(
      extractWsToken({
        headers: { cookie: 'nc_session=cookie-jwt; other=1' }
      })
    ).toBe('cookie-jwt');
  });
});
