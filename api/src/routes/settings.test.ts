import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';

const mocks = vi.hoisted(() => {
  process.env['JWT_SECRET'] = 'test-secret-'.padEnd(48, 'x');
  return {
    getUserById: vi.fn(),
    getUserByUsername: vi.fn(),
    getUserByApiToken: vi.fn(),
    readSshKeyMaterial: vi.fn()
  };
});

// No database: the one user lives in these mocks; the real auth helpers sign and verify.
vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    getUserById: (...args: unknown[]) => mocks.getUserById(...args),
    getUserByUsername: (...args: unknown[]) => mocks.getUserByUsername(...args),
    getUserByApiToken: (...args: unknown[]) => mocks.getUserByApiToken(...args)
  }
}));

// Never read the real /config/.ssh keypair.
vi.mock('../classes/sshKey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/sshKey')>()),
  readSshKeyMaterial: (...args: unknown[]) => mocks.readSshKeyMaterial(...args)
}));

import { settingsRoutes } from './settings';
import { registerAuth, signToken } from '../classes/auth';
import { registerErrorHandler } from '../classes/errorHandler';

const USER = { id: 'u1', username: 'admin', passwordHash: 'x', tokenVersion: 0 };
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----';

let app: FastifyInstance;
let authorization: string;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  registerAuth(app);
  await app.register(settingsRoutes);
  await app.ready();
  authorization = `Bearer ${await signToken(USER.username, USER.id, USER.tokenVersion)}`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUserById.mockImplementation(async (id: string) => (id === USER.id ? USER : null));
  mocks.getUserByUsername.mockImplementation(async (name: string) => (name === USER.username ? USER : null));
  mocks.getUserByApiToken.mockResolvedValue(null);
  mocks.readSshKeyMaterial.mockReturnValue({ sshPublicKey: 'ssh-ed25519 AAAA test', sshPrivateKey: PRIVATE_KEY });
});

describe('GET /api/settings', () => {
  it('reports whether a private key exists without returning it', async () => {
    const res = await app.inject({ url: '/api/settings', headers: { authorization } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty('sshPrivateKey');
    expect(body.hasSshPrivateKey).toBe(true);
    expect(body.sshPublicKey).toBe('ssh-ed25519 AAAA test');
    expect(res.body).not.toContain('PRIVATE KEY');
  });

  it('answers hasSshPrivateKey false when there is no key', async () => {
    mocks.readSshKeyMaterial.mockReturnValue({ sshPublicKey: '', sshPrivateKey: '' });

    const res = await app.inject({ url: '/api/settings', headers: { authorization } });

    expect(res.statusCode).toBe(200);
    expect(res.json().hasSshPrivateKey).toBe(false);
  });
});

describe('GET /api/settings/ssh-private-key', () => {
  const url = '/api/settings/ssh-private-key';

  it('returns the private key with Cache-Control no-store', async () => {
    const res = await app.inject({ url, headers: { authorization } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sshPrivateKey: PRIVATE_KEY });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 when there is no key', async () => {
    mocks.readSshKeyMaterial.mockReturnValue({ sshPublicKey: '', sshPrivateKey: '' });

    const res = await app.inject({ url, headers: { authorization } });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No SSH key' });
  });

  it('answers 401 without a token', async () => {
    const res = await app.inject({ url });

    expect(res.statusCode).toBe(401);
    expect(mocks.readSshKeyMaterial).not.toHaveBeenCalled();
  });

  it('rate limits reads to 5 per minute', async () => {
    const limited = Fastify();
    await limited.register(fastifyRateLimit, { global: false });
    registerAuth(limited);
    await limited.register(settingsRoutes);
    await limited.ready();
    try {
      for (let i = 0; i < 5; i++) {
        expect((await limited.inject({ url, headers: { authorization } })).statusCode).toBe(200);
      }
      expect((await limited.inject({ url, headers: { authorization } })).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
