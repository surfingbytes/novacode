// classes
import { db } from './database';
import { resolveAuthenticatedOneShotAgentType } from './agentAuthStatus';
import { broadcastSessionListUpsert } from './sessionListBroadcast';
import { resolveWorkspaceAbsolutePath } from './workspacePaths';
import {
  buildSessionTitlePrompt,
  buildSessionTitlePromptFromAssistant,
  cleanSessionTitle,
  extractFirstAssistantText,
  resolveOneShotModel,
  runOneShotAgentText
} from './oneShotAgentText';
import { logger } from './logger';

// types
import type { ChatMessage } from '../@types/index';

const namingInFlight = new Set<string>();

async function generateAndApplySessionTitle(
  sessionId: string,
  promptText: string
): Promise<void> {
  const current = await db.getSession(sessionId);
  if (!current || current.name.trim() !== '') {
    return;
  }
  if (namingInFlight.has(sessionId)) {
    return;
  }
  namingInFlight.add(sessionId);
  try {
    const workspace = await db.getWorkspace(current.workspaceId);
    if (!workspace) {
      return;
    }
    const user = await db.getFirstUser();
    const agentType = await resolveAuthenticatedOneShotAgentType(
      user?.utilityAgentType,
      [current.agentType, workspace.defaultAgentType],
      user?.claudeToken
    );
    const cwd = resolveWorkspaceAbsolutePath(workspace.path);
    const model = await resolveOneShotModel(user?.utilityModelSelection, agentType);
    const raw = await runOneShotAgentText({
      agentType,
      cwd,
      promptText,
      model,
      claudeToken: user?.claudeToken ?? null,
      runIdPrefix: 'session-title',
      denyTools: true
    });
    const title = cleanSessionTitle(raw);
    if (!title) {
      logger.warn({ agentType, model }, 'chat: skipped unusable session title');
      return;
    }
    const latest = await db.getSession(sessionId);
    if (!latest || latest.name.trim() !== '') {
      return;
    }
    const updated = await db.updateSession(sessionId, { name: title });
    if (updated) {
      broadcastSessionListUpsert(updated.workspaceId, updated);
    }
  } catch (error) {
    logger.warn({ err: error }, 'chat: failed to generate session title');
  } finally {
    namingInFlight.delete(sessionId);
  }
}

/** Name an untitled session from its first prompt (image-only prompts wait for the reply). */
export async function maybeNameUntitledSession(
  sessionId: string,
  text: string,
  imagePaths: string[]
): Promise<void> {
  if (!text.trim()) {
    // Image-only prompts have no usable text. Wait for the first assistant
    // reply and name from that in maybeNameUntitledSessionFromAssistant.
    return;
  }
  await generateAndApplySessionTitle(sessionId, buildSessionTitlePrompt(text, imagePaths.length));
}

/** Name an untitled session whose first prompt was image-only, from the first assistant reply. */
export async function maybeNameUntitledSessionFromAssistant(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser || firstUser.content?.trim() || !firstUser.imagePaths?.length) {
    return;
  }
  const assistantText = extractFirstAssistantText(messages);
  if (!assistantText) {
    return;
  }
  await generateAndApplySessionTitle(sessionId, buildSessionTitlePromptFromAssistant(assistantText));
}
