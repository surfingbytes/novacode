// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { db } from '../classes/database';
import { jwtPreHandler } from '../classes/auth';
import { runAutomation } from '../classes/automationScheduler';
import { AGENT_ROUTE_RATE_LIMIT } from '../classes/rateLimits';

export async function automationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/automations — list all automations (global)
  fastify.get('/api/automations', { preHandler: jwtPreHandler }, async (_request, reply) => {
    const list = await db.listAutomations();
    return reply.send(list);
  });

  // GET /api/workspaces/:workspaceId/automations — list automations for a workspace
  fastify.get(
    '/api/workspaces/:workspaceId/automations',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });
      const list = await db.listAutomationsByWorkspace(workspaceId);
      return reply.send(list);
    }
  );

  // POST /api/automations — create automation
  fastify.post(
    '/api/automations',
    { preHandler: jwtPreHandler, config: { rateLimit: AGENT_ROUTE_RATE_LIMIT } },
    async (request, reply) => {
    const body = request.body as {
      name?: string;
      workspaceId?: string;
      agentType?: string;
      prompt?: string;
      intervalMinutes?: number;
      enabled?: boolean;
    };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId is required' });
    if (!body.prompt?.trim()) return reply.status(400).send({ error: 'prompt is required' });
    if (!body.intervalMinutes || body.intervalMinutes < 1)
      return reply.status(400).send({ error: 'intervalMinutes must be >= 1' });

    const workspace = await db.getWorkspace(body.workspaceId);
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const automation = await db.createAutomation({
      name: body.name?.trim() || `Automation ${new Date().toISOString()}`,
      workspaceId: body.workspaceId,
      agentType: body.agentType ?? workspace.defaultAgentType ?? 'cursor-agent',
      prompt: body.prompt.trim(),
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled ?? true
    });
    return reply.status(201).send(automation);
  });

  // GET /api/automations/:id — get single automation
  fastify.get(
    '/api/automations/:id',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const automation = await db.getAutomation(id);
      if (!automation) return reply.status(404).send({ error: 'Automation not found' });
      return reply.send(automation);
    }
  );

  // PATCH /api/automations/:id — update automation
  fastify.patch(
    '/api/automations/:id',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        agentType?: string;
        prompt?: string;
        intervalMinutes?: number;
        enabled?: boolean;
      };
      const automation = await db.getAutomation(id);
      if (!automation) return reply.status(404).send({ error: 'Automation not found' });

      if (body.intervalMinutes !== undefined && body.intervalMinutes < 1)
        return reply.status(400).send({ error: 'intervalMinutes must be >= 1' });

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
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const automation = await db.getAutomation(id);
      if (!automation) return reply.status(404).send({ error: 'Automation not found' });
      await db.deleteAutomation(id);
      return reply.status(204).send();
    }
  );

  // POST /api/automations/:id/trigger — manually trigger a run now
  fastify.post(
    '/api/automations/:id/trigger',
    { preHandler: jwtPreHandler, config: { rateLimit: AGENT_ROUTE_RATE_LIMIT } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const automation = await db.getAutomation(id);
      if (!automation) return reply.status(404).send({ error: 'Automation not found' });

      // run in background
      runAutomation(id).catch((err) => {
        console.error(`[automations] trigger error for ${id}:`, err);
      });

      return reply.status(202).send({ ok: true });
    }
  );

  // GET /api/automations/:id/runs — list runs for an automation
  fastify.get(
    '/api/automations/:id/runs',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as { limit?: string };
      const automation = await db.getAutomation(id);
      if (!automation) return reply.status(404).send({ error: 'Automation not found' });
      const runs = await db.listRunsByAutomation(id, limit ? parseInt(limit, 10) : 20);
      return reply.send(runs);
    }
  );

  // GET /api/automations/:id/runs/:runId — get a single run
  fastify.get(
    '/api/automations/:id/runs/:runId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { id, runId } = request.params as { id: string; runId: string };
      const automation = await db.getAutomation(id);
      if (!automation) return reply.status(404).send({ error: 'Automation not found' });
      const run = await db.getAutomationRun(runId);
      if (!run || run.automationId !== id)
        return reply.status(404).send({ error: 'Run not found' });
      return reply.send(run);
    }
  );
}
