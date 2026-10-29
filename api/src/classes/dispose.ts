/**
 * Tear down everything that runs for a session or workspace before its rows are deleted.
 * Best effort: a failing part is logged and the rest still runs; nothing here throws.
 */

// classes
import { db } from './database';
import { cancelRun } from './chatEngine';
import { closeAcpSessionForNovaSession } from './acpSessionClose';
import { workspaceTerminalManager } from './workspaceTerminalManager';
import { cancelOrchestratorStep } from './orchestratorRunner';
import { logger } from './logger';
import { deleteSessionImages } from './sessionImages';
import { updateOrchestratorAndBroadcast } from './orchestratorEvents';

async function attempt(what: string, context: Record<string, string>, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, ...context }, `dispose: ${what} failed`);
  }
}

async function disposeSessionFor(sessionId: string, workspaceId: string, reason: string): Promise<void> {
  const context = { sessionId, workspaceId };
  await attempt('cancel orchestrator step', context, () => cancelOrchestratorStep(sessionId, reason));
  await attempt('cancel chat run', context, () => cancelRun(sessionId));
  await attempt('stop terminal', context, () => workspaceTerminalManager.stop(sessionId));
  // Reads the session row, so this must run before the session is deleted.
  await attempt('close ACP session', context, () => closeAcpSessionForNovaSession(sessionId));
  await attempt('delete session images', context, () => deleteSessionImages(sessionId));
}

export function disposeSession(sessionId: string, workspaceId: string): Promise<void> {
  return disposeSessionFor(sessionId, workspaceId, 'Step session deleted');
}

export async function disposeWorkspace(workspaceId: string): Promise<void> {
  const reason = 'workspace deleted';
  const context = { workspaceId };

  // Fail running plans first so their runners schedule no new steps.
  await attempt('cancel orchestrators', context, async () => {
    const orchestrators = await db.listOrchestratorsByWorkspace(workspaceId);
    for (const orchestrator of orchestrators) {
      if (orchestrator.runStatus !== 'running') continue;
      logger.info({ workspaceId, orchestratorId: orchestrator.id, reason }, 'dispose: failing running orchestrator');
      await attempt('fail orchestrator', { ...context, orchestratorId: orchestrator.id }, () =>
        updateOrchestratorAndBroadcast(workspaceId, orchestrator.id, { runStatus: 'failed' })
      );
    }
  });

  let sessionIds: string[] = [];
  await attempt('list sessions', context, async () => {
    sessionIds = (await db.listSessionsByWorkspace(workspaceId)).map((session) => session.id);
  });
  for (const sessionId of sessionIds) {
    await disposeSessionFor(sessionId, workspaceId, reason);
  }
  await attempt('stop workspace terminals', context, () => workspaceTerminalManager.stopMany(sessionIds));
}
