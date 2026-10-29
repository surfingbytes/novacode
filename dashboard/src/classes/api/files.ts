import { http } from './http';

// types
import type { FileListResponse, FilePathResponse, FileReadResponse } from '@novacode/shared';

// ---------------------------------- Files (workspace-scoped) ----------------------------------
export const filesApi = {
  list: (
    workspaceId: string,
    path?: string,
    opts?: { hidden?: boolean }
  ): ReturnType<typeof http.get<FileListResponse>> =>
    http.get<FileListResponse>(`/workspaces/${workspaceId}/files/list`, {
      params: {
        ...(path ? { path } : {}),
        ...(opts?.hidden ? { hidden: '1' } : {})
      }
    }),

  read: (workspaceId: string, path: string): ReturnType<typeof http.get<FileReadResponse>> =>
    http.get<FileReadResponse>(`/workspaces/${workspaceId}/files/read`, {
      params: { path }
    }),

  write: (
    workspaceId: string,
    path: string,
    content: string
  ): ReturnType<typeof http.put<FilePathResponse>> =>
    http.put<FilePathResponse>(`/workspaces/${workspaceId}/files/write`, { path, content }),

  mkdir: (workspaceId: string, path: string): ReturnType<typeof http.post<FilePathResponse>> =>
    http.post<FilePathResponse>(`/workspaces/${workspaceId}/files/mkdir`, { path }),

  rename: (
    workspaceId: string,
    from: string,
    to: string
  ): ReturnType<typeof http.post<FilePathResponse>> =>
    http.post<FilePathResponse>(`/workspaces/${workspaceId}/files/rename`, { from, to }),

  remove: (workspaceId: string, path: string): ReturnType<typeof http.delete<FilePathResponse>> =>
    http.delete<FilePathResponse>(`/workspaces/${workspaceId}/files`, { params: { path } })
};
