// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import {
  checkCredentials,
  signToken,
  extractBearerToken,
  verifyToken,
  createAuthUser,
  changePassword,
  changeUsername,
  jwtPreHandler
} from '../classes/auth';
import { db } from '../classes/database';
import { clearVibeApiKey, config } from '../classes/config';

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

  // POST /api/auth/setup — create initial admin user
  fastifyInstance.post(
    '/api/auth/setup',
    {
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
      return { token };
    }
  );

  // POST /api/auth/login — authenticate and return token
  fastifyInstance.post(
    '/api/auth/login',
    {
      schema: {
        body: Type.Object({
          username: Type.String({ minLength: 1 }),
          password: Type.String({ minLength: 1 })
        }),
        response: {
          200: Type.Object({ token: Type.String() }),
          401: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { username, password } = request.body;
      const user = await checkCredentials(username, password);
      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }
      const token = await signToken(user.username, user.id);
      return { token };
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
      const token = extractBearerToken(request);
      if (!token) {
        return reply.code(401).send({ error: 'No token' });
      }
      try {
        const payload = await verifyToken(token);
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
      return { token };
    }
  );
}
