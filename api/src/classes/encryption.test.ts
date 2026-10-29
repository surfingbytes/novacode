// node_modules
import { afterEach, describe, expect, it } from 'vitest';

// classes
import { decrypt, encrypt } from './encryption';

afterEach(() => {
  delete process.env['ENCRYPTION_KEY'];
  delete process.env['JWT_SECRET'];
});

describe('encryption', () => {
  it('round-trips with ENCRYPTION_KEY', async () => {
    process.env['ENCRYPTION_KEY'] = 'c'.repeat(64);
    const payload = await encrypt('secret');
    expect(payload).not.toContain('secret');
    expect(await decrypt(payload)).toBe('secret');
  });

  it('derives a key from JWT_SECRET when ENCRYPTION_KEY is unset', async () => {
    process.env['JWT_SECRET'] = 'jwt-secret-a';
    const payload = await encrypt('secret');
    expect(await decrypt(payload)).toBe('secret');

    process.env['JWT_SECRET'] = 'jwt-secret-b';
    await expect(decrypt(payload)).rejects.toThrow();
  });

  it('rejects a malformed ENCRYPTION_KEY instead of falling back', async () => {
    process.env['ENCRYPTION_KEY'] = 'too-short';
    process.env['JWT_SECRET'] = 'jwt-secret-a';
    await expect(encrypt('secret')).rejects.toThrow(/32 bytes/);
  });
});
