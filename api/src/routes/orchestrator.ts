// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { db } from '../classes/database';
import { createSessionWithAgent } from '../classes/sessionService';
import { jwtPreHandler } from '../classes/auth';
import { AGENT_ROUTE_RATE_LIMIT } from '../classes/rateLimits';
import { resolveWorkspaceAbsolutePath } from '../classes/workspacePaths';
import {
  cloneSubtasksForNewPlan,
  collectStepSessionIdsFromSubtasksJson,
  findRunnableSteps,
  mergeSubtasksJsonPatch,
  parseSubtasksPayloadString,
  serializeSubtasksPayload
} from '../classes/orchestratorPayload';
import { deleteSessionImages } from './images';
import { broadcastOrchestratorUpsert, broadcastWorkspaceSessionsRefresh } from './ws';
import { broadcastSessionListUpsert } from '../classes/sessionListBroadcast';
import { checkRunPreconditions, runOrchestrator } from './orchestratorRunner';

// types
import type { AgentType, ApprovalPolicy, OrchestratorRunMode } from '../@types/index';

const AGENT_TYPES: AgentType[] = ['cursor-agent', 'claude', 'mistral-vibe', 'open-code', 'codex'];
const MAX_PARALLEL_LIMIT = 8;

function parseAgentType(raw: unknown): AgentType | undefined {
  return typeof raw === 'string' && (AGENT_TYPES as string[]).includes(raw) ? (raw as AgentType) : undefined;
}

function parseMaxParallel(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw)
    ? Math.min(MAX_PARALLEL_LIMIT, Math.max(1, raw))
    : undefined;
}

interface PlannerSessionInput {
  agentType?: string;
  modelSelection?: string | null;
  approvalPolicy?: ApprovalPolicy;
  name?: string;
  tags?: string[] | null;
}

/** New planning chat for an orchestrator (its agent writes the plan through the nova MCP). */
async function createPlannerSession(workspaceId: string, input: PlannerSessionInput, fallbackName: string) {
  const result = await createSessionWithAgent({
    workspaceId,
    agentType: parseAgentType(input.agentType),
    ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    approvalPolicy: input.approvalPolicy,
    name: input.name?.trim() || fallbackName,
    tags: input.tags ?? null
  });
  if (result.session) broadcastSessionListUpsert(workspaceId, result.session);
  return result;
}

/** Persist an orchestrator patch and push it to subscribed dashboards (no polling needed). */
export async function updateOrchestratorAndBroadcast(
  workspaceId: string,
  orchestratorId: string,
  patch: Parameters<typeof db.updateOrchestrator>[1]
): Promise<Awaited<ReturnType<typeof db.updateOrchestrator>>> {
  const updated = await db.updateOrchestrator(orchestratorId, patch);
  if (updated) {
    broadcastOrchestratorUpsert(workspaceId, updated);
  }
  return updated;
}

export async function orchestratorRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/workspaces/:workspaceId/orchestrators
  fastify.get(
    '/api/workspaces/:workspaceId/orchestrators',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      const list = await db.listOrchestratorsByWorkspace(workspaceId);
      return reply.send(list);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators
  // With `planner`, also creates the planning chat and links it (the usual flow);
  // `agentType`/`workerModel` are for the step sessions.
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const body = request.body as {
        name?: string;
        tags?: string | null;
        agentType?: string;
        workerModel?: string | null;
        maxParallel?: number;
        planner?: PlannerSessionInput;
      };
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      const name = (body.name && body.name.trim()) || `Task plan ${new Date().toISOString()}`;
      let sourceSessionId: string | null = null;
      let plannerAgentType: AgentType | undefined;
      if (body.planner) {
        // Empty name: the chat gets its usual AI-generated title after the first prompt.
        const planner = await createPlannerSession(workspaceId, body.planner, body.name?.trim() || '');
        if (planner.error || !planner.session) {
          return reply.status(502).send({ error: planner.error ?? 'Failed to create the planning chat' });
        }
        sourceSessionId = planner.session.id;
        plannerAgentType = planner.session.agentType as AgentType;
      }
      const orchestrator = await db.createOrchestrator({
        workspaceId,
        name,
        tags: body.tags ?? null,
        agentType:
          parseAgentType(body.agentType) ?? plannerAgentType ?? (workspace.defaultAgentType as AgentType | null) ?? 'cursor-agent',
        sourceSessionId,
        workerModel: body.workerModel?.trim() || null,
        maxParallel: parseMaxParallel(body.maxParallel)
      });
      broadcastOrchestratorUpsert(workspaceId, orchestrator);
      return reply.status(201).send(orchestrator);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/planner — attach a new planning chat
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/planner',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as { workspaceId: string; orchestratorId: string };
      const body = (request.body ?? {}) as PlannerSessionInput;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      const planner = await createPlannerSession(
        workspaceId,
        { agentType: orchestrator.agentType, ...body },
        `Plan: ${orchestrator.name}`
      );
      if (planner.error || !planner.session) {
        return reply.status(502).send({ error: planner.error ?? 'Failed to create the planning chat' });
      }
      const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        sourceSessionId: planner.session.id
      });
      return reply.status(201).send(updated ?? orchestrator);
    }
  );

  // GET /api/workspaces/:workspaceId/orchestrators/:orchestratorId
  fastify.get(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      return reply.send(orchestrator);
    }
  );

  // PATCH /api/workspaces/:workspaceId/orchestrators/:orchestratorId
  fastify.patch(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const body = request.body as {
        name?: string;
        subtasksJson?: string | null;
        tags?: string | null;
        archived?: boolean;
        agentType?: string;
        workerModel?: string | null;
        maxParallel?: number;
      };
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      const mergedSubtasks =
        'subtasksJson' in body
          ? mergeSubtasksJsonPatch(body.subtasksJson ?? null, orchestrator.subtasksJson)
          : undefined;

      const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        name: body.name ?? orchestrator.name,
        ...(mergedSubtasks !== undefined && { subtasksJson: mergedSubtasks }),
        ...('tags' in (request.body as object) && { tags: body.tags ?? null }),
        ...(typeof body.archived === 'boolean' ? { archived: body.archived } : {}),
        ...(parseAgentType(body.agentType) && { agentType: parseAgentType(body.agentType) }),
        ...('workerModel' in (request.body as object) && { workerModel: body.workerModel?.trim() || null }),
        ...(parseMaxParallel(body.maxParallel) !== undefined && { maxParallel: parseMaxParallel(body.maxParallel) })
      });
      return reply.send(updated ?? orchestrator);
    }
  );

  // DELETE /api/workspaces/:workspaceId/orchestrators/:orchestratorId
  fastify.delete(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      const stepSessionIds = collectStepSessionIdsFromSubtasksJson(orchestrator.subtasksJson);
      if (stepSessionIds.length > 0) {
        await db.deleteManySessions(stepSessionIds, workspaceId);
        await Promise.all(stepSessionIds.map((id) => deleteSessionImages(id)));
        broadcastWorkspaceSessionsRefresh(workspaceId);
      }
      await db.deleteOrchestrator(orchestratorId);
      return reply.status(204).send();
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/clone
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/clone',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      const cloned = await db.createOrchestrator({
        workspaceId,
        name: `Copy of ${orchestrator.name || 'task plan'}`,
        tags: orchestrator.tags ?? null,
        agentType: orchestrator.agentType,
        workerModel: orchestrator.workerModel ?? null,
        maxParallel: orchestrator.maxParallel
      });
      const clonedPayload = cloneSubtasksForNewPlan(orchestrator.subtasksJson);
      const updated = await updateOrchestratorAndBroadcast(workspaceId, cloned.id, {
        subtasksJson: serializeSubtasksPayload(clonedPayload)
      });
      return reply.status(201).send(updated ?? cloned);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/run — start run in background, return 202
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/run',
    { preHandler: jwtPreHandler, config: { rateLimit: AGENT_ROUTE_RATE_LIMIT } },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const body = (request.body ?? {}) as {
        mode?: OrchestratorRunMode;
        startIndex?: number;
        onlyIndex?: number;
        /** Run only the first step that is ready (dependencies done). */
        next?: boolean;
      };
      const mode: OrchestratorRunMode = body.mode === 'parallel' ? 'parallel' : 'sequential';

      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      if (orchestrator.runStatus === 'running') {
        return reply.status(409).send({ error: 'Run already in progress' });
      }

      const payload = parseSubtasksPayloadString(orchestrator.subtasksJson);
      if (!payload?.subtasks.length) {
        return reply.status(400).send({
          error: orchestrator.subtasksJson?.trim()
            ? 'Invalid subtasksJson'
            : 'No steps yet. Ask the planning chat to create the plan first.'
        });
      }
      const subtasks = payload.subtasks;
      const clearResult = (index: number) => {
        delete subtasks[index].runResult;
        delete subtasks[index].sessionId;
        delete subtasks[index].runNote;
      };

      let onlyIndex = typeof body.onlyIndex === 'number' ? body.onlyIndex : undefined;
      if (body.next) {
        // Interrupted steps count as not run.
        subtasks.forEach((task, index) => task.runResult === 'running' && clearResult(index));
        onlyIndex = findRunnableSteps(subtasks)[0];
        if (onlyIndex === undefined) {
          return reply.status(400).send({ error: 'No step is ready — every step is done or waits for a failed step.' });
        }
      }
      const startIndex = Math.max(0, body.startIndex ?? 0);
      if (onlyIndex !== undefined && (onlyIndex < 0 || onlyIndex >= subtasks.length)) {
        return reply.status(400).send({ error: 'Invalid step index.' });
      }
      if (onlyIndex === undefined && startIndex >= subtasks.length) {
        return reply.status(400).send({ error: 'No steps to run from startIndex.' });
      }

      const options = { mode, ...(onlyIndex !== undefined ? { onlyIndex } : { startIndex }) };
      const blocked = await checkRunPreconditions(resolveWorkspaceAbsolutePath(workspace.path), options);
      if (blocked) {
        return reply.status(409).send({ error: blocked });
      }

      if (onlyIndex !== undefined) {
        clearResult(onlyIndex);
      } else if (mode === 'parallel' || startIndex === 0) {
        payload.handoffLog = '';
        subtasks.forEach((_, index) => clearResult(index));
      } else {
        for (let index = startIndex; index < subtasks.length; index++) clearResult(index);
      }

      await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        runStatus: 'running',
        runMode: mode,
        runCurrentStep: subtasks.filter((task) => task.runResult).length,
        runTotalSteps: subtasks.length,
        runStartedAt: new Date().toISOString(),
        subtasksJson: serializeSubtasksPayload(payload)
      });

      void runOrchestrator(workspaceId, orchestratorId, payload, options);

      const updated = await db.getOrchestrator(orchestratorId);
      return reply.status(202).send(updated);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/stop — request graceful stop
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/stop',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };

      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }

      if (orchestrator.runStatus !== 'running') {
        return reply.status(409).send({ error: 'Orchestrator is not running' });
      }

      const currentStep = orchestrator.runCurrentStep ?? 0;
      const totalSteps = orchestrator.runTotalSteps ?? null;

      const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        runStatus: 'stopped',
        runCurrentStep: currentStep,
        runTotalSteps: totalSteps
      });

      return reply.send(updated ?? orchestrator);
    }
  );
}
