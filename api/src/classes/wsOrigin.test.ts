import { describe, expect, it } from 'vitest';

import { isAllowedWsOrigin } from './wsOrigin';

const req = (headers: Record<string, unknown>): { headers: Record<string, unknown> } => ({ headers });

describe('isAllowedWsOrigin', () => {
  it('allows requests without an Origin header (non-browser clients)', () => {
    expect(isAllowedWsOrigin(req({ host: 'nova.example' }), { NODE_ENV: 'production' })).toBe(true);
  });

  it('allows any origin outside production when CORS_ORIGIN is unset', () => {
    expect(isAllowedWsOrigin(req({ origin: 'https://evil.example' }), { NODE_ENV: 'development' })).toBe(true);
  });

  it('allows any origin when CORS_ORIGIN is *', () => {
    expect(
      isAllowedWsOrigin(req({ origin: 'https://evil.example' }), { NODE_ENV: 'production', CORS_ORIGIN: '*' })
    ).toBe(true);
  });

  it('allows the request host (same-origin) in production', () => {
    expect(
      isAllowedWsOrigin(req({ origin: 'https://Nova.example', host: 'nova.example' }), { NODE_ENV: 'production' })
    ).toBe(true);
    expect(
      isAllowedWsOrigin(req({ origin: 'http://localhost:3000', host: 'localhost:3000' }), { NODE_ENV: 'production' })
    ).toBe(true);
  });

  it('allows the forwarded host behind a proxy', () => {
    expect(
      isAllowedWsOrigin(
        req({ origin: 'https://nova.example', host: 'api:3000', 'x-forwarded-host': 'nova.example' }),
        { NODE_ENV: 'production' }
      )
    ).toBe(true);
  });

  it('allows origins in the CORS_ORIGIN allowlist', () => {
    const env = { NODE_ENV: 'production', CORS_ORIGIN: 'https://a.example, https://b.example' };
    expect(isAllowedWsOrigin(req({ origin: 'https://b.example', host: 'nova.example' }), env)).toBe(true);
  });

  it('rejects foreign origins in production', () => {
    expect(
      isAllowedWsOrigin(req({ origin: 'https://evil.example', host: 'nova.example' }), { NODE_ENV: 'production' })
    ).toBe(false);
    expect(
      isAllowedWsOrigin(req({ origin: 'https://nova.example:8443', host: 'nova.example' }), { NODE_ENV: 'production' })
    ).toBe(false);
  });

  it('rejects origins outside the allowlist and malformed origins', () => {
    const env = { CORS_ORIGIN: 'https://a.example' };
    expect(isAllowedWsOrigin(req({ origin: 'https://evil.example', host: 'nova.example' }), env)).toBe(false);
    expect(isAllowedWsOrigin(req({ origin: 'null', host: 'nova.example' }), env)).toBe(false);
  });
});
