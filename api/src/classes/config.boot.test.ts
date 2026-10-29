// node_modules
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// classes
import { assertBootConfig, config, parsePort } from './config';

const VALID_JWT_SECRET = 'a'.repeat(32);
const KEYS = ['JWT_SECRET', 'PORT', 'ENCRYPTION_KEY'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env['JWT_SECRET'] = VALID_JWT_SECRET;
  delete process.env['PORT'];
  delete process.env['ENCRYPTION_KEY'];
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('assertBootConfig', () => {
  it('accepts a valid config without ENCRYPTION_KEY', () => {
    expect(() => assertBootConfig()).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    process.env['JWT_SECRET'] = '';
    expect(() => assertBootConfig()).toThrow('JWT_SECRET environment variable is required');
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    process.env['JWT_SECRET'] = 'a'.repeat(31);
    expect(() => assertBootConfig()).toThrow('JWT_SECRET must be at least 32 characters (got 31)');
  });

  it('still rejects the example placeholder', () => {
    process.env['JWT_SECRET'] = 'change_this_to_a_long_random_string';
    expect(() => assertBootConfig()).toThrow('not the example placeholder');
  });

  it.each(['0', '65536', 'abc', '3000abc', '-1', '80.5', ''])('rejects PORT=%j', (port) => {
    process.env['PORT'] = port;
    expect(() => assertBootConfig()).toThrow('PORT must be an integer between 1 and 65535');
  });

  it('accepts a valid PORT and exposes it as a number', () => {
    process.env['PORT'] = '8080';
    expect(() => assertBootConfig()).not.toThrow();
    expect(config.port).toBe(8080);
  });

  it('rejects an ENCRYPTION_KEY that is not 32 bytes', () => {
    process.env['ENCRYPTION_KEY'] = 'abcd';
    expect(() => assertBootConfig()).toThrow('ENCRYPTION_KEY must be 32 bytes, hex or base64 encoded');
  });

  it('accepts a 32-byte hex or base64 ENCRYPTION_KEY', () => {
    process.env['ENCRYPTION_KEY'] = 'ab'.repeat(32);
    expect(() => assertBootConfig()).not.toThrow();
    process.env['ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertBootConfig()).not.toThrow();
  });
});

describe('parsePort', () => {
  it('parses integers in range only', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort(' 65535 ')).toBe(65535);
    expect(parsePort('65536')).toBeNull();
    expect(parsePort('1e3')).toBeNull();
  });
});
