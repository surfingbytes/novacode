/**
 * Best-effort ACP session teardown when a Nova session is deleted.
 */

// classes
import { db } from './database';
import { closeClaudeAcpForNovaSession } from './claudeAcp';
import { closeCursorAcpSession } from './cursorAcp';
import { closeCodexAcpSession } from './codexAcp';
import { closeOpenCodeAcpSession } from './openCodeAcp';
import { closeVibeAcpSession } from './vibeAcp';
import { resolveWorkspaceAbsolutePath } from './workspacePaths';

// types
import type { AgentType } from '../@types/index';

export async function closeAcpSessionForAgent(
  agentType: AgentType,
  acpSessionId: string,
  workspacePath: string,
  novaSessionId?: string
): Promise<void> {
  if (agentType === 'claude') {
    if (novaSessionId) {
      await closeClaudeAcpForNovaSession(novaSessionId, acpSessionId || null);
    }
    return;
  }

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
}

export async function closeAcpSessionForNovaSession(novaSessionId: string): Promise<void> {
  const session = await db.getSession(novaSessionId);
  if (!session) return;

  const agentType = (session.agentType as AgentType | null) ?? 'cursor-agent';
  if (agentType === 'claude') {
    await closeClaudeAcpForNovaSession(novaSessionId, session.sessionId);
    return;
  }

  if (!session.sessionId) return;

  const workspace = await db.getWorkspace(session.workspaceId);
  if (!workspace) return;

  const workspacePath = resolveWorkspaceAbsolutePath(workspace.path);
  await closeAcpSessionForAgent(agentType, session.sessionId, workspacePath, novaSessionId);
}
