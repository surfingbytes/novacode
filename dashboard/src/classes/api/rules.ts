import { http } from './http';

// types
import type { WorkspaceRuleFileContent, WorkspaceRuleFileSummary } from '@/@types/index';

// ---------------------------------- Workspace rules ----------------------------------
export const workspaceRulesApi = {
  list: (workspaceId: string): ReturnType<typeof http.get<WorkspaceRuleFileSummary[]>> =>
    http.get<WorkspaceRuleFileSummary[]>(`/workspaces/${workspaceId}/rules`),

  read: (
    workspaceId: string,
    filename: string
  ): ReturnType<typeof http.get<WorkspaceRuleFileContent>> =>
    http.get<WorkspaceRuleFileContent>(
      `/workspaces/${workspaceId}/rules/${encodeURIComponent(filename)}`
    ),

  update: (
    workspaceId: string,
    filename: string,
    content: string
  ): ReturnType<typeof http.put<{ filename: string }>> =>
    http.put<{ filename: string }>(
      `/workspaces/${workspaceId}/rules/${encodeURIComponent(filename)}`,
      { content }
    ),

  remove: (
    workspaceId: string,
    filename: string
  ): ReturnType<typeof http.delete<{ filename: string }>> =>
    http.delete<{ filename: string }>(
      `/workspaces/${workspaceId}/rules/${encodeURIComponent(filename)}`
    ),

  rename: (
    workspaceId: string,
    filename: string,
    newFilename: string
  ): ReturnType<typeof http.patch<{ filename: string }>> =>
    http.patch<{ filename: string }>(
      `/workspaces/${workspaceId}/rules/${encodeURIComponent(filename)}`,
      { newFilename }
    )
};

export const globalRulesApi = {
  list: (): ReturnType<typeof http.get<WorkspaceRuleFileSummary[]>> =>
    http.get<WorkspaceRuleFileSummary[]>('/global-rules'),

  read: (filename: string): ReturnType<typeof http.get<WorkspaceRuleFileContent>> =>
    http.get<WorkspaceRuleFileContent>(`/global-rules/${encodeURIComponent(filename)}`),

  update: (filename: string, content: string): ReturnType<typeof http.put<{ filename: string }>> =>
    http.put<{ filename: string }>(`/global-rules/${encodeURIComponent(filename)}`, { content }),

  remove: (filename: string): ReturnType<typeof http.delete<{ filename: string }>> =>
    http.delete<{ filename: string }>(`/global-rules/${encodeURIComponent(filename)}`),

  rename: (
    filename: string,
    newFilename: string
  ): ReturnType<typeof http.patch<{ filename: string }>> =>
    http.patch<{ filename: string }>(`/global-rules/${encodeURIComponent(filename)}`, {
      newFilename
    })
};
