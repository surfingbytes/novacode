// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// classes
import { jwtPreHandler } from '../classes/auth';
import { config } from '../classes/config';
import { db } from '../classes/database';
import { sessionManager } from '../classes/sessionManager';
import {
  cursorAuthErrorCheck,
  cursorAuthTimeoutCheck,
  isAuthRequiredError,
  isTimeoutError,
  type CursorAuthCheck
} from '../classes/agentError';
import { hasAnyOpenCodeAuth } from '../classes/openCodeProviders';

const CURSOR_AUTH_FILE = '.config/cursor/auth.json';
// OpenCode stores provider credentials in its XDG data dir. `config.agentEnv()` sets
// XDG_DATA_HOME=/config/.local/share for spawned OpenCode processes.
const OPENCODE_AUTH_FILE = '.local/share/opencode/auth.json';
const OPENCODE_LEGACY_AUTH_FILE = '.opencode/auth.json';
const CODEX_AUTH_FILE = '.codex/auth.json';

export const checkCursorAuth = (): CursorAuthCheck => {
  const authPath = join(config.configDir, CURSOR_AUTH_FILE);

  if (existsSync(authPath)) {
    return { authenticated: true, status: 'authenticated' };
  }
  const env = config.agentEnv();
  const result = spawnSync(config.cursorCommand, ['status'], {
    encoding: 'utf8',
    timeout: 5000,
    cwd: config.configDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const combinedError = [result.error, out].filter(Boolean).join('\n');

  if (result.error && isTimeoutError(result.error)) return cursorAuthTimeoutCheck();
  if (isTimeoutError(combinedError)) return cursorAuthTimeoutCheck();
  if (isAuthRequiredError(out)) {
    return {
      authenticated: false,
      status: 'unauthenticated',
      message: 'Cursor CLI is not authenticated. Log in to Cursor, then try again.'
    };
  }
  if (result.error) {
    return cursorAuthErrorCheck(result.error.message);
  }
  if (result.status !== 0) {
    return cursorAuthErrorCheck(out.trim() || `Cursor status exited with code ${result.status}`);
  }
  if (out.trim() === '') {
    return cursorAuthErrorCheck('Cursor status returned no output.');
  }
  return { authenticated: true, status: 'authenticated' };
};

export const cursorAuthenticated = (): boolean => {
  return checkCursorAuth().authenticated;
};

export const openCodeAuthenticated = (): boolean => {
  return hasAnyOpenCodeAuth(config.configDir);
};

export async function agentAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ─── Cursor auth (UI intact; backend spawning removed in later update) ───

  fastifyInstance.get(
    '/api/agent-auth/cursor/status',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({
            authenticated: Type.Boolean(),
            status: Type.Union([
              Type.Literal('authenticated'),
              Type.Literal('unauthenticated'),
              Type.Literal('timeout'),
              Type.Literal('error')
            ]),
            message: Type.Optional(Type.String())
          })
        }
      }
    },
    async () => checkCursorAuth()
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
      const session = sessionManager.createAuthSession(config.cursorCommand, ['login']);
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

  // ─── OpenCode auth (file-based config in OPENCODE_HOME) ──────────────────────

  fastifyInstance.get(
    '/api/agent-auth/opencode/status',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: Type.Object({ authenticated: Type.Boolean() }) } }
    },
    async () => ({ authenticated: openCodeAuthenticated() })
  );

  fastifyInstance.post(
    '/api/agent-auth/opencode/login',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({ apiKey: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) }
      }
    },
    async (request, reply) => {
      const { apiKey } = request.body as { apiKey: string };
      const trimmed = apiKey.trim();
      if (!trimmed) return reply.send({ ok: false });
      const authPath = join(config.configDir, OPENCODE_AUTH_FILE);
      const authDir = join(config.configDir, '.local/share/opencode');
      try {
        if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
        let existing: Record<string, unknown> = {};
        if (existsSync(authPath)) {
          try {
            const parsed: unknown = JSON.parse(readFileSync(authPath, 'utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              existing = parsed as Record<string, unknown>;
            }
          } catch {
            existing = {};
          }
        }
        writeFileSync(
          authPath,
          JSON.stringify({ ...existing, 'opencode-go': { key: trimmed, type: 'api' } }, null, 2),
          'utf8'
        );
      } catch (err) {
        console.error('[opencode-login] write error:', err);
        return reply.send({ ok: false });
      }
      const ok = openCodeAuthenticated();
      return reply.send({ ok });
    }
  );



  // ─── Codex auth (file-based config in CODEX_HOME) ──────────────────────

  fastifyInstance.get(
    '/api/agent-auth/codex/status',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: Type.Object({ authenticated: Type.Boolean() }) } }
    },
    async () => ({ authenticated: codexAuthenticated() })
  );

  fastifyInstance.post(
    '/api/agent-auth/codex/login',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({ apiKey: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) }
      }
    },
    async (request, reply) => {
      const { apiKey } = request.body as { apiKey: string };
      const trimmed = apiKey.trim();
      if (!trimmed) return reply.send({ ok: false });
      const authPath = join(config.configDir, CODEX_AUTH_FILE);
      const authDir = join(config.configDir, '.codex');
      try {
        if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
        writeFileSync(authPath, JSON.stringify({ oauth_token: trimmed }, null, 2), 'utf8');
      } catch (err) {
        console.error('[codex-login] write error:', err);
        return reply.send({ ok: false });
      }
      return reply.send({ ok: codexAuthenticated() });
    }
  );

  fastifyInstance.delete(
    '/api/agent-auth/codex/logout',
    { preHandler: jwtPreHandler, schema: { response: { 204: Type.Null() } } },
    async (_request, reply) => {
      const authPath = join(config.configDir, CODEX_AUTH_FILE);
      if (existsSync(authPath)) rmSync(authPath, { force: true });
      return reply.code(204).send(null);
    }
  );

  fastifyInstance.delete(
    '/api/agent-auth/opencode/logout',
    { preHandler: jwtPreHandler, schema: { response: { 204: Type.Null() } } },
    async (_request, reply) => {
      const authPath = join(config.configDir, OPENCODE_AUTH_FILE);
      if (existsSync(authPath)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(authPath, 'utf8'));
          const data =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : {};
          delete data['opencode-go'];
          writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf8');
        } catch {
          rmSync(authPath, { force: true });
        }
      }
      const legacyAuthPath = join(config.configDir, OPENCODE_LEGACY_AUTH_FILE);
      if (existsSync(legacyAuthPath)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(legacyAuthPath, 'utf8'));
          const data =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : {};
          delete data['opencode-go'];
          writeFileSync(legacyAuthPath, JSON.stringify(data, null, 2), 'utf8');
        } catch {
          // ignore malformed legacy auth cleanup
        }
      }
      return reply.code(204).send(null);
    }
  );
}


export const codexAuthenticated = (): boolean => {
  const authPath = join(config.configDir, CODEX_AUTH_FILE);
  if (!existsSync(authPath)) return false;
  try {
    const data = JSON.parse(readFileSync(authPath, 'utf8'));
    const token = data?.oauth_token ?? data?.token ?? data?.access_token;
    return typeof token === 'string' && token.trim().length > 0;
  } catch {
    return false;
  }
};
