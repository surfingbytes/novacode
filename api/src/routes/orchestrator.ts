// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { db, normalizeTagStringList } from '../classes/database';
import { createSessionWithAgent } from '../classes/sessionService';
import { dispatchPrompt, dispatchPromptAndWait } from '../classes/chatEngine';
import { jwtPreHandler } from '../classes/auth';
import {
  appendHandoff,
  buildStepPrompt,
  collectStepSessionIdsFromSubtasksJson,
  mergeSubtasksJsonPatch,
  parseSubtasksPayloadString,
  serializeSubtasksPayload,
  summarizeStepHandoff
} from '../classes/orchestratorPayload';
import { deleteSessionImages } from './images';
import { broadcastWorkspaceSessionsRefresh } from './ws';

// types
import type { ChatMessage, OrchestratorSubtasksPayload, SubTask } from '../@types/index';

const DECOMPOSE_INSTRUCTION = `You are a task planner. The user will describe a high-level goal or ask to modify an existing task list.

Critical: Each subtask runs in a separate session with no memory of previous steps. So:
- Do NOT create meta-steps like "Plan the approach", "Decide on architecture", "Figure out the design", or "Outline the steps". Those are useless unless you capture the same information in "sharedContext" (see below).
- Every step must be a concrete, executable task that an AI coding agent can do in isolation. The "prompt" for each step must contain everything the agent needs (what to build, where, and any constraints).
- Prefer steps that produce tangible outputs: code, tests, config files, docs. Good: "Add a login form component at src/auth/LoginForm.tsx with email and password fields and a submit handler." Bad: "Plan the login flow."

Keep the list short: only tasks directly related to the user's goal.

You must respond with a single JSON object (no markdown, no code fence) with exactly these keys:
- "sharedContext" (string): Consolidated decisions, constraints, important file paths, and anything every later step must know. This is prepended to every step's prompt. Use empty string only if there is truly nothing global to share.
- "subtasks" (array): Each element must have:
  - "name" (string): short title for the step
  - "prompt" (string): the full, self-contained instruction for the AI agent (include file paths, requirements, and context so the step works alone)
  - "category" (string or null): optional category label, e.g. "setup", "implementation", "tests"

If the user is refining an existing list, use their request to update sharedContext and subtasks (add, remove, merge, or reorder steps).
Output only the JSON object, nothing else.`;

/** Extract thinking text from a single stream-json line; returns null if not a thinking event (e.g. tool_call). */
function extractThinkingFromStreamLine(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === 'thinking') {
      const text = event.text ?? event.content;
      return typeof text === 'string' ? text : null;
    }
    if (event.type === 'assistant' && event.message && typeof event.message === 'object') {
      const content = (event.message as { content?: Array<{ type?: string; text?: string }> })
        .content;
      if (!Array.isArray(content)) {
        return null;
      }
      let out = '';
      for (const block of content) {
        if (block?.type === 'thinking' && typeof block.text === 'string') {
          out += block.text;
        }
      }
      return out || null;
    }
    return null;
  } catch {
    return null;
  }
}

function extractAssistantTextFromEvents(events: string[] | undefined): string {
  if (!events?.length) {
    return '';
  }
  let text = '';
  for (const line of events) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: { content?: Array<{ type?: string; text?: string }> };
      };
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text;
          }
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return text;
}

/** Expected schema description for debugging (shown when decomposition fails). */
export const DECOMPOSE_EXPECTED_SCHEMA = `{
  "sharedContext": "string",
  "subtasks": [
    { "name": "string", "prompt": "string", "category": "string | null" },
    ...
  ]
}
No markdown code fence; output only this JSON.`;

function tryParseJson(str: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(str) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === 'string') {
      return tryParseJson(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

function parseSubtasksArray(arr: unknown): SubTask[] | null {
  if (!Array.isArray(arr)) {
    return null;
  }
  try {
    const raw = arr as Array<{ name?: unknown; prompt?: unknown; category?: unknown }>;
    const result: SubTask[] = [];
    for (const item of raw) {
      if (item == null || typeof item !== 'object') {
        continue;
      }
      const name = typeof item.name === 'string' ? item.name : String(item.name ?? '');
      const prompt = typeof item.prompt === 'string' ? item.prompt : String(item.prompt ?? '');
      const category =
        item.category === null || item.category === undefined
          ? null
          : typeof item.category === 'string'
            ? item.category
            : String(item.category);
      result.push({ name, prompt, category: category || null });
    }
    return result;
  } catch {
    return null;
  }
}

/** Parse planner JSON: sharedContext + subtasks (legacy: only subtasks array in object). */
function parsePlanFromLlmResponse(raw: string): { sharedContext: string; subtasks: SubTask[] } | null {
  const trimmed = raw.trim();
  let working = trimmed.includes('{') ? trimmed.slice(trimmed.indexOf('{')) : trimmed;
  let jsonStr = working;
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(working);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  }

  let parsed = tryParseJson(jsonStr);
  if (!parsed && jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
    try {
      const unescaped = JSON.parse(jsonStr) as string;
      if (typeof unescaped === 'string') {
        parsed = tryParseJson(unescaped);
      }
    } catch {
      // ignore
    }
  }

  if (!parsed) {
    return null;
  }
  const subtasks = parseSubtasksArray(parsed.subtasks);
  if (!subtasks) {
    return null;
  }
  const sharedContext =
    typeof parsed.sharedContext === 'string' ? parsed.sharedContext : '';
  return { sharedContext, subtasks };
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
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const body = request.body as {
        name?: string;
        tags?: string | null;
        agentType?: string;
      };
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      const orchestrator = await db.createOrchestrator({
        workspaceId,
        name: (body.name && body.name.trim()) || `Task plan ${new Date().toISOString()}`,
        tags: body.tags ?? null,
        agentType: body.agentType ?? workspace.defaultAgentType ?? 'cursor-agent'
      });
      return reply.status(201).send(orchestrator);
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
      };
      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }
      const mergedSubtasks =
        'subtasksJson' in body
          ? mergeSubtasksJsonPatch(body.subtasksJson ?? null, orchestrator.subtasksJson)
          : undefined;

      const updated = await db.updateOrchestrator(orchestratorId, {
        name: body.name ?? orchestrator.name,
        ...(mergedSubtasks !== undefined && { subtasksJson: mergedSubtasks }),
        ...('tags' in (request.body as object) && { tags: body.tags ?? null }),
        ...(typeof body.archived === 'boolean' ? { archived: body.archived } : {})
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

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/decompose
  // Streams SSE: { type: 'thinking', text } for live thinking only (no tool calls); then { type: 'done', orchestrator } or { type: 'error', error }
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/decompose',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const { userMessage } = request.body as { userMessage: string };

      if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
        return reply.status(400).send({ error: 'userMessage is required' });
      }

      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }

      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      let currentPayload = parseSubtasksPayloadString(orchestrator.subtasksJson);
      const currentList = currentPayload?.subtasks ?? [];
      const currentListStr =
        currentList.length > 0 || (currentPayload?.sharedContext?.trim() ?? '')
          ? `Current plan (JSON): ${JSON.stringify({
              sharedContext: currentPayload?.sharedContext ?? '',
              subtasks: currentList
            })}. User request: `
          : '';

      const promptText = `${DECOMPOSE_INSTRUCTION}\n\nUser goal: ${currentListStr}${userMessage.trim()}`;

      const tempSessionResult = await createSessionWithAgent({
        workspaceId,
        name: 'Orchestrator helper (temp)'
      });
      if (tempSessionResult.error || !tempSessionResult.session) {
        return reply.status(502).send({
          error: 'Failed to create agent session for decomposition',
          details: tempSessionResult.error
        });
      }
      const tempSessionId = tempSessionResult.session.id;

      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      const sendEvent = (obj: {
        type: string;
        text?: string;
        orchestrator?: unknown;
        error?: string;
        lastAssistantContent?: string;
        expectedSchema?: string;
      }) => {
        raw.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      const finish = () => {
        db.deleteSession(tempSessionId).catch(() => {});
        if (!raw.writableEnded) {
          raw.end();
        }
      };

      const subscriber = {
        onStream(line: string) {
          const text = extractThinkingFromStreamLine(line);
          if (text) {
            sendEvent({ type: 'thinking', text });
          }
        },
        onDone(messages: ChatMessage[]) {
          const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
          const rawText = extractAssistantTextFromEvents(lastAssistant?.events);
          const plan = parsePlanFromLlmResponse(rawText);

          if (!plan) {
            sendEvent({
              type: 'error',
              error:
                'Response was not valid JSON with "sharedContext" and "subtasks". Previous list unchanged.',
              lastAssistantContent: rawText || undefined,
              expectedSchema: DECOMPOSE_EXPECTED_SCHEMA
            });
            finish();
            return;
          }

          let orchestratorMessages: ChatMessage[] = [];
          try {
            orchestratorMessages = JSON.parse(orchestrator.messageJson ?? '[]');
          } catch {
            orchestratorMessages = [];
          }
          orchestratorMessages.push({
            role: 'user',
            content: userMessage.trim(),
            createdAt: new Date().toISOString()
          });
          orchestratorMessages.push({
            role: 'assistant',
            content: `Generated ${plan.subtasks.length} task(s) with shared context.`,
            createdAt: new Date().toISOString()
          });

          const toSave = serializeSubtasksPayload({
            sharedContext: plan.sharedContext,
            handoffLog: '',
            subtasks: plan.subtasks
          });

          db.updateOrchestrator(orchestratorId, {
            messageJson: JSON.stringify(orchestratorMessages),
            subtasksJson: toSave
          })
            .then(async (updated) => {
              const final = updated ?? (await db.getOrchestrator(orchestratorId));
              if (final) {
                sendEvent({ type: 'done', orchestrator: final });
              }
              finish();
            })
            .catch(() => {
              sendEvent({ type: 'error', error: 'Failed to save orchestrator' });
              finish();
            });
        },
        onError(message: string) {
          sendEvent({ type: 'error', error: message });
          finish();
        },
        onHistory() {}
      };

      const result = await dispatchPrompt({
        sessionId: tempSessionId,
        text: promptText,
        subscriber
      });

      if (result.error) {
        sendEvent({ type: 'error', error: result.error });
        finish();
      }
    }
  );

  // Run orchestrator steps in background; updates DB run state as it goes
  async function runOrchestratorInBackground(
    workspaceId: string,
    orchestratorId: string,
    payload: OrchestratorSubtasksPayload,
    startIndex: number
  ): Promise<void> {
    const subtasks = payload.subtasks;
    const total = subtasks.length;

    const orchestrator = await db.getOrchestrator(orchestratorId);
    if (!orchestrator) {
      return;
    }

    const bRestart =
      orchestrator.runStatus === 'failed' ||
      (orchestrator.runStatus === 'running' && orchestrator.runCurrentStep === 0);

    try {
      for (let subtaskIndex = startIndex; subtaskIndex < subtasks.length; subtaskIndex++) {
        // Check for cancellation/stop between steps by reading latest DB state.
        const currentState = await db.getOrchestrator(orchestratorId);
        if ((!currentState || currentState.runStatus !== 'running') && bRestart === false) {
          // Stop silently if runStatus was changed (e.g. to "stopped" or "failed").
          return;
        }

        const task = subtasks[subtaskIndex];
        const globalIndex = subtaskIndex;

        const createResult = await createSessionWithAgent({
          workspaceId,
          name: task.name,
          tags:
            task.category && String(task.category).trim()
              ? normalizeTagStringList([task.category as string])
              : null
        });
        if (createResult.error || !createResult.session) {
          await db.updateOrchestrator(orchestratorId, {
            runStatus: 'failed',
            runCurrentStep: globalIndex,
            runTotalSteps: total,
            subtasksJson: serializeSubtasksPayload(payload)
          });
          return;
        }

        // Attach the created session id to this subtask so the UI
        // can later group sessions under their orchestrator.
        task.sessionId = createResult.session.id;

        const stepPrompt = buildStepPrompt(task, payload);
        const runResult = await dispatchPromptAndWait({
          sessionId: createResult.session.id,
          text: stepPrompt,
          timeoutMs: 60000_000
        });
        if (runResult.error) {
          await db.updateOrchestrator(orchestratorId, {
            runStatus: 'failed',
            runCurrentStep: globalIndex,
            runTotalSteps: total,
            subtasksJson: serializeSubtasksPayload(payload)
          });
          return;
        }

        const snippet = summarizeStepHandoff(runResult.messages);
        payload.handoffLog = appendHandoff(
          payload.handoffLog,
          globalIndex + 1,
          task.name,
          snippet
        );

        await db.updateOrchestrator(orchestratorId, {
          runCurrentStep: globalIndex + 1,
          runTotalSteps: total,
          subtasksJson: serializeSubtasksPayload(payload)
        });
      }
      await db.updateOrchestrator(orchestratorId, {
        runStatus: 'completed',
        runCurrentStep: total,
        runTotalSteps: total,
        subtasksJson: serializeSubtasksPayload(payload)
      });
    } catch (error) {
      console.error('error while running orchestrator', error);
      const current = await db.getOrchestrator(orchestratorId);
      const step = current?.runCurrentStep ?? 0;
      await db.updateOrchestrator(orchestratorId, {
        runStatus: 'failed',
        runCurrentStep: step,
        runTotalSteps: total,
        subtasksJson: serializeSubtasksPayload(payload)
      });
    }
  }

  // POST /api/workspaces/:workspaceId/orchestrators/:orchestratorId/run — start run in background, return 202
  fastify.post(
    '/api/workspaces/:workspaceId/orchestrators/:orchestratorId/run',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, orchestratorId } = request.params as {
        workspaceId: string;
        orchestratorId: string;
      };
      const body = (request.body as { startIndex?: number }) ?? {};
      const startIndex = Math.max(0, body.startIndex ?? 0);

      const orchestrator = await db.getOrchestrator(orchestratorId);
      if (!orchestrator || orchestrator.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Orchestrator not found' });
      }

      if (orchestrator.runStatus === 'running') {
        return reply.status(409).send({ error: 'Run already in progress' });
      }

      const payload = parseSubtasksPayloadString(orchestrator.subtasksJson);
      if (!payload?.subtasks.length) {
        return reply.status(400).send({
          error: orchestrator.subtasksJson?.trim()
            ? 'Invalid subtasksJson'
            : 'No subtasks defined. Generate tasks first.'
        });
      }

      const toRun = payload.subtasks.slice(startIndex);
      if (toRun.length === 0) {
        return reply.status(400).send({ error: 'No steps to run from startIndex.' });
      }

      if (startIndex === 0) {
        payload.handoffLog = '';
      }

      const runStartedAt = new Date().toISOString();
      await db.updateOrchestrator(orchestratorId, {
        runStatus: 'running',
        runCurrentStep: startIndex,
        runTotalSteps: payload.subtasks.length,
        runStartedAt,
        subtasksJson: serializeSubtasksPayload(payload)
      });

      runOrchestratorInBackground(workspaceId, orchestratorId, payload, startIndex).catch(() => {
        // state already updated in runOrchestratorInBackground
      });

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

      const updated = await db.updateOrchestrator(orchestratorId, {
        runStatus: 'stopped',
        runCurrentStep: currentStep,
        runTotalSteps: totalSteps
      });

      return reply.send(updated ?? orchestrator);
    }
  );
}
