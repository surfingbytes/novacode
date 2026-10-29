import { http } from './http';

// types
import type {
  AgentType,
  ApprovalPolicy,
  Orchestrator,
  OrchestratorRunMode,
  OrchestratorSummary,
  RoleTemplate
} from '@/@types/index';

// ---------------------------------- Orchestrator ----------------------------------
export interface OrchestratorPlannerPayload {
  agentType?: AgentType;
  modelSelection?: string | null;
  approvalPolicy?: ApprovalPolicy;
  name?: string;
  tags?: string[] | null;
}

export const orchestratorApi = {
  /** Non-archived orchestrators of every workspace, without `messageJson` (nav sidebar). */
  listAll: (): ReturnType<typeof http.get<OrchestratorSummary[]>> =>
    http.get<OrchestratorSummary[]>('/orchestrators'),

  list: (workspaceId: string): ReturnType<typeof http.get<Orchestrator[]>> =>
    http.get<Orchestrator[]>(`/workspaces/${workspaceId}/orchestrators`),

  get: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.get<Orchestrator>> =>
    http.get<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}`),

  create: (
    workspaceId: string,
    payload?: {
      name?: string;
      tags?: string | null;
      /** Agent for the step sessions. */
      agentType?: AgentType;
      workerModel?: string | null;
      maxParallel?: number;
      /** Final verify step; null = the planning chat's. */
      verifyAgentType?: AgentType | null;
      verifyModel?: string | null;
      /** Also create the planning chat (linked as `sourceSessionId`). */
      planner?: OrchestratorPlannerPayload;
    }
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators`, payload ?? {}),

  /** Attach a new planning chat to an orchestrator that has none. */
  createPlanner: (
    workspaceId: string,
    orchestratorId: string,
    payload?: OrchestratorPlannerPayload
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(
      `/workspaces/${workspaceId}/orchestrators/${orchestratorId}/planner`,
      payload ?? {}
    ),

  update: (
    workspaceId: string,
    orchestratorId: string,
    patch: {
      name?: string;
      tags?: string | null;
      subtasksJson?: string | null;
      archived?: boolean;
      agentType?: AgentType;
      workerModel?: string | null;
      maxParallel?: number;
      /** Final verify step; null = the planning chat's. */
      verifyAgentType?: AgentType | null;
      verifyModel?: string | null;
      isFavorite?: boolean;
    }
  ): ReturnType<typeof http.patch<Orchestrator>> =>
    http.patch<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}`, patch),

  remove: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.delete> =>
    http.delete(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}`),

  /** Clear the finished-run "Done" badge. */
  markRead: (
    workspaceId: string,
    orchestratorId: string
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}/read`),

  run: (
    workspaceId: string,
    orchestratorId: string,
    body?: {
      mode?: OrchestratorRunMode;
      startIndex?: number;
      onlyIndex?: number;
      next?: boolean;
      fresh?: boolean;
    }
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(
      `/workspaces/${workspaceId}/orchestrators/${orchestratorId}/run`,
      body ?? {}
    ),

  stop: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}/stop`),

  clone: (
    workspaceId: string,
    orchestratorId: string
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}/clone`)
};

// ---------------------------------- Role templates ----------------------------------
export interface RoleTemplatePayload {
  name: string;
  description?: string | null;
  content: string;
}

export const roleTemplatesApi = {
  list: (): ReturnType<typeof http.get<RoleTemplate[]>> =>
    http.get<RoleTemplate[]>('/role-templates'),

  create: (payload: RoleTemplatePayload): ReturnType<typeof http.post<RoleTemplate>> =>
    http.post<RoleTemplate>('/role-templates', payload),

  update: (
    templateId: string,
    patch: Partial<RoleTemplatePayload>
  ): ReturnType<typeof http.patch<RoleTemplate>> =>
    http.patch<RoleTemplate>(`/role-templates/${templateId}`, patch),

  remove: (templateId: string): ReturnType<typeof http.delete> =>
    http.delete(`/role-templates/${templateId}`)
};
