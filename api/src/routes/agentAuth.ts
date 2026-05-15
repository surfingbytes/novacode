// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// classes
import { jwtPreHandler } from '../classes/auth';
import { config } from '../classes/config';
import { db } from '../classes/database';
import { sessionManager } from '../classes/sessionManager';

const CURSOR_AUTH_FILE = '.config/cursor/auth.json';

export const cursorAuthenticated = (): boolean => {
  const authPath = join(config.configDir, CURSOR_AUTH_FILE);

  if (existsSync(authPath)) return true;
  const env = config.agentEnv();
  const result = spawnSync(config.cursorCommand, ['status'], {
    encoding: 'utf8',
    timeout: 5000,
    cwd: config.configDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) return false;
  const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const lower = out.toLowerCase();
  if (lower.includes('not authenticated') || lower.includes('not logged in')) return false;
  if (out.trim() === '') return false;
  return true;
};

export async function agentAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ─── Cursor auth (UI intact; backend spawning removed in later update) ───

  fastifyInstance.get(
    '/api/agent-auth/cursor/status',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: Type.Object({ authenticated: Type.Boolean() }) } }
    },
    async () => ({ authenticated: cursorAuthenticated() })
  );

  // ─── Claude auth via ACP + token flow ──────────────────────────────────────
  // The PTY login route spawns `claude setup-token` so users can authenticate
  // via browser in the terminal overlay and have the token auto-detected.

  fastifyInstance.post(
    '/api/agent-auth/claude/login',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 201: Type.Object({ sessionId: Type.String() }) } }
    },
    async (_request, reply) => {
      const session = sessionManager.createAuthSession(config.claudeCommand, ['setup-token']);
      return reply.code(201).send({ sessionId: session.id });
    }
  );

  fastifyInstance.post(
    '/api/agent-auth/cursor/login',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 201: Type.Object({ sessionId: Type.String() }) } }
    },
    async (_request, reply) => {
      const session = sessionManager.createAuthSession(config.cursorCommand, ['-f', 'login']);
      return reply.code(201).send({ sessionId: session.id });
    }
  );

  fastifyInstance.delete(
    '/api/agent-auth/cursor/logout',
    { preHandler: jwtPreHandler, schema: { response: { 204: Type.Null() } } },
    async (_request, reply) => {
      const authPath = join(config.configDir, CURSOR_AUTH_FILE);
      if (existsSync(authPath)) rmSync(authPath, { force: true });
      return reply.code(204).send(null);
    }
  );

  fastifyInstance.get(
    '/api/agent-auth/claude/status',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: Type.Object({ authenticated: Type.Boolean() }) } }
    },
    async (request) => {
      const user = await db.getUserById(request.jwtUser!.id);
      return { authenticated: !!user?.claudeToken };
    }
  );

  fastifyInstance.post(
    '/api/agent-auth/claude/token',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({ token: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) }
      }
    },
    async (request) => {
      const { token } = request.body as { token: string };
      const trimmed = token.trim();
      if (!trimmed) return { ok: false };
      await db.updateUser(request.jwtUser!.id, { claudeToken: trimmed });
      return { ok: true };
    }
  );

  fastifyInstance.delete(
    '/api/agent-auth/claude/logout',
    { preHandler: jwtPreHandler, schema: { response: { 204: Type.Null() } } },
    async (request, reply) => {
      await db.updateUser(request.jwtUser!.id, { claudeToken: null });
      return reply.code(204).send(null);
    }
  );
}
