/**
 * Best-effort ACP session teardown when a Nova session is deleted.
 */

// classes
import { db } from './database';
import { disposeAllClaudeAgents } from './claudeAcp';
import { killAllAcpSubprocesses } from './acpSubprocessRunner';
import { logger } from './logger';
import { getAgentAdapter, isAgentType } from './agents';

/**
 * Server shutdown: kill ACP subprocesses still running a prompt and dispose the embedded
 * Claude agents. Uses no closeSession/deleteSession, so agents can resume after restart.
 */
export async function closeAllAcpSessions(reason: string): Promise<void> {
  const killed = killAllAcpSubprocesses();
  if (killed > 0) logger.info({ reason, killed }, 'Killed running ACP subprocesses');
  await disposeAllClaudeAgents(reason);
}

export async function closeAcpSessionForNovaSession(novaSessionId: string): Promise<void> {
  const session = await db.getSession(novaSessionId);
  if (!session) return;

  const agentType = session.agentType ?? 'cursor-agent';
  // Unknown (legacy) agent types have nothing to close.
  if (!isAgentType(agentType)) return;
  await getAgentAdapter(agentType).close(novaSessionId);
}
