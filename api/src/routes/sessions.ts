// node_modules
import { FastifyInstance } from 'fastify';

// classes
import { db, normalizeTagStringList } from '../classes/database';
import { normalizeSessionForApi } from '../classes/sessionNormalize';
import { jwtPreHandler } from '../classes/auth';
import { createSessionWithAgent } from '../classes/sessionService';
import { closeAcpSessionForNovaSession } from '../classes/acpSessionClose';
import { mergeInternalSessionConfig } from '../classes/linkedPlanContext';
import { listPlanDocumentsForAcpSession } from '../classes/planDocuments';
import { getActiveSessionIds, cancelRun } from './chat';
import { deleteSessionImages } from './images';
import {
  broadcastWorkspaceSessionDeleted,
  broadcastWorkspaceSessionUpsert,
  broadcastWorkspaceSessionsRefresh
} from './ws';

// types
import type { AgentType } from '../@types/index';
import type { LinkedPlanContext } from '../classes/linkedPlanContext';

// -------------------------------------------------- Helpers --------------------------------------------------

function parseTagsFromBody(body: unknown): string[] | null | undefined {
  if (!body || typeof body !== 'object' || !('tags' in body)) {
    return undefined;
  }
  const raw = (body as Record<string, unknown>)['tags'];
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  if (Array.isArray(raw)) {
    const normalizedTags = normalizeTagStringList(raw);
    return normalizedTags.length > 0 ? normalizedTags : null;
  }
  if (typeof raw === 'string') {
    const trimmedRawTags = raw.trim();
    if (!trimmedRawTags) {
      return null;
    }
    const normalizedTags = normalizeTagStringList(
      trimmedRawTags.split(',').map((tag) => tag.trim()),
    );
    return normalizedTags.length > 0 ? normalizedTags : null;
  }
  return null;
}

export async function sessionsRoutes(fastify: FastifyInstance): Promise<void> {
  // -------------------------------------------------- Session listing --------------------------------------------------

  // GET /api/sessions
  fastify.get('/api/sessions', { preHandler: jwtPreHandler }, async (_request, reply) => {
    const activeSessionIds = getActiveSessionIds();
    const allWorkspaces = await db.listWorkspaces({ includeArchived: true });
    const sessionsByWorkspace = await Promise.all(
      allWorkspaces.map((workspace) =>
        Promise.all([
          db.listSessionsByWorkspace(workspace.id, { archived: false }),
          db.listSessionsByWorkspace(workspace.id, { archived: true }),
        ]),
      ),
    );
    const allSessions = sessionsByWorkspace
      .flatMap(([active, archived]) => [...active, ...archived])
      .map((session) => ({
        ...normalizeSessionForApi(session),
        busy: activeSessionIds.has(session.id),
      }));
    await db.enrichSessionListPreviews(allSessions);
    return reply.send(allSessions);
  });

  // -------------------------------------------------- Session create --------------------------------------------------

  // POST /api/workspaces/:workspaceId/sessions
  fastify.post(
    '/api/workspaces/:workspaceId/sessions',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const body = request.body as {
        name: string;
        tags?: string[] | string | null;
        agentType?: AgentType;
        modelSelection?: string | null;
        linkedPlanContext?: LinkedPlanContext | null;
        sessionMode?: string | null;
      };

      const tagsParsed = parseTagsFromBody(request.body);
      const result = await createSessionWithAgent({
        workspaceId,
        name: body.name,
        tags: tagsParsed === undefined ? null : tagsParsed,
        agentType: body.agentType,
        modelSelection: body.modelSelection ?? undefined,
        linkedPlanContext: body.linkedPlanContext ?? undefined,
        sessionMode: body.sessionMode ?? undefined,
      });

      if (result.error) {
        const status = result.error === 'Workspace not found' ? 404 : 502;
        return reply.status(status).send({
          error: result.error === 'Workspace not found' ? result.error : 'Failed to create chat',
          ...(status === 502 ? { details: result.error } : {}),
        });
      }
      if (!result.session) {
        return reply.status(500).send({ error: 'Failed to create session' });
      }

      const normalized = normalizeSessionForApi(result.session);
      broadcastWorkspaceSessionUpsert(workspaceId, normalized);
      return reply.status(201).send(normalized);
    }
  );

  // -------------------------------------------------- Session list/get/update --------------------------------------------------

  // GET /api/workspaces/:workspaceId/sessions
  fastify.get(
    '/api/workspaces/:workspaceId/sessions',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const query = request.query as { archived?: string };
      const archived =
        query.archived === 'true' ? true : query.archived === 'false' ? false : undefined;
      const sessions = await db.listSessionsByWorkspace(workspaceId, { archived });
      const activeSessionIds = getActiveSessionIds();
      const enriched = sessions.map((session) => ({
        ...normalizeSessionForApi(session),
        busy: activeSessionIds.has(session.id),
      }));
      await db.enrichSessionListPreviews(enriched);
      return reply.send(enriched);
    }
  );

  // GET /api/workspaces/:workspaceId/sessions/:sessionId
  fastify.get(
    '/api/workspaces/:workspaceId/sessions/:sessionId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as {
        workspaceId: string;
        sessionId: string;
      };
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return reply.send({
        ...normalizeSessionForApi(session),
        planDocuments: await listPlanDocumentsForAcpSession(session.sessionId),
      });
    }
  );

  // PATCH /api/workspaces/:workspaceId/sessions/:sessionId
  fastify.patch(
    '/api/workspaces/:workspaceId/sessions/:sessionId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as {
        workspaceId: string;
        sessionId: string;
      };
      const body = request.body as {
        name?: string;
        tags?: string[] | string | null;
        archived?: boolean;
        modelSelection?: string;
        sessionMode?: string;
        sessionConfigJson?: Record<string, string> | null;
      };
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const patch: {
        name?: string;
        tags?: string[] | null;
        archived?: boolean;
        modelSelection?: string;
        sessionMode?: string;
        sessionConfigJson?: string | null;
      } = {};
      if (body.name !== undefined) {
        patch.name = body.name;
      }
      if ('tags' in (request.body as object)) {
        patch.tags = parseTagsFromBody(request.body) ?? null;
      }
      if (body.archived !== undefined) {
        patch.archived = body.archived;
      }
      if (body.modelSelection !== undefined) {
        patch.modelSelection = body.modelSelection;
      }
      if (body.sessionMode !== undefined) {
        patch.sessionMode = body.sessionMode;
      }
      if (body.sessionConfigJson !== undefined) {
        patch.sessionConfigJson = mergeInternalSessionConfig(
          session.sessionConfigJson,
          body.sessionConfigJson
        );
      }
      const updated = await db.updateSession(sessionId, patch);
      if (!updated) {
        return reply.status(500).send({ error: 'Failed to update session' });
      }
      const normalized = normalizeSessionForApi(updated);
      broadcastWorkspaceSessionUpsert(workspaceId, normalized);
      return reply.send(normalized);
    }
  );

  // -------------------------------------------------- Session bulk actions --------------------------------------------------

  // POST /api/workspaces/:workspaceId/sessions/bulk-delete
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/bulk-delete',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids must be a non-empty array' });
      }
      for (const id of ids) {
        cancelRun(id);
        await closeAcpSessionForNovaSession(id);
      }
      const count = await db.deleteManySessions(ids, workspaceId);
      // clean up uploaded images for each session (non-critical)
      await Promise.all(ids.map((sessionId) => deleteSessionImages(sessionId)));
      broadcastWorkspaceSessionsRefresh(workspaceId);
      return reply.send({ deleted: count });
    }
  );

  // POST /api/workspaces/:workspaceId/sessions/bulk-archive
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/bulk-archive',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const { ids, archived } = request.body as { ids: string[]; archived: boolean };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids must be a non-empty array' });
      }
      const count = await db.archiveManySessions(ids, workspaceId, archived);
      broadcastWorkspaceSessionsRefresh(workspaceId);
      return reply.send({ updated: count });
    }
  );

  // -------------------------------------------------- Session delete --------------------------------------------------

  // DELETE /api/workspaces/:workspaceId/sessions/:sessionId
  fastify.delete(
    '/api/workspaces/:workspaceId/sessions/:sessionId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as {
        workspaceId: string;
        sessionId: string;
      };
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      cancelRun(sessionId);
      await closeAcpSessionForNovaSession(sessionId);
      const success = await db.deleteSession(sessionId);
      if (!success) {
        return reply.status(500).send({ error: 'Failed to delete session' });
      }
      // clean up uploaded images for this session (non-critical)
      await deleteSessionImages(sessionId);
      broadcastWorkspaceSessionDeleted(workspaceId, sessionId);
      return reply.status(204).send();
    }
  );
}
