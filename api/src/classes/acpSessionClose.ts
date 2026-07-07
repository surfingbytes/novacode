/**
 * Best-effort ACP session teardown when a Nova session is deleted.
 */

// node_modules
import { join } from 'node:path';

// classes
import { db } from './database';
import { closeCursorAcpSession } from './cursorAcp';
import { closeCodexAcpSession } from './codexAcp';
import { closeOpenCodeAcpSession } from './openCodeAcp';
import { closeVibeAcpSession } from './vibeAcp';

// types
import type { AgentType } from '../@types/index';

export async function closeAcpSessionForAgent(
  agentType: AgentType,
  acpSessionId: string,
  workspacePath: string
): Promise<void> {
  if (!acpSessionId) return;

  if (agentType === 'cursor-agent') {
    await closeCursorAcpSession(acpSessionId, workspacePath);
  } else if (agentType === 'codex') {
    await closeCodexAcpSession(acpSessionId, workspacePath);
  } else if (agentType === 'open-code') {
    await closeOpenCodeAcpSession(acpSessionId, workspacePath);
  } else if (agentType === 'mistral-vibe') {
    await closeVibeAcpSession(acpSessionId, workspacePath);
  }
  // Claude uses embedded agent — no subprocess session to close.
}

export async function closeAcpSessionForNovaSession(novaSessionId: string): Promise<void> {
  const session = await db.getSession(novaSessionId);
  if (!session?.sessionId) return;

  const workspace = await db.getWorkspace(session.workspaceId);
  if (!workspace) return;

  const workspacePath = join('/data-root', workspace.path);
  const agentType = (session.agentType as AgentType | null) ?? 'cursor-agent';
  await closeAcpSessionForAgent(agentType, session.sessionId, workspacePath);
}
