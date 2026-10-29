import { http } from './http';

// types
import type {
  GitBranchesResponse,
  GitCheckoutResponse,
  GitCommitMessageResponse,
  GitCommitResponse,
  GitCreateBranchResponse,
  GitDiffResponse,
  GitDiscardResponse,
  GitFetchResponse,
  GitLogResponse,
  GitPullResponse,
  GitPushResponse,
  GitShowResponse,
  GitStatusResponse
} from '@novacode/shared';

// ---------------------------------- Git (workspace-scoped) ----------------------------------
export const gitApi = {
  status: (workspaceId: string): ReturnType<typeof http.get<GitStatusResponse>> =>
    http.get<GitStatusResponse>(`/git/workspace/${workspaceId}/status`),
  diff: (
    workspaceId: string,
    file: string,
    status?: string,
    repo?: string
  ): ReturnType<typeof http.get<GitDiffResponse>> =>
    http.get<GitDiffResponse>(`/git/workspace/${workspaceId}/diff`, {
      params: { file, status, repo }
    }),
  commit: (
    workspaceId: string,
    message: string,
    files?: string[],
    repo?: string
  ): ReturnType<typeof http.post<GitCommitResponse>> =>
    http.post<GitCommitResponse>(`/git/workspace/${workspaceId}/commit`, {
      message,
      files,
      repo
    }),
  generateCommitMessage: (
    workspaceId: string,
    files: string[],
    repo?: string
  ): ReturnType<typeof http.post<GitCommitMessageResponse>> =>
    http.post<GitCommitMessageResponse>(
      `/git/workspace/${workspaceId}/commit-message`,
      { files, repo },
      // Slightly above the API one-shot wall clock so the server can return a
      // real error instead of the browser reporting a bare Network Error.
      { timeout: 50_000, retryOnNetworkError: true }
    ),
  push: (workspaceId: string, repo?: string): ReturnType<typeof http.post<GitPushResponse>> =>
    http.post<GitPushResponse>(`/git/workspace/${workspaceId}/push`, undefined, {
      params: { repo }
    }),
  branches: (
    workspaceId: string,
    repo?: string
  ): ReturnType<typeof http.get<GitBranchesResponse>> =>
    http.get<GitBranchesResponse>(`/git/workspace/${workspaceId}/branches`, {
      params: { repo }
    }),
  pull: (workspaceId: string, repo?: string): ReturnType<typeof http.post<GitPullResponse>> =>
    http.post<GitPullResponse>(`/git/workspace/${workspaceId}/pull`, undefined, {
      params: { repo }
    }),
  fetch: (workspaceId: string, repo?: string): ReturnType<typeof http.post<GitFetchResponse>> =>
    http.post<GitFetchResponse>(`/git/workspace/${workspaceId}/fetch`, undefined, {
      params: { repo }
    }),
  checkout: (
    workspaceId: string,
    branch: string,
    repo?: string,
    remoteBranch?: string
  ): ReturnType<typeof http.post<GitCheckoutResponse>> =>
    http.post<GitCheckoutResponse>(`/git/workspace/${workspaceId}/checkout`, {
      branch,
      repo,
      remoteBranch
    }),
  createBranch: (
    workspaceId: string,
    branch: string,
    repo?: string,
    startPoint?: string,
    checkout = true
  ): ReturnType<typeof http.post<GitCreateBranchResponse>> =>
    http.post<GitCreateBranchResponse>(`/git/workspace/${workspaceId}/branches`, {
      branch,
      repo,
      startPoint,
      checkout
    }),
  discard: (
    workspaceId: string,
    files: string[],
    repo?: string
  ): ReturnType<typeof http.post<GitDiscardResponse>> =>
    http.post<GitDiscardResponse>(`/git/workspace/${workspaceId}/discard`, { files, repo }),

  log: (
    workspaceId: string,
    repo?: string,
    limit?: number
  ): ReturnType<typeof http.get<GitLogResponse>> =>
    http.get<GitLogResponse>(`/git/workspace/${workspaceId}/log`, {
      params: { repo, limit }
    }),

  show: (
    workspaceId: string,
    hash: string,
    repo?: string
  ): ReturnType<typeof http.get<GitShowResponse>> =>
    http.get<GitShowResponse>(`/git/workspace/${workspaceId}/show`, {
      params: { hash, repo }
    })
};
