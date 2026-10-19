// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { db } from '../classes/database';
import { jwtPreHandler } from '../classes/auth';
import { AGENT_ROUTE_RATE_LIMIT } from '../classes/rateLimits';
import { isSessionBusy } from '../classes/chatEngine';
import { appendAssistantText, runOneShotAgentText } from '../classes/oneShotAgentText';
import { resolveWorkspaceAbsolutePath } from '../classes/workspacePaths';
import { sendPushToAll } from '../classes/push';
import { logger } from '../classes/logger';
import {
  buildSpecDecomposePrompt,
  buildWriteSpecPrompt,
  ensureSessionSpec,
  extractSpecFromReply,
  getSessionSpecJob,
  isChatNewerThanSpec,
  isSessionSpecJobRunning,
  readSessionSpec,
  sanitizePlanSubtasks,
  sessionSpecPath,
  setSessionSpecJob,
  specHasContent,
  VERIFY_STEP_NAME,
  VERIFY_STEP_PROMPT,
  writeSessionSpec
} from '../classes/sessionSpec';
import { serializeSubtasksPayload } from '../classes/orchestratorPayload';
import { runServerPromptInSession } from './chat';
import { parsePlanFromLlmResponse, updateOrchestratorAndBroadcast } from './orchestrator';
import { broadcastSessionSpecStatus } from './ws';

// types
import type { AgentType, ChatMessage, SessionSpecStatus } from '../@types/index';
import type { SessionSpecJob } from '../classes/sessionSpec';

/** The spec-writing turn re-reads the whole chat; give long conversations room. */
const WRITE_SPEC_TIMEOUT_MS = 30 * 60_000;
const PLAN_TIMEOUT_MS = 15 * 60_000;

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
    bChatNewerThanSpec: spec ? isChatNewerThanSpec(session.updatedAt, spec.updatedAt) : false,
    job: getSessionSpecJob(session.id)
  };
}

async function publishSpecStatus(sessionId: string): Promise<void> {
  const session = await db.getSession(sessionId);
  if (!session) return;
  broadcastSessionSpecStatus(session.workspaceId, await buildSessionSpecStatus(session));
}

async function setJobAndPublish(sessionId: string, job: SessionSpecJob): Promise<void> {
  setSessionSpecJob(sessionId, job);
  await publishSpecStatus(sessionId);
}

function lastAssistantText(messages: ChatMessage[] | undefined): string {
  const last = [...(messages ?? [])].reverse().find((message) => message.role === 'assistant');
  if (!last) return '';
  if (last.content?.trim()) return last.content;
  const chunks: string[] = [];
  for (const line of last.events ?? []) appendAssistantText(line, chunks);
  return chunks.join('');
}

/**
 * Chat → spec → orchestrator, no user steps in between:
 * 1. the session's own agent (full conversation) writes the spec as a normal chat turn,
 * 2. Nova saves it to the session's spec file,
 * 3. the same agent type + model splits it into steps (spec goes to every step verbatim),
 * 4. a "verify against spec" step is appended and the plan is saved, ready to run.
 */
async function runSpecToOrchestratorJob(workspaceId: string, sessionId: string): Promise<void> {
  try {
    const session = await db.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const current = await ensureSessionSpec(workspaceId, sessionId, session.name);
    const turn = await runServerPromptInSession({
      sessionId,
      text: buildWriteSpecPrompt(current.content),
      timeoutMs: WRITE_SPEC_TIMEOUT_MS
    });
    if (turn.error) throw new Error(`Writing the spec failed: ${turn.error}`);

    const spec = extractSpecFromReply(lastAssistantText(turn.messages));
    if (!spec) throw new Error('The agent did not reply with a <nova-spec> block. Spec file unchanged.');
    const saved = await writeSessionSpec(workspaceId, sessionId, spec);

    await setJobAndPublish(sessionId, { state: 'planning' });
    const [workspace, user] = await Promise.all([db.getWorkspace(workspaceId), db.getFirstUser()]);
    if (!workspace) throw new Error('Workspace not found');
    const raw = await runOneShotAgentText({
      agentType: session.agentType as AgentType,
      cwd: resolveWorkspaceAbsolutePath(workspace.path),
      promptText: buildSpecDecomposePrompt(spec),
      model: session.modelSelection,
      claudeToken: user?.claudeToken ?? null,
      runIdPrefix: 'spec-plan',
      denyTools: true,
      timeoutMs: PLAN_TIMEOUT_MS
    });
    const plan = parsePlanFromLlmResponse(raw);
    const subtasks = plan ? sanitizePlanSubtasks(plan.subtasks) : [];
    if (subtasks.length === 0) throw new Error('Planning returned no valid steps. The spec was saved; try again.');
    subtasks.push({ name: VERIFY_STEP_NAME, prompt: VERIFY_STEP_PROMPT, category: 'review' });

    const name = plan?.name || session.name.trim() || 'Plan from chat';
    const created = await db.createOrchestrator({
      workspaceId,
      name,
      agentType: session.agentType,
      sourceSessionId: sessionId
    });
    const createdAt = new Date().toISOString();
    await updateOrchestratorAndBroadcast(workspaceId, created.id, {
      messageJson: JSON.stringify([
        {
          role: 'assistant',
          content: `Generated ${subtasks.length} step(s) from the spec of chat "${session.name.trim() || 'Untitled session'}" (${saved.path}).`,
          createdAt
        }
      ]),
      subtasksJson: serializeSubtasksPayload({ sharedContext: spec, handoffLog: '', subtasks })
    });

    await setJobAndPublish(sessionId, { state: 'idle' });
    void sendPushToAll({
      title: `Plan ready: ${name}`,
      body: `${subtasks.length} steps generated from chat`,
      tag: `orchestrator-${created.id}`,
      url: `/workspace/${workspaceId}/orchestrator/${created.id}`
    }).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, sessionId }, 'Spec → orchestrator job failed');
    await setJobAndPublish(sessionId, { state: 'failed', error: message }).catch(() => {});
  }
}

export async function sessionSpecRoutes(fastify: FastifyInstance): Promise<void> {
  const loadSession = async (workspaceId: string, sessionId: string) => {
    const session = await db.getSession(sessionId);
    return session && session.workspaceId === workspaceId ? session : null;
  };

  // GET /api/workspaces/:workspaceId/sessions/:sessionId/spec — status + file content
  fastify.get(
    '/api/workspaces/:workspaceId/sessions/:sessionId/spec',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as { workspaceId: string; sessionId: string };
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
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/:sessionId/spec',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as { workspaceId: string; sessionId: string };
      const session = await loadSession(workspaceId, sessionId);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      const spec = await ensureSessionSpec(workspaceId, sessionId, session.name);
      const status = await buildSessionSpecStatus(session);
      broadcastSessionSpecStatus(workspaceId, status);
      return reply.status(201).send({ status, content: spec.content });
    }
  );

  // POST /api/workspaces/:workspaceId/sessions/:sessionId/spec/orchestrator — write spec + generate plan (background)
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/:sessionId/spec/orchestrator',
    { preHandler: jwtPreHandler, config: { rateLimit: AGENT_ROUTE_RATE_LIMIT } },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as { workspaceId: string; sessionId: string };
      const session = await loadSession(workspaceId, sessionId);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (isSessionSpecJobRunning(sessionId)) {
        return reply.status(409).send({ error: 'A plan is already being generated for this chat' });
      }
      if (isSessionBusy(sessionId)) {
        return reply.status(409).send({ error: 'The agent is still replying — wait for it to finish' });
      }
      if (!session.sessionId) {
        return reply.status(400).send({ error: 'This chat has no conversation yet' });
      }
      setSessionSpecJob(sessionId, { state: 'writing-spec' });
      const status = await buildSessionSpecStatus(session);
      broadcastSessionSpecStatus(workspaceId, status);
      void runSpecToOrchestratorJob(workspaceId, sessionId);
      return reply.status(202).send({ status });
    }
  );
}
