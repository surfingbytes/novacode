// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { db } from '../classes/database';
import { jwtPreHandler } from '../classes/auth';
import { ensureSessionSpec, readSessionSpec } from '../classes/sessionSpec';
import { buildSessionSpecStatus } from '../classes/sessionSpecStatus';
import { broadcastSessionSpecStatus } from '../classes/wsBroadcast';

const SpecParamsSchema = Type.Object({ workspaceId: Type.String(), sessionId: Type.String() });

export async function sessionSpecRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const loadSession = async (workspaceId: string, sessionId: string) => {
    const session = await db.getSession(sessionId);
    return session && session.workspaceId === workspaceId ? session : null;
  };

  // GET /api/workspaces/:workspaceId/sessions/:sessionId/spec — status + file content
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/sessions/:sessionId/spec',
    { preHandler: jwtPreHandler, schema: { params: SpecParamsSchema } },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const session = await loadSession(workspaceId, sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      const [status, spec] = await Promise.all([
        buildSessionSpecStatus(session),
        readSessionSpec(workspaceId, sessionId).catch(() => null)
      ]);
      return reply.send({ status, content: spec?.content ?? null });
    }
  );

  // POST /api/workspaces/:workspaceId/sessions/:sessionId/spec — create the (template) spec file only
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/sessions/:sessionId/spec',
    { preHandler: jwtPreHandler, schema: { params: SpecParamsSchema } },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const session = await loadSession(workspaceId, sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      const spec = await ensureSessionSpec(workspaceId, sessionId, session.name);
      const status = await buildSessionSpecStatus(session);
      broadcastSessionSpecStatus(workspaceId, status);
      return reply.code(201).send({ status, content: spec.content });
    }
  );
}
