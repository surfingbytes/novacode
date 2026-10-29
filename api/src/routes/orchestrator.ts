// node_modules
import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

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
import { ensureMergeStep, MERGE_STEP_NAME } from '../classes/orchestratorPlan';
import { deleteSessionImages } from '../classes/sessionImages';
import { broadcastWorkspaceSessionsRefresh } from '../classes/wsBroadcast';
import { broadcastOrchestratorUpsert, updateOrchestratorAndBroadcast } from '../classes/orchestratorEvents';
import { broadcastSessionListUpsert } from '../classes/sessionListBroadcast';
import { checkRunPreconditions, claimRunResume, finishRunResume, inFlightRunSteps, runOrchestrator } from '../classes/orchestratorRunner';

// types
import type { AgentType, OrchestratorRunMode } from '../@types/index';

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

// ---- Request schemas ----
// Nullable unions list Null first: Fastify's AJV coerces types, and a String-first union turns null into ''.

const WorkspaceParamsSchema = Type.Object({ workspaceId: Type.String() });

const OrchestratorParamsSchema = Type.Object({ workspaceId: Type.String(), orchestratorId: Type.String() });

const PlannerSessionSchema = Type.Object({
  agentType: Type.Optional(Type.String()),
  modelSelection: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  approvalPolicy: Type.Optional(Type.Union([Type.Literal('ask'), Type.Literal('allow_all')])),
  name: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Union([Type.Null(), Type.Array(Type.String())]))
});
type PlannerSessionInput = Static<typeof PlannerSessionSchema>;

const CreateOrchestratorBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  agentType: Type.Optional(Type.String()),
  workerModel: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  maxParallel: Type.Optional(Type.Number()),
  verifyAgentType: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  verifyModel: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  planner: Type.Optional(PlannerSessionSchema)
});

const UpdateOrchestratorBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  subtasksJson: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  tags: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  archived: Type.Optional(Type.Boolean()),
  agentType: Type.Optional(Type.String()),
  workerModel: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  maxParallel: Type.Optional(Type.Number()),
  verifyAgentType: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  verifyModel: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  isFavorite: Type.Optional(Type.Boolean())
});

const RunOrchestratorBodySchema = Type.Object({
  mode: Type.Optional(Type.String()),
  startIndex: Type.Optional(Type.Number()),
  onlyIndex: Type.Optional(Type.Number()),
  /** Run only the first step that is ready (dependencies done). */
  next: Type.Optional(Type.Boolean()),
  /** Parallel only: re-run every step, including finished ones. */
  fresh: Type.Optional(Type.Boolean())
});

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

export async function orchestratorRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/orchestrators — every workspace, without `messageJson` (nav sidebar)
  fastifyInstance.get('/api/orchestrators', { preHandler: jwtPreHandler }, async (_request, reply) => {
    return reply.send(await db.listOrchestratorSummaries());
  });

  // GET /api/workspaces/:workspaceId/orchestrators
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/orchestrators',
    {
      preHandler: jwtPreHandler,
      schema: { params: WorkspaceParamsSchema }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.code(404).send({ error: 'Workspace not found' });
      }
      const list = await db.listOrchestratorsByWorkspace(workspaceId);
      return reply.send(list);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators
  // With `planner`, also creates the planning chat and links it (the usual flow);
  // `agentType`/`workerModel` are for the step sessions, `verifyAgentType`/`verifyModel`
  // for the final verify step (null = the planning chat's).
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/orchestrators',
    {
      preHandler: jwtPreHandler,
      schema: { params: WorkspaceParamsSchema, body: CreateOrchestratorBodySchema }
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const body = request.body;
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.code(404).send({ error: 'Workspace not found' });
      }
      const name = (body.name && body.name.trim()) || `Task plan ${new Date().toISOString()}`;
      let sourceSessionId: string | null = null;
      let plannerAgentType: AgentType | undefined;
      if (body.planner) {
        // Empty name: the chat gets its usual AI-generated title after the first prompt.
        const planner = await createPlannerSession(workspaceId, body.planner, body.name?.trim() || '');
        if (planner.error || !planner.session) {
          return reply.code(502).send({ error: planner.error ?? 'Failed to create the planning chat' });
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
        maxParallel: parseMaxParallel(body.maxParallel),
        verifyAgentType: parseAgentType(body.verifyAgentType) ?? null,
        verifyModel: body.verifyModel?.trim() || null
      });
      broadcastOrchestratorUpsert(workspaceId, orchestrator);
      return reply.code(201).send(orchestrator);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/planner — attach a new planning chat
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/planner',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema, body: PlannerSessionSchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const body = request.body;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      const planner = await createPlannerSession(
        workspaceId,
        { agentType: orchestrator.agentType, ...body },
        `Plan: ${orchestrator.name}`
      );
      if (planner.error || !planner.session) {
        return reply.code(502).send({ error: planner.error ?? 'Failed to create the planning chat' });
      }
      const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        sourceSessionId: planner.session.id
      });
      return reply.code(201).send(updated ?? orchestrator);
    }
  );

  // GET /api/workspaces/:workspaceId/orchestrators/:orchestratorId
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      return reply.send(orchestrator);
    }
  );

  // PATCH /api/workspaces/:workspaceId/orchestrators/:orchestratorId
  fastifyInstance.patch(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema, body: UpdateOrchestratorBodySchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const body = request.body;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      if (body.isFavorite === true && (body.archived ?? orchestrator.archived)) {
        return reply.code(400).send({ error: 'Archived orchestrators cannot be favorited' });
      }
      const mergedSubtasks =
        'subtasksJson' in body
          ? mergeSubtasksJsonPatch(body.subtasksJson ?? null, orchestrator.subtasksJson)
          : undefined;

      const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        ...(body.name !== undefined && { name: body.name }),
        ...(typeof body.isFavorite === 'boolean' && { isFavorite: body.isFavorite }),
        ...(mergedSubtasks !== undefined && { subtasksJson: mergedSubtasks }),
        ...('tags' in body && { tags: body.tags ?? null }),
        ...(typeof body.archived === 'boolean' ? { archived: body.archived } : {}),
        ...(parseAgentType(body.agentType) && { agentType: parseAgentType(body.agentType) }),
        ...('workerModel' in body && { workerModel: body.workerModel?.trim() || null }),
        ...(parseMaxParallel(body.maxParallel) !== undefined && { maxParallel: parseMaxParallel(body.maxParallel) }),
        ...('verifyAgentType' in body && { verifyAgentType: parseAgentType(body.verifyAgentType) ?? null }),
        ...('verifyModel' in body && { verifyModel: body.verifyModel?.trim() || null })
      });
      return reply.send(updated ?? orchestrator);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/read — clear "Done"
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/read',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      if (!orchestrator.unread) {
        return reply.send(orchestrator);
      }
      const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, { unread: false });
      return reply.send(updated ?? orchestrator);
    }
  );

  // DELETE /api/workspaces/:workspaceId/orchestrators/:orchestratorId
  fastifyInstance.delete(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      const stepSessionIds = [
        ...new Set([
          ...collectStepSessionIdsFromSubtasksJson(orchestrator.subtasksJson),
          ...(await db.listOrchestratorSessionIds(orchestratorId))
        ])
      ];
      if (stepSessionIds.length > 0) {
        await db.deleteManySessions(stepSessionIds, workspaceId);
        await Promise.all(stepSessionIds.map((id) => deleteSessionImages(id)));
        broadcastWorkspaceSessionsRefresh(workspaceId);
      }
      await db.deleteOrchestrator(orchestratorId);
      return reply.code(204).send();
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/clone
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/clone',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.code(404).send({ error: 'Workspace not found' });
      }
      const cloned = await db.createOrchestrator({
        workspaceId,
        name: `Copy of ${orchestrator.name || 'task plan'}`,
        tags: orchestrator.tags ?? null,
        agentType: orchestrator.agentType,
        workerModel: orchestrator.workerModel ?? null,
        maxParallel: orchestrator.maxParallel,
        verifyAgentType: orchestrator.verifyAgentType ?? null,
        verifyModel: orchestrator.verifyModel ?? null
      });
      const clonedPayload = cloneSubtasksForNewPlan(orchestrator.subtasksJson);
      const updated = await updateOrchestratorAndBroadcast(workspaceId, cloned.id, {
        subtasksJson: serializeSubtasksPayload(clonedPayload)
      });
      return reply.code(201).send(updated ?? cloned);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/run — start run in background, return 202
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/run',
    {
      preHandler: jwtPreHandler,
      config: { rateLimit: AGENT_ROUTE_RATE_LIMIT },
      schema: { params: OrchestratorParamsSchema, body: RunOrchestratorBodySchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;
      const body = request.body;
      const mode: OrchestratorRunMode = body.mode === 'parallel' ? 'parallel' : 'sequential';

      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.code(404).send({ error: 'Workspace not found' });
      }

      if (orchestrator.runStatus === 'running') {
        return reply.code(409).send({ error: 'Run already in progress' });
      }
      const finishing = inFlightRunSteps(orchestratorId);
      if (finishing) {
        // A plain run of the same mode resumes the stopped run: free slots take the next steps.
        const bPlainRun = !body.next && body.onlyIndex === undefined && !body.fresh && (mode === 'parallel' || !body.startIndex);
        if (bPlainRun && claimRunResume(orchestratorId, mode)) {
          try {
            const updated = await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
              runStatus: 'running',
              unread: false
            });
            return reply.code(202).send(updated ?? orchestrator);
          } finally {
            finishRunResume(orchestratorId);
          }
        }
        const steps = finishing.map((name) => `"${name}"`).join(', ');
        return reply.code(409).send({
          error: `The stopped run is still finishing ${steps || 'a step'}. Wait for it to end, or stop that step's agent in its session, then run again.`
        });
      }

      const payload = parseSubtasksPayloadString(orchestrator.subtasksJson);
      if (!payload?.subtasks.length) {
        return reply.code(400).send({
          error: orchestrator.subtasksJson?.trim()
            ? 'Invalid subtasksJson'
            : 'No steps yet. Ask the planning chat to create the plan first.'
        });
      }
      const subtasks = payload.subtasks;
      // A merge step run alone keeps its branch to merge.
      const clearResult = (index: number, bKeepMergeRef = false) => {
        delete subtasks[index].runResult;
        delete subtasks[index].sessionId;
        delete subtasks[index].runNote;
        delete subtasks[index].waitingQuestion;
        if (!bKeepMergeRef) delete subtasks[index].mergeRef;
      };

      let onlyIndex = typeof body.onlyIndex === 'number' ? body.onlyIndex : undefined;
      if (body.next) {
        // Interrupted steps count as not run.
        subtasks.forEach((task, index) => task.runResult === 'running' && clearResult(index));
        onlyIndex = findRunnableSteps(subtasks)[0];
        if (onlyIndex === undefined) {
          return reply.code(400).send({ error: 'No step is ready — every step is done or waits for a failed step.' });
        }
      }
      const startIndex = Math.max(0, body.startIndex ?? 0);
      if (onlyIndex !== undefined && (onlyIndex < 0 || onlyIndex >= subtasks.length)) {
        return reply.code(400).send({ error: 'Invalid step index.' });
      }
      if (onlyIndex === undefined && startIndex >= subtasks.length) {
        return reply.code(400).send({ error: 'No steps to run from startIndex.' });
      }

      const options = { mode, ...(onlyIndex !== undefined ? { onlyIndex } : { startIndex }) };
      const blocked = await checkRunPreconditions(resolveWorkspaceAbsolutePath(workspace.path), options);
      if (blocked) {
        return reply.code(409).send({ error: blocked });
      }

      if (mode === 'parallel' && onlyIndex === undefined) {
        // Plans saved before merge steps existed get theirs now, so it shows from the start.
        ensureMergeStep(subtasks);
      }
      if (onlyIndex !== undefined) {
        clearResult(onlyIndex, true);
      } else if (mode === 'parallel' && !body.fresh) {
        // Keep finished steps (their work is already in the workspace); merge and verification re-run with the rest.
        if (subtasks.some((task) => task.kind === 'merge' && task.runResult === 'failed' && task.mergeRef)) {
          return reply.code(409).send({
            error: `The last run's result is not merged into the workspace yet. Run the "${MERGE_STEP_NAME}" step first, or use "Run all again in parallel" to start over.`
          });
        }
        subtasks.forEach((task, index) => task.runResult !== 'done' && clearResult(index));
        if (subtasks.some((task) => !task.kind && !task.runResult)) {
          subtasks.forEach((task, index) => task.kind && clearResult(index));
        }
        if (subtasks.every((task) => task.runResult === 'done')) {
          return reply.code(400).send({ error: 'Every step is done. Use "Run all again in parallel" to start over.' });
        }
      } else if (mode === 'parallel' || startIndex === 0) {
        payload.handoffLog = '';
        subtasks.forEach((_, index) => clearResult(index));
      } else {
        for (let index = startIndex; index < subtasks.length; index++) clearResult(index);
      }

      await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        runStatus: 'running',
        unread: false,
        runMode: mode,
        runCurrentStep: subtasks.filter((task) => task.runResult).length,
        runTotalSteps: subtasks.length,
        runStartedAt: new Date().toISOString(),
        subtasksJson: serializeSubtasksPayload(payload)
      });

      void runOrchestrator(workspaceId, orchestratorId, payload, options);

      const updated = await db.getOrchestrator(orchestratorId);
      return reply.code(202).send(updated);
    }
  );

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/stop — request graceful stop
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/stop',
    {
      preHandler: jwtPreHandler,
      schema: { params: OrchestratorParamsSchema }
    },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params;

      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.code(404).send({ error: 'Orchestrator not found' });
      }

      if (orchestrator.runStatus !== 'running') {
        return reply.code(409).send({ error: 'Orchestrator is not running' });
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
