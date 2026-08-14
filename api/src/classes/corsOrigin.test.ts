import { describe, expect, it } from 'vitest';

import { resolveCorsOrigin } from './corsOrigin';

describe('resolveCorsOrigin', () => {
  it('reflects any origin outside production when unset', () => {
    expect(resolveCorsOrigin({ NODE_ENV: 'development' })).toBe(true);
  });

  it('disables CORS in production when unset', () => {
    expect(resolveCorsOrigin({ NODE_ENV: 'production' })).toBe(false);
  });

  it('parses an allow-list', () => {
    expect(resolveCorsOrigin({ CORS_ORIGIN: 'https://a.example, https://b.example' })).toEqual([
      'https://a.example',
      'https://b.example'
    ]);
  });

  it('treats * as reflect', () => {
    expect(resolveCorsOrigin({ NODE_ENV: 'production', CORS_ORIGIN: '*' })).toBe(true);
  });
});
