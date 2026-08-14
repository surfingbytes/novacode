import { describe, expect, it } from 'vitest';

import { generateApiToken, hashApiToken, isApiKeyToken } from './apiTokens';

describe('apiTokens', () => {
  it('generates an nck_ token whose hash matches', () => {
    const generated = generateApiToken();
    expect(isApiKeyToken(generated.token)).toBe(true);
    expect(generated.tokenHash).toBe(hashApiToken(generated.token));
    expect(generated.tokenPrefix.startsWith('nck_')).toBe(true);
    expect(generated.tokenPrefix.endsWith('…')).toBe(true);
  });

  it('does not treat JWTs as API keys', () => {
    expect(isApiKeyToken('eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe(false);
  });
});
