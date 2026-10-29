// node_modules
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// classes
import { config, scrubServerSecretsFromEnv, SERVER_SECRET_ENV_KEYS } from './config';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(
    [...SERVER_SECRET_ENV_KEYS, 'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_HOST'].map((key) => [key, process.env[key]])
  );
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('scrubServerSecretsFromEnv', () => {
  it('moves secrets from process.env into config', () => {
    delete process.env['DATABASE_URL'];
    process.env['JWT_SECRET'] = 'boot-jwt-secret';
    process.env['ENCRYPTION_KEY'] = 'boot-encryption-key';
    process.env['VAPID_PRIVATE_KEY'] = 'boot-vapid-private';
    process.env['POSTGRES_USER'] = 'nova';
    process.env['POSTGRES_PASSWORD'] = 'p@ss';
    process.env['POSTGRES_DB'] = 'novadb';
    process.env['POSTGRES_HOST'] = 'db';

    scrubServerSecretsFromEnv();

    for (const key of SERVER_SECRET_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }
    expect(config.jwtSecret).toBe('boot-jwt-secret');
    expect(config.encryptionKey).toBe('boot-encryption-key');
    expect(config.databaseUrl).toBe('postgresql://nova:p%40ss@db:5432/novadb');
  });
});
