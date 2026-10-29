import { http } from './http';

// types
import type {
  CiFixPromptResponse,
  CiStatusResponse,
  ForgeConnectionStatus,
  ForgeConnectionTestResult,
  ForgeConnectionsResponse,
  ForgeProvider,
  ForgeRepoDetectResponse,
  SaveForgeConnectionPayload
} from '@/@types/index';

// ---------------------------------- Forges (Gitea / Forgejo / GitHub / GitLab) ----------------------------------
export const forgeApi = {
  connections: (): ReturnType<typeof http.get<ForgeConnectionsResponse>> =>
    http.get<ForgeConnectionsResponse>('/forge/connections'),
  /** The server tests the connection before saving. */
  createConnection: (
    payload: SaveForgeConnectionPayload
  ): ReturnType<typeof http.post<ForgeConnectionStatus>> =>
    http.post<ForgeConnectionStatus>('/forge/connections', payload),
  /** Omit `token` to keep the stored one. */
  updateConnection: (
    id: string,
    payload: SaveForgeConnectionPayload
  ): ReturnType<typeof http.put<ForgeConnectionStatus>> =>
    http.put<ForgeConnectionStatus>(`/forge/connections/${encodeURIComponent(id)}`, payload),
  deleteConnection: (id: string): ReturnType<typeof http.delete> =>
    http.delete(`/forge/connections/${encodeURIComponent(id)}`),
  test: (payload: {
    provider: ForgeProvider;
    url: string;
    token?: string;
    connectionId?: string;
  }): ReturnType<typeof http.post<ForgeConnectionTestResult>> =>
    http.post<ForgeConnectionTestResult>('/forge/test', payload),
  detectRepo: (workspaceId: string): ReturnType<typeof http.get<ForgeRepoDetectResponse>> =>
    http.get<ForgeRepoDetectResponse>(`/forge/workspace/${workspaceId}/repo`),
  ciStatus: (
    workspaceId: string,
    opts?: { repo?: string; sessionId?: string | null }
  ): ReturnType<typeof http.get<CiStatusResponse>> =>
    http.get<CiStatusResponse>(`/forge/workspace/${workspaceId}/ci`, {
      params: {
        ...(opts?.repo ? { repo: opts.repo } : {}),
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {})
      }
    }),
  fixPrompt: (
    workspaceId: string,
    runId: number,
    repo?: string
  ): ReturnType<typeof http.post<CiFixPromptResponse>> =>
    http.post<CiFixPromptResponse>(
      `/forge/workspace/${workspaceId}/ci/runs/${runId}/fix-prompt`,
      {},
      { params: repo ? { repo } : {} }
    )
};
