// node_modules
import { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { db, FavoriteLimitError, normalizeTagStringList } from '../classes/database';
import { normalizeSessionForApi } from '../classes/sessionNormalize';
import { jwtPreHandler } from '../classes/auth';
import { createSessionWithAgent } from '../classes/sessionService';
import { closeAcpSessionForNovaSession } from '../classes/acpSessionClose';
import { mergeInternalSessionConfig } from '../classes/linkedPlanContext';
import { normalizeApprovalPolicy } from '../classes/approvalPolicy';
import { appendPlanUpdateToActiveRun, setActiveRunApprovalPolicy } from '../classes/chatEngine';
import {
  claimClaudePlanForSession,
  claudePlanFileIdsFromEventLines,
  getPlanDocumentsSource,
  planMarkdownHintsFromEventLines,
  syncClaudePlanDocumentsForSession,
} from '../classes/planDocumentSources';
import { resolveWorkspaceAbsolutePath } from '../classes/workspacePaths';
import type { PlanDocumentSummary } from '../classes/planDocuments';
import { workspaceTerminalManager } from '../classes/workspaceTerminalManager';
import { getActiveSessionIds, getActiveBusySubagents, cancelRun } from './chat';
import { deleteSessionImages } from './images';
import {
  broadcastWorkspaceSessionDeleted,
  broadcastWorkspaceSessionUpsert,
  broadcastWorkspaceSessionsRefresh
} from './ws';
import { markSessionRead } from '../classes/sessionUnread';

// types
import type { AgentType } from '../@types/index';
import type { LinkedPlanContext } from '../classes/linkedPlanContext';

// -------------------------------------------------- Schemas --------------------------------------------------

// `type: [..., 'null']` instead of Type.Union: AJV coerces inside anyOf branches,
// which would turn null into '' (or a tag string into a one-element array).
const NullableString = Type.Unsafe<string | null>({ type: ['string', 'null'] });

/** Tags arrive as a string list, a comma-separated string or null (see parseTagsFromBody). */
const TagsSchema = Type.Union([NullableString, Type.Array(Type.String())]);

const WorkspaceParamsSchema = Type.Object({ workspaceId: Type.String() });

const SessionParamsSchema = Type.Object({
  workspaceId: Type.String(),
  sessionId: Type.String()
});

const PlanDocumentParamsSchema = Type.Object({
  workspaceId: Type.String(),
  sessionId: Type.String(),
  planId: Type.String()
});

const CreateSessionBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  tags: Type.Optional(TagsSchema),
  agentType: Type.Optional(Type.Unsafe<AgentType>(Type.String())),
  modelSelection: Type.Optional(NullableString),
  linkedPlanContext: Type.Optional(
    Type.Unsafe<LinkedPlanContext | null>({ type: ['object', 'null'] })
  ),
  sessionMode: Type.Optional(NullableString),
  approvalPolicy: Type.Optional(NullableString)
});

const UpdateSessionBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  tags: Type.Optional(TagsSchema),
  archived: Type.Optional(Type.Boolean()),
  isFavorite: Type.Optional(Type.Boolean()),
  modelSelection: Type.Optional(Type.String()),
  sessionMode: Type.Optional(Type.String()),
  approvalPolicy: Type.Optional(Type.String()),
  sessionConfigJson: Type.Optional(
    Type.Union([Type.Null(), Type.Record(Type.String(), Type.String())])
  )
});

const PlanUpdateBodySchema = Type.Object({
  title: Type.Optional(Type.String()),
  markdown: Type.Optional(Type.String()),
  entries: Type.Optional(
    Type.Array(
      Type.Object({
        content: Type.String(),
        status: Type.String(),
        priority: Type.Optional(Type.String())
      })
    )
  ),
  planId: Type.Optional(Type.String())
});

const BulkIdsBodySchema = Type.Object({ ids: Type.Array(Type.String()) });

const BulkArchiveBodySchema = Type.Object({
  ids: Type.Array(Type.String()),
  archived: Type.Boolean()
});

// -------------------------------------------------- Helpers --------------------------------------------------

/** Per-session tail promise so plan-update read-modify-writes never interleave. */
const planUpdateChains = new Map<string, Promise<unknown>>();

function runSerializedPlanUpdate<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = planUpdateChains.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  planUpdateChains.set(sessionId, next);
  void next.finally(() => {
    if (planUpdateChains.get(sessionId) === next) planUpdateChains.delete(sessionId);
  }).catch(() => undefined);
  return next;
}

/** Load plan files for a session; Claude also claims untagged ~/.claude/plans matches. */
async function resolveSessionPlanDocuments(session: {
  agentType: string | null;
  sessionId: string | null;
  id: string;
}, workspacePath: string | null): Promise<PlanDocumentSummary[]> {
  const source = getPlanDocumentsSource(session.agentType, { workspacePath });
  if (session.agentType !== 'claude' || !session.sessionId) {
    return source.listForSession(session.sessionId);
  }

  const messages = await db.listSessionMessages(session.id);
  const eventLines = messages.flatMap((message) => message.events ?? []);
  return syncClaudePlanDocumentsForSession(session.sessionId, {
    markdownHints: planMarkdownHintsFromEventLines(eventLines),
    planFileIds: claudePlanFileIdsFromEventLines(eventLines),
  });
}

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

export async function sessionsRoutes(fastifyBase: FastifyInstance): Promise<void> {
  const fastify = fastifyBase.withTypeProvider<TypeBoxTypeProvider>();

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
        busySubagents: getActiveBusySubagents(session.id),
      }));
    await db.enrichSessionListPreviews(allSessions);
    return reply.send(allSessions);
  });

  // -------------------------------------------------- Session create --------------------------------------------------

  // POST /api/workspaces/:workspaceId/sessions
  fastify.post(
    '/api/workspaces/:workspaceId/sessions',
    {
      preHandler: jwtPreHandler,
      schema: { params: WorkspaceParamsSchema, body: CreateSessionBodySchema }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const body = request.body as Static<typeof CreateSessionBodySchema>;

      const tagsParsed = parseTagsFromBody(request.body);
      const result = await createSessionWithAgent({
        workspaceId,
        name: typeof body.name === 'string' ? body.name.trim() : '',
        tags: tagsParsed === undefined ? null : tagsParsed,
        agentType: body.agentType,
        modelSelection: body.modelSelection ?? undefined,
        linkedPlanContext: body.linkedPlanContext ?? undefined,
        sessionMode: body.sessionMode ?? undefined,
        approvalPolicy: body.approvalPolicy ?? undefined,
      });

      if (result.error) {
        const status = result.error === 'Workspace not found' ? 404 : 502;
        return reply.status(status).send({
          error: result.error === 'Workspace not found' ? result.error : 'Failed to create chat',
          message: result.error,
          ...(result.errorCode ? { code: result.errorCode } : {}),
          ...(status === 502 ? { details: result.errorDetails ?? result.error } : {}),
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
    {
      preHandler: jwtPreHandler,
      schema: {
        params: WorkspaceParamsSchema,
        querystring: Type.Object({ archived: Type.Optional(Type.String()) })
      }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const query = request.query;
      const archived =
        query.archived === 'true' ? true : query.archived === 'false' ? false : undefined;
      const sessions = await db.listSessionsByWorkspace(workspaceId, { archived });
      const activeSessionIds = getActiveSessionIds();
      const enriched = sessions.map((session) => ({
        ...normalizeSessionForApi(session),
        busy: activeSessionIds.has(session.id),
        busySubagents: getActiveBusySubagents(session.id),
      }));
      await db.enrichSessionListPreviews(enriched);
      return reply.send(enriched);
    }
  );

  // GET /api/workspaces/:workspaceId/sessions/:sessionId
  fastify.get(
    '/api/workspaces/:workspaceId/sessions/:sessionId',
    { preHandler: jwtPreHandler, schema: { params: SessionParamsSchema } },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      const workspacePath = workspace ? resolveWorkspaceAbsolutePath(workspace.path) : null;
      // Chat history streams over the chat WebSocket — keep it out of this
      // response so long sessions load fast on slow links.
      return reply.send({
        ...normalizeSessionForApi(session),
        planDocuments: await resolveSessionPlanDocuments(session, workspacePath),
      });
    }
  );

  // POST /api/sessions/:sessionId/read — mark a chat read (syncs to other devices)
  fastify.post(
    '/api/sessions/:sessionId/read',
    { preHandler: jwtPreHandler, schema: { params: Type.Object({ sessionId: Type.String() }) } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = await db.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const updated = await markSessionRead(sessionId);
      return reply.send(normalizeSessionForApi(updated ?? session));
    }
  );

  // GET /api/workspaces/:workspaceId/sessions/:sessionId/usage
  fastify.get(
    '/api/workspaces/:workspaceId/sessions/:sessionId/usage',
    { preHandler: jwtPreHandler, schema: { params: SessionParamsSchema } },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const [turns, summary] = await Promise.all([
        db.listSessionUsage(sessionId),
        db.summarizeSessionUsage(sessionId)
      ]);
      return reply.send({ turns, summary });
    }
  );

  // PATCH /api/workspaces/:workspaceId/sessions/:sessionId
  fastify.patch(
    '/api/workspaces/:workspaceId/sessions/:sessionId',
    {
      preHandler: jwtPreHandler,
      schema: { params: SessionParamsSchema, body: UpdateSessionBodySchema }
    },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const body = request.body as Static<typeof UpdateSessionBodySchema>;
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const patch: {
        name?: string;
        tags?: string[] | null;
        archived?: boolean;
        isFavorite?: boolean;
        modelSelection?: string;
        sessionMode?: string;
        approvalPolicy?: string;
        sessionConfigJson?: string | null;
      } = {};
      if (body.name !== undefined) {
        patch.name = body.name;
      }
      if ('tags' in body) {
        patch.tags = parseTagsFromBody(request.body) ?? null;
      }
      if (body.archived !== undefined) {
        patch.archived = body.archived;
      }
      if (body.isFavorite !== undefined) {
        patch.isFavorite = body.isFavorite;
      }
      if (body.modelSelection !== undefined) {
        patch.modelSelection = body.modelSelection;
      }
      if (body.sessionMode !== undefined) {
        patch.sessionMode = body.sessionMode;
      }
      if (body.approvalPolicy !== undefined) {
        patch.approvalPolicy = normalizeApprovalPolicy(body.approvalPolicy);
      }
      if (body.sessionConfigJson !== undefined) {
        patch.sessionConfigJson = mergeInternalSessionConfig(
          session.sessionConfigJson,
          body.sessionConfigJson
        );
      }
      let updated;
      try {
        updated = await db.updateSession(sessionId, patch);
      } catch (err: unknown) {
        if (err instanceof FavoriteLimitError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
      if (!updated) {
        return reply.status(500).send({ error: 'Failed to update session' });
      }
      if (patch.approvalPolicy !== undefined) {
        setActiveRunApprovalPolicy(sessionId, patch.approvalPolicy);
      }
      const normalized = normalizeSessionForApi(updated);
      broadcastWorkspaceSessionUpsert(workspaceId, normalized);
      return reply.send(normalized);
    }
  );

  // -------------------------------------------------- Plan documents --------------------------------------------------

  // DELETE /api/workspaces/:workspaceId/sessions/:sessionId/plan-documents/:planId
  fastify.delete(
    '/api/workspaces/:workspaceId/sessions/:sessionId/plan-documents/:planId',
    { preHandler: jwtPreHandler, schema: { params: PlanDocumentParamsSchema } },
    async (request, reply) => {
      const { workspaceId, sessionId, planId } = request.params;
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      const workspacePath = workspace ? resolveWorkspaceAbsolutePath(workspace.path) : null;
      const deleted = await getPlanDocumentsSource(session.agentType, { workspacePath }).deleteById(
        planId,
        session.sessionId
      );
      if (!deleted) {
        return reply.status(404).send({ error: 'Plan document not found' });
      }
      return reply.status(204).send();
    }
  );

  // PATCH /api/workspaces/:workspaceId/sessions/:sessionId/plan-documents/:planId
  fastify.patch(
    '/api/workspaces/:workspaceId/sessions/:sessionId/plan-documents/:planId',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: PlanDocumentParamsSchema,
        body: Type.Object({ markdown: Type.Optional(Type.String()) })
      }
    },
    async (request, reply) => {
      const { workspaceId, sessionId, planId } = request.params;
      const { markdown } = request.body;
      if (typeof markdown !== 'string' || !markdown.trim()) {
        return reply.status(400).send({ error: 'markdown is required' });
      }
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      const workspacePath = workspace ? resolveWorkspaceAbsolutePath(workspace.path) : null;
      const updated = await getPlanDocumentsSource(session.agentType, { workspacePath }).updateById(
        planId,
        session.sessionId,
        markdown
      );
      if (!updated) {
        return reply.status(404).send({ error: 'Plan document not found' });
      }
      return reply.send(updated);
    }
  );

  // POST /api/workspaces/:workspaceId/sessions/:sessionId/plan-update
  // Persist a plan snapshot into chat history (ACP sessionUpdate: plan), matching
  // how Claude ACP plan entry status updates are stored and replayed.
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/:sessionId/plan-update',
    {
      preHandler: jwtPreHandler,
      schema: { params: SessionParamsSchema, body: PlanUpdateBodySchema }
    },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const body = request.body;
      const markdown = typeof body.markdown === 'string' ? body.markdown.trim() : '';
      const entries = Array.isArray(body.entries) ? body.entries : [];
      if (!markdown && entries.length === 0) {
        return reply.status(400).send({ error: 'markdown or entries is required' });
      }
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const line = JSON.stringify({
        sessionId: session.sessionId ?? 'plan-surface',
        update: {
          sessionUpdate: 'plan',
          ...(title ? { title } : {}),
          ...(markdown ? { markdown } : {}),
          entries: entries
            .filter(
              (entry) =>
                entry &&
                typeof entry.content === 'string' &&
                typeof entry.status === 'string'
            )
            .map((entry) => ({
              content: entry.content,
              status: entry.status,
              ...(typeof entry.priority === 'string' ? { priority: entry.priority } : {}),
            })),
        },
      });
      const ok = await runSerializedPlanUpdate(sessionId, async () => {
        const appended = await db.appendSessionPlanUpdate(sessionId, line);
        if (appended) appendPlanUpdateToActiveRun(sessionId, line);
        return appended;
      });
      if (!ok) {
        return reply.status(500).send({ error: 'Failed to persist plan update' });
      }

      // Disk is source of truth for file-backed agents (incl. Claude after claim).
      if (markdown && session.sessionId) {
        const workspace = await db.getWorkspace(workspaceId);
        const workspacePath = workspace ? resolveWorkspaceAbsolutePath(workspace.path) : null;
        const source = getPlanDocumentsSource(session.agentType, { workspacePath });
        let planId = typeof body.planId === 'string' ? body.planId : '';
        if (!planId && session.agentType === 'claude') {
          const claimed = await claimClaudePlanForSession(session.sessionId, markdown);
          planId = claimed?.id ?? '';
        }
        if (planId) {
          await source.updateById(planId, session.sessionId, markdown);
        }
      }

      return reply.send({ ok: true });
    }
  );

  // -------------------------------------------------- Session bulk actions --------------------------------------------------

  // POST /api/workspaces/:workspaceId/sessions/bulk-delete
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/bulk-delete',
    {
      preHandler: jwtPreHandler,
      schema: { params: WorkspaceParamsSchema, body: BulkIdsBodySchema }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const { ids } = request.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids must be a non-empty array' });
      }
      for (const id of ids) {
        cancelRun(id);
        workspaceTerminalManager.stop(id);
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
    {
      preHandler: jwtPreHandler,
      schema: { params: WorkspaceParamsSchema, body: BulkArchiveBodySchema }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const { ids, archived } = request.body;
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
    { preHandler: jwtPreHandler, schema: { params: SessionParamsSchema } },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      const session = await db.getSession(sessionId);
      if (!session || session.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      cancelRun(sessionId);
      workspaceTerminalManager.stop(sessionId);
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
