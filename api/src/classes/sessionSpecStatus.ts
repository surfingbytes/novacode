// classes
import { db } from './database';
import { isChatNewerThanSpec, readSessionSpec, sessionSpecPath, specHasContent } from './sessionSpec';
import { broadcastSessionSpecStatus } from './wsBroadcast';

// types
import type { SessionSpecStatus } from '../@types/index';

interface SpecSession {
  id: string;
  name: string;
  workspaceId: string;
  agentType: string;
  modelSelection: string;
  updatedAt: string;
}

export async function buildSessionSpecStatus(session: SpecSession): Promise<SessionSpecStatus> {
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
    bChatNewerThanSpec: spec ? isChatNewerThanSpec(session.updatedAt, spec.updatedAt) : false
  };
}

/** Push the spec status of a session to its workspace (after the nova MCP wrote the spec). */
export async function publishSpecStatus(sessionId: string): Promise<void> {
  const session = await db.getSession(sessionId);
  if (!session) return;
  broadcastSessionSpecStatus(session.workspaceId, await buildSessionSpecStatus(session));
}
