// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { db } from '../classes/database';
import { jwtPreHandler } from '../classes/auth';
import { runAutomation } from '../classes/automationScheduler';
import { AGENT_ROUTE_RATE_LIMIT } from '../classes/rateLimits';
import { logger } from '../classes/logger';

// -------------------------------------------------- Schemas --------------------------------------------------

const IdParamsSchema = Type.Object({ id: Type.String() });

const CreateAutomationBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  workspaceId: Type.Optional(Type.String()),
  agentType: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  intervalMinutes: Type.Optional(Type.Number()),
  enabled: Type.Optional(Type.Boolean())
});

const UpdateAutomationBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  agentType: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  intervalMinutes: Type.Optional(Type.Number()),
  enabled: Type.Optional(Type.Boolean())
});

export async function automationRoutes(fastifyBase: FastifyInstance): Promise<void> {
  const fastify = fastifyBase.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/automations — list all automations (global)
  fastify.get('/api/automations', { preHandler: jwtPreHandler }, async (_request, reply) => {
    const list = await db.listAutomations();
    return reply.send(list);
  });

  // GET /api/workspaces/:workspaceId/automations — list automations for a workspace
  fastify.get(
    '/api/workspaces/:workspaceId/automations',
    {
      preHandler: jwtPreHandler,
      schema: { params: Type.Object({ workspaceId: Type.String() }) }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
      const list = await db.listAutomationsByWorkspace(workspaceId);
      return reply.send(list);
    }
  );

  // POST /api/automations — create automation
  fastify.post(
    '/api/automations',
    {
      preHandler: jwtPreHandler,
      config: { rateLimit: AGENT_ROUTE_RATE_LIMIT },
      schema: { body: CreateAutomationBodySchema }
    },
    async (request, reply) => {
    const body = request.body;
    if (!body.workspaceId) return reply.code(400).send({ error: 'workspaceId is required' });
    if (!body.prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' });
    if (!body.intervalMinutes || body.intervalMinutes < 1)
      return reply.code(400).send({ error: 'intervalMinutes must be >= 1' });

    const workspace = await db.getWorkspace(body.workspaceId);
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

    const automation = await db.createAutomation({
      name: body.name?.trim() || `Automation ${new Date().toISOString()}`,
      workspaceId: body.workspaceId,
      agentType: body.agentType ?? workspace.defaultAgentType ?? 'cursor-agent',
      prompt: body.prompt.trim(),
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled ?? true
    });
    return reply.code(201).send(automation);
  });

  // GET /api/automations/:id — get single automation
  fastify.get(
    '/api/automations/:id',
    { preHandler: jwtPreHandler, schema: { params: IdParamsSchema } },
    async (request, reply) => {
      const { id } = request.params;
      const automation = await db.getAutomation(id);
      if (!automation) return reply.code(404).send({ error: 'Automation not found' });
      return reply.send(automation);
    }
  );

  // PATCH /api/automations/:id — update automation
  fastify.patch(
    '/api/automations/:id',
    { preHandler: jwtPreHandler, schema: { params: IdParamsSchema, body: UpdateAutomationBodySchema } },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const automation = await db.getAutomation(id);
      if (!automation) return reply.code(404).send({ error: 'Automation not found' });

      if (body.intervalMinutes !== undefined && body.intervalMinutes < 1)
        return reply.code(400).send({ error: 'intervalMinutes must be >= 1' });

      // when interval changes, recalculate nextRunAt
      let nextRunAt: string | undefined;
      if (body.intervalMinutes !== undefined && body.intervalMinutes !== automation.intervalMinutes) {
        nextRunAt = new Date(Date.now() + body.intervalMinutes * 60_000).toISOString();
      }

      const updated = await db.updateAutomation(id, {
        ...body,
        ...(nextRunAt ? { nextRunAt } : {})
      });
      return reply.send(updated);
    }
  );

  // DELETE /api/automations/:id — delete automation
  fastify.delete(
    '/api/automations/:id',
    { preHandler: jwtPreHandler, schema: { params: IdParamsSchema } },
    async (request, reply) => {
      const { id } = request.params;
      const automation = await db.getAutomation(id);
      if (!automation) return reply.code(404).send({ error: 'Automation not found' });
      await db.deleteAutomation(id);
      return reply.code(204).send();
    }
  );

  // POST /api/automations/:id/trigger — manually trigger a run now
  fastify.post(
    '/api/automations/:id/trigger',
    {
      preHandler: jwtPreHandler,
      config: { rateLimit: AGENT_ROUTE_RATE_LIMIT },
      schema: { params: IdParamsSchema }
    },
    async (request, reply) => {
      const { id } = request.params;
      const automation = await db.getAutomation(id);
      if (!automation) return reply.code(404).send({ error: 'Automation not found' });

      // run in background
      runAutomation(id).catch((err) => {
        logger.error({ err, automationId: id }, 'automations: trigger error');
      });

      return reply.code(202).send({ ok: true });
    }
  );

  // GET /api/automations/:id/runs — list runs for an automation
  fastify.get(
    '/api/automations/:id/runs',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: IdParamsSchema,
        querystring: Type.Object({ limit: Type.Optional(Type.String()) })
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { limit } = request.query;
      const automation = await db.getAutomation(id);
      if (!automation) return reply.code(404).send({ error: 'Automation not found' });
      const runs = await db.listRunsByAutomation(id, limit ? parseInt(limit, 10) : 20);
      return reply.send(runs);
    }
  );

  // GET /api/automations/:id/runs/:runId — get a single run
  fastify.get(
    '/api/automations/:id/runs/:runId',
    {
      preHandler: jwtPreHandler,
      schema: { params: Type.Object({ id: Type.String(), runId: Type.String() }) }
    },
    async (request, reply) => {
      const { id, runId } = request.params;
      const automation = await db.getAutomation(id);
      if (!automation) return reply.code(404).send({ error: 'Automation not found' });
      const run = await db.getAutomationRun(runId);
      if (!run || run.automationId !== id)
        return reply.code(404).send({ error: 'Run not found' });
      return reply.send(run);
    }
  );
}
