import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';

const mocks = vi.hoisted(() => {
  process.env['JWT_SECRET'] = 'test-secret-'.padEnd(48, 'x');
  return {
    hasAnyUser: vi.fn(),
    createUser: vi.fn(),
    getUserById: vi.fn(),
    getUserByUsername: vi.fn(),
    getUserByApiToken: vi.fn(),
    listApiTokens: vi.fn(),
    clearVibeApiKey: vi.fn()
  };
});

// No database: users and API keys live in these mocks; the real auth helpers sign and verify.
vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    hasAnyUser: (...args: unknown[]) => mocks.hasAnyUser(...args),
    createUser: (...args: unknown[]) => mocks.createUser(...args),
    getUserById: (...args: unknown[]) => mocks.getUserById(...args),
    getUserByUsername: (...args: unknown[]) => mocks.getUserByUsername(...args),
    getUserByApiToken: (...args: unknown[]) => mocks.getUserByApiToken(...args),
    listApiTokens: (...args: unknown[]) => mocks.listApiTokens(...args)
  }
}));

// Setup would otherwise blank the real /config/.vibe/.env.
vi.mock('../classes/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/config')>()),
  clearVibeApiKey: (...args: unknown[]) => mocks.clearVibeApiKey(...args)
}));

import { authRoutes } from './auth';
import { registerAuth } from '../classes/auth';
import { registerErrorHandler } from '../classes/errorHandler';
import { SESSION_COOKIE_NAME } from '../classes/sessionCookie';
import { createNovaMcpToken } from '../classes/novaMcp';

type StoredUser = { id: string; username: string; passwordHash: string };

let app: FastifyInstance;
let users: StoredUser[];

function sessionCookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = new RegExp(`^${SESSION_COOKIE_NAME}=([^;]*)`).exec(header ?? '');
  return match ? decodeURIComponent(match[1]!) : '';
}

async function setupUser(username = 'admin', password = 'correct horse'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  // No rate-limit plugin here: setup allows 5/min and most tests call it.
  registerAuth(app);
  await app.register(authRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.resetAllMocks();
  // The host may run with password login off; these tests need the default.
  vi.stubEnv('AUTH_LOCAL_LOGIN', '');
  users = [];
  mocks.hasAnyUser.mockImplementation(async () => users.length > 0);
  mocks.createUser.mockImplementation(async (username: string, passwordHash: string) => {
    const user = { id: `u${users.length + 1}`, username, passwordHash };
    users.push(user);
    return user;
  });
  mocks.getUserById.mockImplementation(async (id: string) => users.find((u) => u.id === id) ?? null);
  mocks.getUserByUsername.mockImplementation(async (name: string) => users.find((u) => u.username === name) ?? null);
  mocks.getUserByApiToken.mockResolvedValue(null);
  mocks.listApiTokens.mockResolvedValue([]);
});

describe('POST /api/auth/setup', () => {
  it('creates the first user, returns a token and sets the session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: 'correct horse' }
    });

    expect(res.statusCode).toBe(200);
    const { token } = res.json();
    expect(token).toEqual(expect.any(String));
    expect(sessionCookieFrom(res.headers['set-cookie'])).toBe(token);
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
    expect(users).toHaveLength(1);
    expect(users[0]!.passwordHash).not.toContain('correct horse');
    expect(mocks.clearVibeApiKey).toHaveBeenCalledTimes(1);
  });

  it('refuses a second setup once a user exists', async () => {
    await setupUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'intruder', password: 'whatever123' }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Account already exists; sign in instead' });
    expect(users).toHaveLength(1);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'a', password: 'short' } });

    expect(res.statusCode).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password', async () => {
    await setupUser('admin', 'correct horse');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct horse' }
    });

    expect(res.statusCode).toBe(200);
    expect(sessionCookieFrom(res.headers['set-cookie'])).toBe(res.json().token);
  });

  it('answers 401 for a wrong password or unknown user', async () => {
    await setupUser('admin', 'correct horse');

    for (const payload of [
      { username: 'admin', password: 'wrong horse' },
      { username: 'nobody', password: 'correct horse' }
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Invalid credentials' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('answers 403 when password login is disabled', async () => {
    vi.stubEnv('AUTH_LOCAL_LOGIN', 'false');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct horse' }
    });

    expect(res.statusCode).toBe(403);
  });

  it('rate limits login attempts to 10 per minute', async () => {
    const limited = Fastify();
    await limited.register(fastifyRateLimit, { global: false });
    registerAuth(limited);
    await limited.register(authRoutes);
    await limited.ready();
    try {
      const attempt = () =>
        limited.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'x', password: 'y' } });
      for (let i = 0; i < 10; i++) {
        expect((await attempt()).statusCode).toBe(401);
      }
      expect((await attempt()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('POST /api/auth/logout', () => {
  it('expires the session cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });

    expect(res.statusCode).toBe(204);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toMatch(/Max-Age=0/i);
  });
});

describe('protected routes (jwtPreHandler)', () => {
  const url = '/api/auth/api-tokens';

  it('answers 401 without a token', async () => {
    const res = await app.inject({ url });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Missing authorization token' });
    expect(mocks.listApiTokens).not.toHaveBeenCalled();
  });

  it('answers 401 for a forged or garbage token', async () => {
    for (const authorization of ['Bearer not-a-jwt', 'Bearer nck_unknown']) {
      const res = await app.inject({ url, headers: { authorization } });
      expect(res.statusCode, authorization).toBe(401);
      expect(res.json()).toEqual({ error: 'Invalid or expired token' });
    }
    expect(mocks.listApiTokens).not.toHaveBeenCalled();
  });

  it('accepts the session cookie', async () => {
    const token = await setupUser();

    const res = await app.inject({ url, headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` } });

    expect(res.statusCode).toBe(200);
    expect(mocks.listApiTokens).toHaveBeenCalledWith('u1');
  });

  it('accepts a Bearer JWT', async () => {
    const token = await setupUser();

    const res = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(mocks.listApiTokens).toHaveBeenCalledWith('u1');
  });

  it('prefers the Bearer header over the cookie', async () => {
    const token = await setupUser();

    const res = await app.inject({
      url,
      headers: { authorization: 'Bearer nck_revoked', cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` }
    });

    expect(res.statusCode).toBe(401);
  });

  it('accepts a Bearer nck_ API key looked up in the database', async () => {
    await setupUser();
    mocks.getUserByApiToken.mockImplementation(async (token: string) => (token === 'nck_good' ? users[0] : null));

    const res = await app.inject({ url, headers: { authorization: 'Bearer nck_good' } });

    expect(res.statusCode).toBe(200);
    expect(mocks.getUserByApiToken).toHaveBeenCalledWith('nck_good');
    expect(mocks.listApiTokens).toHaveBeenCalledWith('u1');
  });

  it('does not accept a nck_ API key from the cookie path as a JWT', async () => {
    await setupUser();

    const res = await app.inject({ url, headers: { cookie: `${SESSION_COOKIE_NAME}=nck_good` } });

    // Unknown key: looked up as an API key, never verified as a JWT.
    expect(res.statusCode).toBe(401);
    expect(mocks.getUserByApiToken).toHaveBeenCalledWith('nck_good');
  });

  it('rejects an agent nova MCP token', async () => {
    await setupUser();

    const res = await app.inject({ url, headers: { authorization: `Bearer ${createNovaMcpToken('s1')}` } });

    expect(res.statusCode).toBe(401);
  });

  it('answers 401 when the JWT user no longer exists', async () => {
    const token = await setupUser();
    users = [];

    const res = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/auth/validate', () => {
  it('returns the username and refreshes the cookie', async () => {
    const token = await setupUser('admin');

    const res = await app.inject({ method: 'POST', url: '/api/auth/validate', headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, username: 'admin' });
    expect(sessionCookieFrom(res.headers['set-cookie'])).toEqual(expect.any(String));
  });

  it('answers 401 without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/validate' });

    expect(res.statusCode).toBe(401);
  });
});
