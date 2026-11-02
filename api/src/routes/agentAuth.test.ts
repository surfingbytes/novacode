import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../classes/auth', () => ({ jwtPreHandler: async (): Promise<void> => {} }));
vi.mock('../classes/database', () => ({ db: {} }));
vi.mock('../classes/sessionManager', () => ({ sessionManager: {} }));

import { agentAuthRoutes } from './agentAuth';
import { config } from '../classes/config';
import { OPENCODE_AUTH_FILE } from '../classes/agentAuthStatus';
import { registerErrorHandler } from '../classes/errorHandler';

let app: FastifyInstance;
let configDir: string;
const originalConfigDir = config.configDir;

beforeAll(async () => {
  // Never touch the real /config auth files.
  configDir = mkdtempSync(join(tmpdir(), 'nova-agent-auth-'));
  config.configDir = configDir;
  app = Fastify();
  registerErrorHandler(app);
  await app.register(agentAuthRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  config.configDir = originalConfigDir;
  rmSync(configDir, { recursive: true, force: true });
});

describe('OpenCode login/logout', () => {
  it('logout removes keys stored under both opencode-go and openai', async () => {
    for (const apiKey of ['sk-proj-openai-key-0123456789', 'go-key-0123456789']) {
      const res = await app.inject({ method: 'POST', url: '/api/agent-auth/opencode/login', payload: { apiKey } });
      expect(res.statusCode).toBe(200);
    }
    const authPath = join(configDir, OPENCODE_AUTH_FILE);
    expect(Object.keys(JSON.parse(readFileSync(authPath, 'utf8'))).sort()).toEqual(['openai', 'opencode-go']);

    const res = await app.inject({ method: 'DELETE', url: '/api/agent-auth/opencode/logout' });

    expect(res.statusCode).toBe(204);
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({});
  });
});
