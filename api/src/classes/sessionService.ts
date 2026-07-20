// classes
import { db } from './database';
import { MODE_SENTINEL } from './agentModes';
import {
  LINKED_PLAN_CONTEXT_CONFIG_KEY,
  serializeLinkedPlanContext
} from './linkedPlanContext';

// types
import type { SessionModel as Session } from '../generated/client/models/Session';
import type { AgentType } from '../@types/index';
import type { LinkedPlanContext } from './linkedPlanContext';

export interface CreateSessionWithAgentParams {
  workspaceId: string;
  name: string;
  /** Optional tags for this session (same shape as workspace tags). */
  tags?: string[] | null;
  /** Which backend agent to use for this session (defaults to workspace.defaultAgentType or cursor-agent). */
  agentType?: AgentType;
  /** Optional explicit model id; omitted keeps the latest model for this agent. */
  modelSelection?: string | null;
  /** Optional backend-linked plan context to inject on the first prompt. */
  linkedPlanContext?: LinkedPlanContext | null;
  /** Optional explicit session mode; plan handoffs default to agent. */
  sessionMode?: string | null;
}

export interface CreateSessionWithAgentResult {
  session?: Session;
  error?: string;
}

// shared by HTTP route (POST /api/workspaces/:id/sessions)
export async function createSessionWithAgent(
  params: CreateSessionWithAgentParams
): Promise<CreateSessionWithAgentResult> {
  const { workspaceId, name, tags = null } = params;

  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) {
    return { error: 'Workspace not found' };
  }

  const agentType: AgentType =
    params.agentType ??
    ((workspace.defaultAgentType as AgentType | null) ?? 'cursor-agent');
  const latestSameAgentSession = await db.getLatestSessionByAgentType(agentType);
  const modelSelection = params.modelSelection ?? latestSameAgentSession?.modelSelection ?? 'auto';
  const sessionMode = params.sessionMode
    ?? (params.linkedPlanContext ? 'agent' : undefined)
    ?? latestSameAgentSession?.sessionMode
    ?? MODE_SENTINEL;
  const sessionConfigJson = params.linkedPlanContext
    ? JSON.stringify({
        [LINKED_PLAN_CONTEXT_CONFIG_KEY]: serializeLinkedPlanContext(params.linkedPlanContext),
      })
    : null;

  const session = await db.createSession({
    name,
    tags,
    workspaceId,
    agentType,
    modelSelection,
    sessionMode,
    sessionConfigJson,
  });

  // ACP agents create their backend session lazily on the first prompt. Cursor used
  // to pre-create a CLI chat id here, but native `cursor-agent acp` needs ACP ids.
  const sessionId: string | null = null;

  const updatedSession = await db.updateSession(session.id, { sessionId });
  if (!updatedSession) {
    return { error: 'Failed to update session' };
  }

  return { session: updatedSession };
}
