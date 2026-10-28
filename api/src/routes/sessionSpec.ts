// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { db } from '../classes/database';
import { jwtPreHandler } from '../classes/auth';
import {
  ensureSessionSpec,
  isChatNewerThanSpec,
  readSessionSpec,
  sessionSpecPath,
  specHasContent
} from '../classes/sessionSpec';
import { broadcastSessionSpecStatus } from './ws';

// types
import type { SessionSpecStatus } from '../@types/index';

const SpecParamsSchema = Type.Object({ workspaceId: Type.String(), sessionId: Type.String() });

interface SpecSession {
  id: string;
  name: string;
  workspaceId: string;
  agentType: string;
  modelSelection: string;
  updatedAt: string;
}

async function buildSessionSpecStatus(session: SpecSession): Promise<SessionSpecStatus> {
  const [spec, orchestrator] = await Promise.all([
    readSessionSpec(session.workspaceId, session.id).catch(() => null),
    db.getLatestOrchestratorBySourceSession(session.id)
  ]);
  return {
    sessionId: session.id,
    exists: !!spec,
    hasContent: spec ? specHasContent(spec.content) : false,
    path: sessionSpecPath(session.workspaceId, session.id),
    updatedAt: spec?.updatedAt ?? null,
    orchestratorId: orchestrator?.id ?? null,
    bChatNewerThanSpec: spec ? isChatNewerThanSpec(session.updatedAt, spec.updatedAt) : false
  };
}

/** Push the spec status of a session to its workspace (after the nova MCP wrote the spec). */
export async function publishSpecStatus(sessionId: string): Promise<void> {
  const session = await db.getSession(sessionId);
  if (!session) return;
  broadcastSessionSpecStatus(session.workspaceId, await buildSessionSpecStatus(session));
}

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
      if (!session) return reply.status(404).send({ error: 'Session not found' });
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
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      const spec = await ensureSessionSpec(workspaceId, sessionId, session.name);
      const status = await buildSessionSpecStatus(session);
      broadcastSessionSpecStatus(workspaceId, status);
      return reply.status(201).send({ status, content: spec.content });
    }
  );
}
