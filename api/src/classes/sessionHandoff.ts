// classes
import { db } from './database';
import { assistantTextFromEvents } from './assistantText';
import { getActiveRun } from './chatEngine';
import { drainQueue, enqueuePrompt, runServerPromptInSession } from './chatQueue';
import { broadcastChat } from './chatSockets';
import { BadRequestError, ConflictError, NotFoundError } from './httpErrors';
import { logger } from './logger';
import { HANDOFF_SUMMARY_PROMPT, HANDOFF_TARGET_CONFIG_KEY, setInternalConfigValue } from './sessionHandoffConfig';
import { broadcastSessionListUpsert } from './sessionListBroadcast';
import { createSessionWithAgent } from './sessionService';
import { maybeNameUntitledSession } from './sessionTitle';

// types
import type { AgentType } from '../@types/index';

interface ContinueInNewChatInput {
  sessionId: string;
  text: string;
  imagePaths: string[];
}

const handoffsInFlight = new Set<string>();

/**
 * Check that the session can be continued and start the handoff in the
 * background (the summary turn can take minutes). Throws 404 / 409 / 400.
 */
export async function startContinueInNewChat(
  opts: ContinueInNewChatInput & { workspaceId: string }
): Promise<void> {
  const { workspaceId, sessionId, text, imagePaths } = opts;
  const session = await db.getSession(sessionId);
  if (!session || session.workspaceId !== workspaceId) {
    throw new NotFoundError('Session not found');
  }
  if (getActiveRun(sessionId) || handoffsInFlight.has(sessionId)) {
    throw new ConflictError('Agent is busy');
  }
  if ((await db.listSessionMessagesPage(sessionId, 0, 1)).messages.length === 0) {
    throw new BadRequestError('Nothing to continue from yet');
  }
  handoffsInFlight.add(sessionId);
  void continueInNewChat({ sessionId, text, imagePaths });
}

/**
 * "Continue in new chat": the source chat's own agent writes a handoff note (a
 * normal visible turn), then a new chat with the same agent/model/mode starts
 * with that note as hidden first-prompt context and the user's prompt queued.
 * Open source-chat sockets get handoff-ready / handoff-failed.
 */
async function continueInNewChat(opts: ContinueInNewChatInput): Promise<void> {
  const { sessionId, text, imagePaths } = opts;
  const fail = (message: string): void => {
    broadcastChat(sessionId, { type: 'handoff-failed', message });
  };
  try {
    const result = await runServerPromptInSession({ sessionId, text: HANDOFF_SUMMARY_PROMPT });
    if (result.error) {
      fail(`Handoff summary failed: ${result.error}`);
      return;
    }
    const lastAssistant = [...(result.messages ?? [])].reverse().find((message) => message.role === 'assistant');
    const summary = assistantTextFromEvents(lastAssistant?.events).trim();
    if (!summary) {
      fail('Handoff summary came back empty');
      return;
    }

    const source = await db.getSession(sessionId);
    if (!source) {
      fail('Session not found');
      return;
    }
    const created = await createSessionWithAgent({
      workspaceId: source.workspaceId,
      name: '',
      tags: Array.isArray(source.tags) ? (source.tags as string[]) : null,
      agentType: (source.agentType as AgentType | null) ?? undefined,
      modelSelection: source.modelSelection,
      sessionMode: source.sessionMode,
      approvalPolicy: source.approvalPolicy,
      handoffContext: { sessionId, sessionName: source.name, summary }
    });
    if (!created.session) {
      fail(created.error ?? 'Failed to create chat');
      return;
    }
    const target = created.session;
    broadcastSessionListUpsert(target.workspaceId, target);

    const linked = await db.updateSession(sessionId, {
      sessionConfigJson: setInternalConfigValue(source.sessionConfigJson, HANDOFF_TARGET_CONFIG_KEY, target.id)
    });
    if (linked) broadcastSessionListUpsert(linked.workspaceId, linked);

    await enqueuePrompt({
      sessionId: target.id,
      text,
      model: target.modelSelection ?? 'auto',
      mode: target.sessionMode ?? 'default',
      imagePaths
    });
    void maybeNameUntitledSession(target.id, text, imagePaths);
    broadcastChat(sessionId, { type: 'handoff-ready', sessionId: target.id });
    await drainQueue(target.id);
  } catch (err) {
    logger.warn({ err }, 'chat: continue in new chat failed');
    fail('Failed to continue in new chat');
  } finally {
    handoffsInFlight.delete(sessionId);
  }
}
