import { http } from './http';

// types
import type {
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  Workspace,
  WorkspaceUsageSummary
} from '@/@types/index';
import type { WorkspaceBrowseResponse, WorkspaceMkdirResponse } from '@novacode/shared';

// ---------------------------------- Workspaces ----------------------------------
export const workspaceApi = {
  list: (): ReturnType<typeof http.get<Workspace[]>> => http.get<Workspace[]>('/workspaces'),

  browse: (path: string): ReturnType<typeof http.get<WorkspaceBrowseResponse>> =>
    http.get<WorkspaceBrowseResponse>('/workspaces/browse', {
      params: { path: path || undefined }
    }),

  createFolder: (
    parentPath: string,
    name: string
  ): ReturnType<typeof http.post<WorkspaceMkdirResponse>> =>
    http.post<WorkspaceMkdirResponse>('/workspaces/browse/mkdir', {
      path: parentPath,
      name
    }),

  create: (payload: CreateWorkspacePayload): ReturnType<typeof http.post<Workspace>> =>
    http.post<Workspace>('/workspaces', payload),

  update: (id: string, payload: UpdateWorkspacePayload): ReturnType<typeof http.put<Workspace>> =>
    http.put<Workspace>(`/workspaces/${id}`, payload),

  reorder: (ids: string[]): ReturnType<typeof http.put<void>> =>
    http.put<void>('/workspaces/reorder', { ids }),

  archive: (id: string, archived: boolean): ReturnType<typeof http.put<Workspace>> =>
    http.put<Workspace>(`/workspaces/${id}/archive`, { archived }),

  listAll: (): ReturnType<typeof http.get<Workspace[]>> =>
    http.get<Workspace[]>('/workspaces', { params: { includeArchived: 'true' } }),

  usage: (id: string): ReturnType<typeof http.get<WorkspaceUsageSummary>> =>
    http.get<WorkspaceUsageSummary>(`/workspaces/${id}/usage`),

  remove: (id: string): ReturnType<typeof http.delete> => http.delete(`/workspaces/${id}`)
};
