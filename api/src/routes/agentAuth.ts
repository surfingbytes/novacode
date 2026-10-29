// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// classes
import { jwtPreHandler } from '../classes/auth';
import { config } from '../classes/config';
import { db } from '../classes/database';
import { sessionManager } from '../classes/sessionManager';
import { looksLikeOpenAiApiKey } from '../classes/openCodeProviders';
import {
  checkCursorAuth,
  clearCursorAuthCache,
  codexAuthenticated,
  CODEX_AUTH_FILE,
  CURSOR_AUTH_FILE,
  openCodeAuthenticated,
  OPENCODE_AUTH_FILE,
  OPENCODE_LEGACY_AUTH_FILE
} from '../classes/agentAuthStatus';
import {
  clearCursorUsageSummaryCache,
  getCursorUsageSummary
} from '../classes/cursorUsageSummary';
import { logger } from '../classes/logger';

const cursorUsageBucketSchema = Type.Object({
  enabled: Type.Boolean(),
  usedCents: Type.Number(),
  limitCents: Type.Union([Type.Number(), Type.Null()]),
  remainingCents: Type.Union([Type.Number(), Type.Null()])
});

const cursorUsageSummaryResponseSchema = Type.Object({
  authenticated: Type.Boolean(),
  available: Type.Boolean(),
  billingCycleStart: Type.Optional(Type.String()),
  billingCycleEnd: Type.Optional(Type.String()),
  membershipType: Type.Optional(Type.String()),
  limitType: Type.Optional(Type.String()),
  isUnlimited: Type.Optional(Type.Boolean()),
  individual: Type.Optional(cursorUsageBucketSchema),
  teamOnDemand: Type.Optional(cursorUsageBucketSchema),
  error: Type.Optional(Type.String()),
  fetchedAt: Type.Optional(Type.Number())
});

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
      clearCursorAuthCache();
      clearCursorUsageSummaryCache();
      return reply.code(204).send(null);
    }
  );

  // ─── Cursor account usage (dashboard usage-summary via agent login token) ───
  // Uses ~/.config/cursor/auth.json from `cursor-agent login` — no Org/Admin API key.

  fastifyInstance.get(
    '/api/agent-auth/cursor/usage',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: cursorUsageSummaryResponseSchema } }
    },
    async () => getCursorUsageSummary(config.configDir)
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
        const providerId = looksLikeOpenAiApiKey(trimmed) ? 'openai' : 'opencode-go';
        writeFileSync(
          authPath,
          JSON.stringify({ ...existing, [providerId]: { key: trimmed, type: 'api' } }, null, 2),
          'utf8'
        );
      } catch (err) {
        logger.error({ err }, 'opencode-login: write error');
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
        logger.error({ err }, 'codex-login: write error');
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
