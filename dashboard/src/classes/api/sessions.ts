import { http } from './http';

// types
import type {
  Session,
  SessionSpecStatus,
  SessionUsageSummary,
  SessionUsageTurn
} from '@/@types/index';
import type {
  CreateSessionBody,
  PlanUpdateBody,
  PlanUpdateResponse,
  SessionBulkArchiveResponse,
  SessionBulkDeleteResponse,
  UpdateSessionBody
} from '@novacode/shared';

// ---------------------------------- Sessions ----------------------------------
export const sessionsApi = {
  listAll: (): ReturnType<typeof http.get<Session[]>> => http.get<Session[]>('/sessions'),

  list: (
    workspaceId: string,
    opts?: { archived?: boolean }
  ): ReturnType<typeof http.get<Session[]>> =>
    http.get<Session[]>(`/workspaces/${workspaceId}/sessions`, {
      params: opts?.archived !== undefined ? { archived: String(opts.archived) } : undefined
    }),

  get: (workspaceId: string, sessionId: string): ReturnType<typeof http.get<Session>> =>
    http.get<Session>(`/workspaces/${workspaceId}/sessions/${sessionId}`, {
      // Bound the wait — a timeout surfaces as the offline banner / error state
      // instead of leaving the view silently fetching forever.
      timeout: 20000
    }),

  listUsage: (
    workspaceId: string,
    sessionId: string
  ): ReturnType<typeof http.get<{ turns: SessionUsageTurn[]; summary: SessionUsageSummary }>> =>
    http.get<{ turns: SessionUsageTurn[]; summary: SessionUsageSummary }>(
      `/workspaces/${workspaceId}/sessions/${sessionId}/usage`
    ),

  /** Starts the handoff; completion arrives on the chat socket (handoff-ready / handoff-failed). */
  continueInNewChat: (
    workspaceId: string,
    sessionId: string,
    payload: { text: string; imagePaths: string[] }
  ): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>(
      `/workspaces/${workspaceId}/sessions/${sessionId}/continue-in-new-chat`,
      payload
    ),

  create: (
    workspaceId: string,
    payload: CreateSessionBody
  ): ReturnType<typeof http.post<Session>> =>
    http.post<Session>(`/workspaces/${workspaceId}/sessions`, payload),

  update: (
    workspaceId: string,
    sessionId: string,
    patch: UpdateSessionBody
  ): ReturnType<typeof http.patch<Session>> =>
    http.patch<Session>(`/workspaces/${workspaceId}/sessions/${sessionId}`, patch),

  markRead: (sessionId: string): ReturnType<typeof http.post<Session>> =>
    http.post<Session>(`/sessions/${sessionId}/read`),

  remove: (workspaceId: string, sessionId: string): ReturnType<typeof http.delete> =>
    http.delete(`/workspaces/${workspaceId}/sessions/${sessionId}`),

  deletePlanDocument: (
    workspaceId: string,
    sessionId: string,
    planId: string
  ): ReturnType<typeof http.delete> =>
    http.delete(
      `/workspaces/${workspaceId}/sessions/${sessionId}/plan-documents/${encodeURIComponent(planId)}`
    ),

  updatePlanDocument: (
    workspaceId: string,
    sessionId: string,
    planId: string,
    markdown: string
  ): ReturnType<
    typeof http.patch<{ id: string; sessionId: string; title: string; markdown: string }>
  > =>
    http.patch(
      `/workspaces/${workspaceId}/sessions/${sessionId}/plan-documents/${encodeURIComponent(planId)}`,
      { markdown }
    ),

  /** Persist plan snapshot into chat history (ACP plan update), same path as Claude ACP. */
  persistPlanUpdate: (
    workspaceId: string,
    sessionId: string,
    payload: PlanUpdateBody
  ): ReturnType<typeof http.post<PlanUpdateResponse>> =>
    http.post<PlanUpdateResponse>(
      `/workspaces/${workspaceId}/sessions/${sessionId}/plan-update`,
      payload
    ),

  bulkDelete: (
    workspaceId: string,
    ids: string[]
  ): ReturnType<typeof http.post<SessionBulkDeleteResponse>> =>
    http.post<SessionBulkDeleteResponse>(`/workspaces/${workspaceId}/sessions/bulk-delete`, {
      ids
    }),

  bulkArchive: (
    workspaceId: string,
    ids: string[],
    archived: boolean
  ): ReturnType<typeof http.post<SessionBulkArchiveResponse>> =>
    http.post<SessionBulkArchiveResponse>(`/workspaces/${workspaceId}/sessions/bulk-archive`, {
      ids,
      archived
    }),

  uploadImage: (
    sessionId: string,
    data: string,
    mimeType: string,
    filename?: string
  ): ReturnType<typeof http.post<{ path: string; filename: string }>> =>
    http.post<{ path: string; filename: string }>(`/sessions/${sessionId}/images`, {
      data,
      mimeType,
      ...(filename ? { filename } : {})
    }),

  /** Replace the session's spec file content. */
  updateSpec: (
    workspaceId: string,
    sessionId: string,
    content: string
  ): ReturnType<typeof http.put<SessionSpecResponse>> =>
    http.put<SessionSpecResponse>(`/workspaces/${workspaceId}/sessions/${sessionId}/spec`, {
      content
    }),

  imageUrl: (sessionId: string, filename: string): string => {
    const base = (import.meta.env.VITE_API_URL ?? location.origin + '/api').replace(/\/$/, '');
    return `${base}/sessions/${sessionId}/images/${encodeURIComponent(filename)}`;
  },

  /** Image a tool read from disk (its base64 copy is not kept in chat history). */
  toolImageUrl: (path: string): string => {
    const base = (import.meta.env.VITE_API_URL ?? location.origin + '/api').replace(/\/$/, '');
    return `${base}/files/tool-image?path=${encodeURIComponent(path)}`;
  }
};

// ---------------------------------- Session spec ----------------------------------
export interface SessionSpecResponse {
  status: SessionSpecStatus;
  content: string | null;
}

export const sessionSpecApi = {
  get: (workspaceId: string, sessionId: string): ReturnType<typeof http.get<SessionSpecResponse>> =>
    http.get<SessionSpecResponse>(`/workspaces/${workspaceId}/sessions/${sessionId}/spec`),

  /** Create the (empty template) spec file only. */
  create: (
    workspaceId: string,
    sessionId: string
  ): ReturnType<typeof http.post<SessionSpecResponse>> =>
    http.post<SessionSpecResponse>(`/workspaces/${workspaceId}/sessions/${sessionId}/spec`)
};
