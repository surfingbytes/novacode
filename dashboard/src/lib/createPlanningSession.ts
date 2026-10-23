// classes
import { orchestratorApi } from '@/classes/api';

// stores
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { AgentType, ApprovalPolicy } from '@/@types/index';

/** Orchestrator part of the New session dialog (orchestrator mode). */
export interface NewOrchestratorOptions {
  workerAgentType: AgentType;
  /** null = the planning chat's model. */
  workerModel: string | null;
  maxParallel: number;
  /** null = the planning chat's agent (and model). */
  verifyAgentType: AgentType | null;
  verifyModel: string | null;
}

/**
 * Orchestrator mode of the New session dialog: create the planning chat and its
 * (still empty) plan in one go. Returns the chat's session id to open.
 */
export async function createPlanningSession(
  workspaceId: string,
  payload: {
    name: string;
    tags?: string[] | null;
    agentType: AgentType;
    modelSelection?: string | null;
    approvalPolicy: ApprovalPolicy;
    orchestrator: NewOrchestratorOptions;
  }
): Promise<string> {
  const { data } = await orchestratorApi.create(workspaceId, {
    ...(payload.name ? { name: payload.name } : {}),
    agentType: payload.orchestrator.workerAgentType,
    workerModel: payload.orchestrator.workerModel,
    maxParallel: payload.orchestrator.maxParallel,
    verifyAgentType: payload.orchestrator.verifyAgentType,
    verifyModel: payload.orchestrator.verifyModel,
    planner: {
      agentType: payload.agentType,
      modelSelection: payload.modelSelection ?? null,
      approvalPolicy: payload.approvalPolicy,
      ...(payload.name ? { name: payload.name } : {}),
      tags: payload.tags ?? null
    }
  });
  useOrchestratorsStore().upsertOrchestrator(data);
  if (!data.sourceSessionId) {
    throw new Error('The planning chat was not created');
  }
  return data.sourceSessionId;
}
