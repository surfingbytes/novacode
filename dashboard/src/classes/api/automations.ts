import { http } from './http';

// types
import type { AgentType, Automation, AutomationRun } from '@/@types/index';

// ---------------------------------- Automations ----------------------------------
export interface CreateAutomationPayload {
  name: string;
  workspaceId: string;
  agentType?: AgentType;
  prompt: string;
  intervalMinutes: number;
  enabled?: boolean;
}

export interface UpdateAutomationPayload {
  name?: string;
  agentType?: AgentType;
  prompt?: string;
  intervalMinutes?: number;
  enabled?: boolean;
}

export const automationsApi = {
  list: (): ReturnType<typeof http.get<Automation[]>> => http.get<Automation[]>('/automations'),

  listByWorkspace: (workspaceId: string): ReturnType<typeof http.get<Automation[]>> =>
    http.get<Automation[]>(`/workspaces/${workspaceId}/automations`),

  get: (id: string): ReturnType<typeof http.get<Automation>> =>
    http.get<Automation>(`/automations/${id}`),

  create: (payload: CreateAutomationPayload): ReturnType<typeof http.post<Automation>> =>
    http.post<Automation>('/automations', payload),

  update: (
    id: string,
    payload: UpdateAutomationPayload
  ): ReturnType<typeof http.patch<Automation>> =>
    http.patch<Automation>(`/automations/${id}`, payload),

  remove: (id: string): ReturnType<typeof http.delete> => http.delete(`/automations/${id}`),

  trigger: (id: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>(`/automations/${id}/trigger`),

  listRuns: (id: string, limit?: number): ReturnType<typeof http.get<AutomationRun[]>> =>
    http.get<AutomationRun[]>(`/automations/${id}/runs`, { params: limit ? { limit } : undefined }),

  getRun: (id: string, runId: string): ReturnType<typeof http.get<AutomationRun>> =>
    http.get<AutomationRun>(`/automations/${id}/runs/${runId}`)
};
