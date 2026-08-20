// node_modules
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import {
  checkCredentials,
  signToken,
  extractRequestToken,
  verifyToken,
  createAuthUser,
  changePassword,
  changeUsername,
  jwtPreHandler,
  attachSessionCookie,
  clearSessionCookie
} from '../classes/auth';
import { db } from '../classes/database';
import { clearVibeApiKey, config } from '../classes/config';
import { generateApiToken, MAX_API_TOKENS_PER_USER } from '../classes/apiTokens';
import { logger } from '../classes/logger';
import {
  beginOidcAuthorization,
  completeOidcAuthorization,
  clearOidcPendingCookieHeader,
  isLocalLoginEnabled,
  oidcLoginPageUrl,
  oidcPendingCookieHeader,
  publicRequestOrigin,
  readOidcPending,
  readOidcSettings,
  resolveLoginOptions,
  resolveOidcAppOrigin,
  resolveOidcCallbackUri,
  sanitizeAppRedirect,
  signOidcPending
} from '../classes/oidc';
import { isSecureRequest, sessionCookieHeader } from '../classes/sessionCookie';

function requestOrigin(request: FastifyRequest): string {
  return publicRequestOrigin({
    headers: request.headers as Record<string, unknown>,
    protocol: request.protocol,
    hostname: request.hostname
  });
}

function requestSecure(request: FastifyRequest): boolean {
  return isSecureRequest(request.headers as Record<string, unknown>, request.protocol);
}

function requestCookieHeader(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  return typeof header === 'string' ? header : undefined;
}

function setCookies(reply: FastifyReply, cookies: string[]): void {
  if (cookies.length === 1) {
    reply.header('Set-Cookie', cookies[0]);
    return;
  }
  reply.header('Set-Cookie', cookies);
}

const LoginOptionsSchema = Type.Object({
  needsSetup: Type.Boolean(),
  localLogin: Type.Boolean(),
  oidcEnabled: Type.Boolean(),
  oidcDisplayName: Type.String()
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/auth/needs-setup — check if any user exists (setup required)
  fastifyInstance.get(
    '/api/auth/needs-setup',
    {
      schema: {
        response: { 200: Type.Object({ needsSetup: Type.Boolean() }) }
      }
    },
    async () => {
      const hasUser = await db.hasAnyUser();
      return { needsSetup: !hasUser };
    }
  );

  // GET /api/auth/login-options — which sign-in methods the login page should show
  fastifyInstance.get(
    '/api/auth/login-options',
    {
      schema: {
        response: { 200: LoginOptionsSchema }
      }
    },
    async () => {
      const needsSetup = !(await db.hasAnyUser());
      return resolveLoginOptions({ needsSetup });
    }
  );

  // POST /api/auth/setup — create initial admin user
  fastifyInstance.post(
    '/api/auth/setup',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' }
      },
      schema: {
        body: Type.Object({
          username: Type.String({ minLength: 1, maxLength: 128 }),
          password: Type.String({ minLength: 8 })
        }),
        response: {
          200: Type.Object({ token: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      if (await db.hasAnyUser()) {
        return reply.code(400).send({ error: 'Account already exists; sign in instead' });
      }
      const { username, password } = request.body;
      const user = await createAuthUser(username, password);
      clearVibeApiKey(config.configDir);
      const token = await signToken(user.username, user.id);
      attachSessionCookie(request, reply, token);
      return { token };
    }
  );

  // POST /api/auth/login — authenticate and return token
  fastifyInstance.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      },
      schema: {
        body: Type.Object({
          username: Type.String({ minLength: 1 }),
          password: Type.String({ minLength: 1 })
        }),
        response: {
          200: Type.Object({ token: Type.String() }),
          401: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      if (!isLocalLoginEnabled()) {
        return reply.code(403).send({ error: 'Password login is disabled' });
      }
      const { username, password } = request.body;
      const user = await checkCredentials(username, password);
      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }
      const token = await signToken(user.username, user.id);
      attachSessionCookie(request, reply, token);
      return { token };
    }
  );

  // POST /api/auth/logout — clear the session cookie
  fastifyInstance.post(
    '/api/auth/logout',
    {
      schema: {
        response: {
          204: Type.Null()
        }
      }
    },
    async (request, reply) => {
      clearSessionCookie(request, reply);
      return reply.code(204).send(null);
    }
  );

  // GET /api/auth/oidc/start — redirect to the identity provider
  fastifyInstance.get(
    '/api/auth/oidc/start',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      },
      schema: {
        querystring: Type.Object({
          redirect: Type.Optional(Type.String())
        })
      }
    },
    async (request, reply) => {
      const origin = requestOrigin(request);
      const appRedirect = sanitizeAppRedirect(request.query.redirect);
      const settings = readOidcSettings();
      if (!settings) {
        return reply.redirect(oidcLoginPageUrl(origin, { error: 'oidc_config' }));
      }
      const callbackUri = resolveOidcCallbackUri(settings, origin);
      const appOrigin = resolveOidcAppOrigin(settings, callbackUri);
      if (!(await db.hasAnyUser())) {
        return reply.redirect(`${appOrigin}/setup`);
      }
      try {
        const { authorizationUrl, pending } = await beginOidcAuthorization(settings, {
          appRedirect,
          callbackUri
        });
        setCookies(reply, [
          oidcPendingCookieHeader(signOidcPending(pending), { secure: requestSecure(request) })
        ]);
        return reply.redirect(authorizationUrl);
      } catch (err) {
        logger.warn({ err }, 'OIDC discovery or authorization start failed');
        return reply.redirect(
          oidcLoginPageUrl(appOrigin, { error: 'oidc_config', redirect: appRedirect })
        );
      }
    }
  );

  // GET /api/auth/oidc/callback — identity provider returns here
  fastifyInstance.get(
    '/api/auth/oidc/callback',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      },
      schema: {
        querystring: Type.Object(
          {
            code: Type.Optional(Type.String()),
            state: Type.Optional(Type.String()),
            error: Type.Optional(Type.String()),
            error_description: Type.Optional(Type.String())
          },
          { additionalProperties: true }
        )
      }
    },
    async (request, reply) => {
      const origin = requestOrigin(request);
      const secure = requestSecure(request);
      const settings = readOidcSettings();
      const pending = readOidcPending(requestCookieHeader(request));
      const clearPending = clearOidcPendingCookieHeader(secure);

      const fail = (appOrigin: string, error: string, appRedirect = '/'): FastifyReply => {
        setCookies(reply, [clearPending]);
        return reply.redirect(oidcLoginPageUrl(appOrigin, { error, redirect: appRedirect }));
      };

      if (!settings || !pending) {
        return fail(origin, 'oidc');
      }

      const appOrigin = resolveOidcAppOrigin(settings, pending.redirectUri);
      const callbackUrl = new URL(pending.redirectUri);
      const incoming = new URL(request.raw.url ?? request.url, origin);
      callbackUrl.search = incoming.search;

      const result = await completeOidcAuthorization(settings, pending, callbackUrl);
      if (!result.ok) {
        logger.warn({ error: result.error }, 'OIDC callback failed');
        return fail(appOrigin, result.error, pending.redirect);
      }

      const user = await db.getFirstUser();
      if (!user) {
        setCookies(reply, [clearPending]);
        return reply.redirect(`${appOrigin}/setup`);
      }

      const token = await signToken(user.username, user.id);
      setCookies(reply, [sessionCookieHeader(token, { secure }), clearPending]);
      return reply.redirect(
        oidcLoginPageUrl(appOrigin, { from: 'oidc', redirect: pending.redirect })
      );
    }
  );

  // POST /api/auth/validate — validate token and return username
  fastifyInstance.post(
    '/api/auth/validate',
    {
      schema: {
        response: {
          200: Type.Object({ valid: Type.Boolean(), username: Type.String() }),
          401: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const token = extractRequestToken(request);
      if (!token) {
        return reply.code(401).send({ error: 'No token' });
      }
      try {
        const payload = await verifyToken(token);
        const refreshed = await signToken(payload.username, payload.id);
        attachSessionCookie(request, reply, refreshed);
        return { valid: true, username: payload.username };
      } catch {
        return reply.code(401).send({ error: 'Invalid token' });
      }
    }
  );

  // PUT /api/auth/change-password — change password for authenticated user
  fastifyInstance.put(
    '/api/auth/change-password',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          currentPassword: Type.String({ minLength: 1 }),
          newPassword: Type.String({ minLength: 8 })
        }),
        response: {
          200: Type.Object({ ok: Type.Boolean() }),
          400: Type.Object({ error: Type.String() }),
          401: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const ok = await changePassword(request.jwtUser!.id, currentPassword, newPassword);
      if (!ok) {
        return reply.code(400).send({ error: 'Current password is incorrect' });
      }
      return { ok: true };
    }
  );

  // PUT /api/auth/change-username — change username and return new token
  fastifyInstance.put(
    '/api/auth/change-username',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          newUsername: Type.String({ minLength: 1, maxLength: 128 })
        }),
        response: {
          200: Type.Object({ token: Type.String() }),
          400: Type.Object({ error: Type.String() }),
          401: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { newUsername } = request.body;
      const user = await changeUsername(request.jwtUser!.id, newUsername);
      if (!user) {
        return reply.code(400).send({
          error: 'Password is incorrect or username is already taken'
        });
      }
      const token = await signToken(user.username, user.id);
      attachSessionCookie(request, reply, token);
      return { token };
    }
  );

  const ApiTokenSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    tokenPrefix: Type.String(),
    createdAt: Type.String(),
    lastUsedAt: Type.Union([Type.String(), Type.Null()])
  });

  // GET /api/auth/api-tokens — list hashed API keys (secret never returned)
  fastifyInstance.get(
    '/api/auth/api-tokens',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Array(ApiTokenSchema)
        }
      }
    },
    async (request) => {
      return db.listApiTokens(request.jwtUser!.id);
    }
  );

  // POST /api/auth/api-tokens — create a key; plaintext token is returned once
  fastifyInstance.post(
    '/api/auth/api-tokens',
    {
      preHandler: jwtPreHandler,
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      },
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 64 })
        }),
        response: {
          201: Type.Intersect([ApiTokenSchema, Type.Object({ token: Type.String() })]),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!name) {
        return reply.code(400).send({ error: 'Name is required' });
      }
      const count = await db.countApiTokens(request.jwtUser!.id);
      if (count >= MAX_API_TOKENS_PER_USER) {
        return reply.code(400).send({
          error: `At most ${MAX_API_TOKENS_PER_USER} API keys are allowed`
        });
      }
      const generated = generateApiToken();
      try {
        const created = await db.createApiToken({
          userId: request.jwtUser!.id,
          name,
          tokenHash: generated.tokenHash,
          tokenPrefix: generated.tokenPrefix
        });
        return reply.code(201).send({ ...created, token: generated.token });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create API key';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // DELETE /api/auth/api-tokens/:id — revoke
  fastifyInstance.delete(
    '/api/auth/api-tokens/:id',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          204: Type.Null(),
          404: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const deleted = await db.deleteApiToken(request.jwtUser!.id, id);
      if (!deleted) {
        return reply.code(404).send({ error: 'API key not found' });
      }
      return reply.code(204).send(null);
    }
  );
}
