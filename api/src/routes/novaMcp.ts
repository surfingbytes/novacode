// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { db } from '../classes/database';
import {
  NOVA_MCP_PATH,
  handleNovaMcpMessage,
  isNovaMcpEnabled,
  verifyNovaMcpToken,
  type JsonRpcRequest,
  type NovaMcpTool,
  type NovaMcpToolResult
} from '../classes/novaMcp';
import { readSessionSpec, specHasContent, writeSessionSpec } from '../classes/sessionSpec';
import { buildPlanSubtasks, validatePlanSteps } from '../classes/orchestratorPlan';
import { parseSubtasksPayloadString, serializeSubtasksPayload } from '../classes/orchestratorPayload';
import { broadcastOrchestratorUpsert } from './ws';
import { publishSpecStatus } from './sessionSpec';
import { updateOrchestratorAndBroadcast } from './orchestrator';
import { markStepNeedsInput } from './orchestratorRunner';

// -------------------------------------------- Tools --------------------------------------------

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short step title.' },
    prompt: {
      type: 'string',
      description:
        'Full, self-contained instruction for the step agent: its task, decisions affecting it, files it touches and exact contracts with other steps. It does NOT receive the spec, only plan notes and handoff notes from its dependsOn steps.'
    },
    category: { type: 'string', description: 'Optional label, e.g. setup, implementation, tests, docs.' },
    dependsOn: {
      type: 'array',
      items: { type: 'integer', minimum: 0 },
      description: '0-based indexes of EARLIER steps whose results this step needs. Independent steps may run in parallel.'
    }
  },
  required: ['name', 'prompt']
};

export const NOVA_MCP_TOOLS: NovaMcpTool[] = [
  {
    name: 'spec_read',
    description: "Read this chat's spec file (the agreed requirements the final verify step checks against).",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'spec_write',
    description:
      "Replace this chat's spec with the complete Markdown spec: goal and scope, agreed decisions, constraints, file paths and exact values, rejected alternatives, open questions, acceptance criteria. The orchestrator's verify step reads it live when it starts; other steps don't get it.",
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'Full spec in Markdown.' } },
      required: ['content']
    }
  },
  {
    name: 'orchestrator_get',
    description:
      "Show this chat's orchestrator plan: steps (0-based indexes), dependencies, run status and results of finished steps.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'orchestrator_save_plan',
    description:
      "Create or replace this chat's orchestrator plan. Each step runs in a fresh agent session (in parallel runs each in its own git worktree, merged afterwards); a final 'Verify against spec' step is added automatically. Write the spec with spec_write first. The user starts the run — never start it or implement the steps yourself.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plan title, 3 to 8 words.' },
        notes: {
          type: 'string',
          description: 'Optional short context every step gets (e.g. how the work is split). Not a place for the spec.'
        },
        steps: { type: 'array', items: STEP_SCHEMA, minItems: 1 }
      },
      required: ['steps']
    }
  },
  {
    name: 'step_needs_input',
    description:
      "Only for an orchestrator step session: you can't finish this step without the user's answer. Call it with your question, then end your turn asking it. The plan holds this step and every step that depends on it, and notifies the user, until they reply in this chat.",
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The question for the user, one or two sentences.' } },
      required: ['question']
    }
  }
];

function ok(text: string): NovaMcpToolResult {
  return { text };
}

function fail(text: string): NovaMcpToolResult {
  return { text, bError: true };
}

async function callNovaTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<NovaMcpToolResult> {
  const session = await db.getSession(sessionId);
  if (!session) return fail('This chat session no longer exists.');
  const workspaceId = session.workspaceId;

  if (name === 'spec_read') {
    const spec = await readSessionSpec(workspaceId, sessionId).catch(() => null);
    return ok(spec && specHasContent(spec.content) ? spec.content : 'The spec is empty — write it with spec_write.');
  }

  if (name === 'spec_write') {
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (!content) return fail('"content" must be the full spec in Markdown.');
    const saved = await writeSessionSpec(workspaceId, sessionId, content);
    void publishSpecStatus(sessionId).catch(() => {});
    return ok(`Spec saved (${saved.path}).`);
  }

  if (name === 'step_needs_input') {
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (!question) return fail('"question" must say what you need from the user.');
    if (!markStepNeedsInput(sessionId, question)) {
      return fail('This chat is not a running orchestrator step; just ask the user in your reply.');
    }
    return ok('The plan now waits for the user. End your turn with the question; their reply continues this step.');
  }

  const existing = await db.getLatestOrchestratorBySourceSession(sessionId);

  if (name === 'orchestrator_get') {
    if (!existing) return ok('This chat has no orchestrator plan yet. Create one with orchestrator_save_plan.');
    const payload = parseSubtasksPayloadString(existing.subtasksJson);
    return ok(
      JSON.stringify(
        {
          id: existing.id,
          name: existing.name,
          workers: { agentType: existing.agentType, model: existing.workerModel ?? 'same as this chat' },
          verification: existing.verifyAgentType
            ? { agentType: existing.verifyAgentType, model: existing.verifyModel ?? 'same as this chat' }
            : 'same as this chat',
          runStatus: existing.runStatus ?? 'not started',
          notes: payload?.sharedContext ?? '',
          steps: (payload?.subtasks ?? []).map((task, index) => ({
            index,
            name: task.name,
            prompt: task.prompt,
            category: task.category ?? null,
            dependsOn: task.dependsOn ?? [],
            status: task.runResult ?? 'not run',
            ...(task.runNote ? { note: task.runNote } : {}),
            ...(task.kind === 'verify' ? { automatic: true } : {})
          })),
          handoffLog: payload?.handoffLog ?? ''
        },
        null,
        2
      )
    );
  }

  if (name === 'orchestrator_save_plan') {
    const validated = validatePlanSteps(args.steps);
    if ('error' in validated) return fail(validated.error);
    if (existing?.runStatus === 'running') {
      return fail('The plan is running right now; wait until it finishes or ask the user to stop it.');
    }
    const previous = parseSubtasksPayloadString(existing?.subtasksJson);
    const subtasks = buildPlanSubtasks(validated.steps, previous?.subtasks ?? []);
    const bKeptResults = subtasks.some((task) => task.runResult === 'done');
    const notes = typeof args.notes === 'string' ? args.notes.trim() : (previous?.sharedContext ?? '');
    const planName = (typeof args.name === 'string' && args.name.trim()) || existing?.name || session.name.trim() || 'Plan';
    const subtasksJson = serializeSubtasksPayload({
      sharedContext: notes,
      handoffLog: bKeptResults ? (previous?.handoffLog ?? '') : '',
      subtasks
    });

    let orchestratorId: string;
    if (existing) {
      orchestratorId = existing.id;
      await updateOrchestratorAndBroadcast(workspaceId, existing.id, {
        name: planName,
        subtasksJson,
        runStatus: null,
        runCurrentStep: null,
        runTotalSteps: null
      });
    } else {
      const created = await db.createOrchestrator({
        workspaceId,
        name: planName,
        agentType: session.agentType,
        sourceSessionId: sessionId
      });
      orchestratorId = created.id;
      const updated = await db.updateOrchestrator(created.id, { subtasksJson });
      broadcastOrchestratorUpsert(workspaceId, updated ?? created);
    }
    void publishSpecStatus(sessionId).catch(() => {});
    const spec = await readSessionSpec(workspaceId, sessionId).catch(() => null);
    const specHint = spec && specHasContent(spec.content) ? '' : ' Note: the spec is still empty — write it with spec_write so the steps get the requirements.';
    return ok(
      `Saved plan "${planName}" (orchestrator ${orchestratorId}) with ${validated.steps.length} step(s) plus the automatic "Verify against spec" step. The user reviews it and starts the run from the Orchestrator tab — do not start it or implement the steps yourself.${specHint}`
    );
  }

  return fail(`Unknown tool: ${name}`);
}

// -------------------------------------------- Route --------------------------------------------

/**
 * Nova's MCP endpoint (Streamable HTTP, stateless, JSON responses). Agents in
 * this container reach it on 127.0.0.1 with a per-session bearer token.
 */
export async function novaMcpRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(NOVA_MCP_PATH, async (request, reply) => {
    const sessionId = verifyNovaMcpToken(request.headers.authorization);
    if (!sessionId) return reply.status(401).send({ error: 'Invalid Nova MCP token' });
    if (!isNovaMcpEnabled()) return reply.status(403).send({ error: 'Nova MCP is turned off in Settings' });

    const body = request.body as JsonRpcRequest | JsonRpcRequest[] | undefined;
    const messages = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
    if (messages.length === 0) {
      return reply.status(400).send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const responses = (
      await Promise.all(messages.map((message) => handleNovaMcpMessage(sessionId, message, NOVA_MCP_TOOLS, callNovaTool)))
    ).filter((response): response is Record<string, unknown> => response !== null);

    if (responses.length === 0) return reply.status(202).send();
    return reply.type('application/json').send(Array.isArray(body) ? responses : responses[0]);
  });

  // Stateless server: no SSE stream to open and no session to delete.
  for (const method of ['GET', 'DELETE'] as const) {
    fastify.route({
      method,
      url: NOVA_MCP_PATH,
      handler: async (_request, reply) => reply.status(405).header('Allow', 'POST').send()
    });
  }
}
