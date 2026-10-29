// node_modules
import axios, { isAxiosError } from 'axios';
import { getActivePinia } from 'pinia';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';
import { useToastStore } from '@/stores/toasts';

// types
import type {
  Workspace,
  AppSettings,
  McpClientServer,
  McpConnectivityCheckResult,
  McpAutoloadStatus,
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  Session,
  SessionSpecStatus,
  Orchestrator,
  OrchestratorRunMode,
  OrchestratorSummary,
  RoleTemplate,
  WorkspaceRuleFileSummary,
  WorkspaceRuleFileContent,
  AgentType,
  ApprovalPolicy,
  Automation,
  AutomationRun,
  AgentModelOption,
  AgentModeOption,
  AgentOptionsResponse,
  AgentConfigOption,
  OpenCodeProvider,
  SaveOpenCodeProviderPayload,
  ApiToken,
  CreatedApiToken,
  SessionUsageTurn,
  SessionUsageSummary,
  WorkspaceUsageSummary,
  CursorUsageSummaryResponse,
  ForgeConnectionStatus,
  ForgeConnectionsResponse,
  ForgeConnectionTestResult,
  ForgeProvider,
  SaveForgeConnectionPayload,
  ForgeRepoDetectResponse,
  CiStatusResponse,
  CiFixPromptResponse
} from '@/@types/index';
import type {
  CreateSessionBody,
  FileListResponse,
  FilePathResponse,
  FileReadResponse,
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
  GitStatusResponse,
  PlanUpdateBody,
  PlanUpdateResponse,
  SearchResponse,
  SessionBulkArchiveResponse,
  SessionBulkDeleteResponse,
  UpdateSessionBody,
  WorkspaceBrowseResponse,
  WorkspaceMkdirResponse
} from '@novacode/shared';

// ---------------------------------- HTTP ----------------------------------
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || location.origin + '/api',
  withCredentials: true
});

function touchApiReachability(ok: boolean): void {
  const pinia = getActivePinia();
  if (!pinia) return;
  const health = useApiHealthStore(pinia);
  if (ok) {
    health.markReachable();
  } else {
    health.markUnreachable();
  }
}

/** Proxy/gateway failures and dropped connections — not application 4xx/500. */
const GATEWAY_UNREACHABLE_STATUSES = new Set([502, 503, 504]);

export function isApiUnreachableError(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false;
  }
  // Navigation/unmount aborts are not an outage.
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
    return false;
  }
  if (error.response === undefined) {
    return true;
  }
  return GATEWAY_UNREACHABLE_STATUSES.has(error.response.status);
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Retry a non-GET request after a dropped connection (only for side-effect-free calls). */
    retryOnNetworkError?: boolean;
    /** Internal: retries already spent on dropped connections. */
    networkRetryCount?: number;
  }
}

/** Backoff for requests whose connection dropped before any response (browser/proxy blips). */
const NETWORK_RETRY_DELAYS_MS = [400, 1500];

/** Dropped connection with no response — not a timeout, cancel, or HTTP error status. */
function isDroppedConnectionError(error: unknown): boolean {
  if (!isAxiosError(error) || error.response !== undefined) {
    return false;
  }
  if (error.code === 'ERR_CANCELED' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return false;
  }
  return true;
}

export function networkRetryDelayMs(error: unknown): number | null {
  if (!isDroppedConnectionError(error) || !isAxiosError(error) || !error.config) {
    return null;
  }
  const method = (error.config.method ?? 'get').toLowerCase();
  const retryable = method === 'get' || method === 'head' || error.config.retryOnNetworkError === true;
  if (!retryable) {
    return null;
  }
  return NETWORK_RETRY_DELAYS_MS[error.config.networkRetryCount ?? 0] ?? null;
}

/** Confirm outages via /health so one slow request does not flash the banner. */
let unreachableConfirmInFlight = false;

function confirmApiUnreachable(): void {
  const pinia = getActivePinia();
  if (!pinia || unreachableConfirmInFlight) {
    return;
  }
  unreachableConfirmInFlight = true;
  void useApiHealthStore(pinia)
    .ping()
    .finally(() => {
      unreachableConfirmInFlight = false;
    });
}

/**
 * Called when any non-auth endpoint answers 401 (expired/invalid token
 * mid-session). Registered by App.vue to log out and redirect to /login —
 * kept injectable to avoid a classes/api ⇄ stores/auth import cycle.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Auth-flow endpoints are allowed to 401 without triggering a global logout. */
function isAuthFlowUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return url.includes('/auth/login') || url.includes('/auth/setup') || url.includes('/auth/validate') || url.includes('/auth/logout') || url.includes('/auth/login-options') || url.includes('/auth/needs-setup') || url.includes('/auth/oidc/');
}

/**
 * Toast text for responses every caller should surface: 403 and 5xx. Gateway
 * failures (502/503/504) are left to the unreachable banner. Returns null when
 * the error needs no global toast.
 */
export function apiErrorToastMessage(error: unknown): string | null {
  if (!isAxiosError(error) || !error.response || isApiUnreachableError(error)) {
    return null;
  }
  const status = error.response.status;
  if (status !== 403 && status < 500) {
    return null;
  }
  const base = status === 403 ? 'Forbidden' : `Server error (${status})`;
  const body: unknown = error.response.data;
  const detail = body && typeof body === 'object' && 'error' in body ? (body).error : undefined;
  return typeof detail === 'string' && detail ? `${base}: ${detail}` : base;
}

/** True when the response interceptor already toasted this error — callers skip their own toast. */
export function isGloballyToasted(error: unknown): boolean {
  return apiErrorToastMessage(error) !== null;
}

function toastApiError(error: unknown): void {
  const message = apiErrorToastMessage(error);
  // Store resolved lazily via the active Pinia — requests can fire before the app mounts.
  const pinia = getActivePinia();
  if (message && pinia) {
    useToastStore(pinia).error(message);
  }
}

http.interceptors.response.use(
  (response) => {
    touchApiReachability(true);
    return response;
  },
  async (error: unknown) => {
    if (isAxiosError(error)) {
      // A dropped connection on an idempotent call is usually a momentary blip:
      // retry quietly before surfacing "Could not reach the server".
      const retryDelayMs = networkRetryDelayMs(error);
      if (retryDelayMs !== null && error.config) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return http.request({
          ...error.config,
          networkRetryCount: (error.config.networkRetryCount ?? 0) + 1
        });
      }
      if (isApiUnreachableError(error)) {
        // Do not flip the banner from a single timed-out call — confirm with /health.
        confirmApiUnreachable();
      } else if (error.response?.status === 401 && !isAuthFlowUrl(error.config?.url)) {
        onUnauthorized?.();
      } else {
        toastApiError(error);
      }
    }
    // Async handler: throwing rejects with the original error, whatever axios handed us.
    throw error;
  }
);

// ---------------------------------- Auth ----------------------------------
export type AuthLoginOptions = {
  needsSetup: boolean;
  localLogin: boolean;
  oidcEnabled: boolean;
  oidcDisplayName: string;
};

export const authApi = {
  needsSetup: (): ReturnType<typeof http.get<{ needsSetup: boolean }>> =>
    http.get<{ needsSetup: boolean }>('/auth/needs-setup'),

  loginOptions: (): ReturnType<typeof http.get<AuthLoginOptions>> =>
    http.get<AuthLoginOptions>('/auth/login-options'),

  setup: (username: string, password: string): ReturnType<typeof http.post<{ token: string }>> =>
    http.post<{ token: string }>('/auth/setup', { username, password }),

  login: (username: string, password: string): ReturnType<typeof http.post<{ token: string }>> =>
    http.post<{ token: string }>('/auth/login', { username, password }),

  validate: (): ReturnType<typeof http.post<{ valid: boolean; username: string }>> =>
    http.post<{ valid: boolean; username: string }>('/auth/validate', undefined, {
      // Bound the wait — a timeout is treated as "stay logged in" by the caller.
      timeout: 10000
    }),

  logout: (): ReturnType<typeof http.post<void>> => http.post('/auth/logout'),

  changePassword: (
    currentPassword: string,
    newPassword: string
  ): ReturnType<typeof http.put<{ ok: boolean }>> =>
    http.put<{ ok: boolean }>('/auth/change-password', {
      currentPassword,
      newPassword
    }),

  changeUsername: (newUsername: string): ReturnType<typeof http.put<{ token: string }>> =>
    http.put<{ token: string }>('/auth/change-username', { newUsername }),

  listApiTokens: (): ReturnType<typeof http.get<ApiToken[]>> => http.get<ApiToken[]>('/auth/api-tokens'),

  createApiToken: (name: string): ReturnType<typeof http.post<CreatedApiToken>> =>
    http.post<CreatedApiToken>('/auth/api-tokens', { name }),

  deleteApiToken: (id: string): ReturnType<typeof http.delete> => http.delete(`/auth/api-tokens/${id}`)
};

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

// ---------------------------------- Settings ----------------------------------
export interface CursorModelOption {
  id: string;
  label: string;
}

export type AgentErrorCode = 'auth_required' | 'rate_limited' | 'timeout' | 'unknown';
export type CursorAuthStatus = 'authenticated' | 'unauthenticated' | 'timeout' | 'error';

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const data = error.response?.data;
  if (!data || typeof data !== 'object') return fallback;
  const record = data as Record<string, unknown>;
  for (const key of ['message', 'details', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

/** Nova's own MCP server (spec + orchestrator tools for chat agents). */
export interface McpBuiltinStatus {
  nova: { enabled: boolean };
}

interface McpClientsResponse {
  servers: Record<string, McpClientServer>;
  autoload: McpAutoloadStatus;
  builtin: McpBuiltinStatus;
}

interface McpClientsCheckResponse {
  results: Record<string, McpConnectivityCheckResult>;
}

interface OpenCodeProvidersResponse {
  providers: OpenCodeProvider[];
}

interface AgentRuntimeSettings {
  /** Effective idle timeout (ms) — env var beats the saved value when set. */
  promptIdleTimeoutMs: number;
  defaultPromptIdleTimeoutMs: number;
  envOverride: boolean;
}

export const settingsApi = {
  get: (): ReturnType<typeof http.get<AppSettings>> => http.get<AppSettings>('/settings'),
  update: (payload: Partial<AppSettings>): ReturnType<typeof http.put<AppSettings>> =>
    http.put<AppSettings>('/settings', payload),

  getCursorModels: (): ReturnType<
    typeof http.get<{ models: CursorModelOption[]; fromCache: boolean }>
  > => http.get<{ models: CursorModelOption[]; fromCache: boolean }>('/settings/cursor-models'),

  getOpenCodeModels: (): ReturnType<typeof http.get<{ models: { id: string; label: string }[]; fromCache: boolean }>> =>
    http.get<{ models: { id: string; label: string }[]; fromCache: boolean }>('/settings/opencode-models'),

  getOpenCodeProviders: (): ReturnType<typeof http.get<OpenCodeProvidersResponse>> =>
    http.get<OpenCodeProvidersResponse>('/settings/opencode-providers'),

  saveOpenCodeProvider: (
    provider: SaveOpenCodeProviderPayload
  ): ReturnType<typeof http.put<OpenCodeProvider>> =>
    http.put<OpenCodeProvider>(`/settings/opencode-providers/${encodeURIComponent(provider.id)}`, provider),

  deleteOpenCodeProvider: (providerId: string): ReturnType<typeof http.delete> =>
    http.delete(`/settings/opencode-providers/${encodeURIComponent(providerId)}`),

  getAgentModels: (
    agentType: AgentType
  ): ReturnType<typeof http.get<{ models: AgentModelOption[]; fromCache: boolean }>> =>
    http.get<{ models: AgentModelOption[]; fromCache: boolean }>(`/settings/agent-models/${agentType}`),

  getAgentModes: (
    agentType: AgentType
  ): ReturnType<typeof http.get<{ modes: AgentModeOption[]; fromCache: boolean }>> =>
    http.get<{ modes: AgentModeOption[]; fromCache: boolean }>(`/settings/agent-modes/${agentType}`),

  getAgentConfigOptions: (
    agentType: AgentType
  ): ReturnType<typeof http.get<{ options: AgentConfigOption[]; fromCache: boolean }>> =>
    http.get<{ options: AgentConfigOption[]; fromCache: boolean }>(`/settings/agent-config/${agentType}`),

  getAgentOptions: (
    agentType: AgentType
  ): ReturnType<typeof http.get<AgentOptionsResponse>> =>
    http.get<AgentOptionsResponse>(`/settings/agent-options/${agentType}`),

  getAgentCapabilities: (): ReturnType<
    typeof http.get<{
      cursorAvailable: boolean;
      cursorStatus?: CursorAuthStatus;
      cursorStatusMessage?: string;
      claudeAvailable: boolean;
      mistralVibeAvailable: boolean;
      openCodeAvailable: boolean;
      codexAvailable: boolean;
    }>
  > =>
    http.get<{
      cursorAvailable: boolean;
      cursorStatus?: CursorAuthStatus;
      cursorStatusMessage?: string;
      claudeAvailable: boolean;
      mistralVibeAvailable: boolean;
      openCodeAvailable: boolean;
      codexAvailable: boolean;
    }>('/settings/agent-capabilities'),

  getAgentRuntime: (): ReturnType<typeof http.get<AgentRuntimeSettings>> =>
    http.get<AgentRuntimeSettings>('/settings/agent-runtime'),

  updateAgentRuntime: (
    payload: Pick<AgentRuntimeSettings, 'promptIdleTimeoutMs'>
  ): ReturnType<typeof http.put<AgentRuntimeSettings>> =>
    http.put<AgentRuntimeSettings>('/settings/agent-runtime', payload),

  getVibeApiKeyStatus: (): ReturnType<typeof http.get<{ configured: boolean }>> =>
    http.get<{ configured: boolean }>('/settings/vibe-api-key'),

  setVibeApiKey: (apiKey: string): ReturnType<typeof http.put<{ configured: boolean }>> =>
    http.put<{ configured: boolean }>('/settings/vibe-api-key', { apiKey }),

  clearVibeApiKey: (): ReturnType<typeof http.delete<{ configured: boolean }>> =>
    http.delete<{ configured: boolean }>('/settings/vibe-api-key'),

  getMcpClients: (): ReturnType<typeof http.get<McpClientsResponse>> =>
    http.get<McpClientsResponse>('/settings/mcp-clients'),

  saveMcpClients: (
    servers: Record<string, McpClientServer>
  ): ReturnType<typeof http.put<McpClientsResponse>> =>
    http.put<McpClientsResponse>('/settings/mcp-clients', { servers }),

  saveMcpBuiltin: (builtin: McpBuiltinStatus): ReturnType<typeof http.put<McpBuiltinStatus>> =>
    http.put<McpBuiltinStatus>('/settings/mcp-builtin', builtin),

  /** Dry-run: stdio spawn probe + HTTP GET; optional body validates unsaved servers */
  checkMcpClients: (
    servers?: Record<string, McpClientServer>
  ): ReturnType<typeof http.post<McpClientsCheckResponse>> =>
    http.post<McpClientsCheckResponse>('/settings/mcp-clients/check', servers ? { servers } : {})
};

// ---------------------------------- Push notifications ----------------------------------
export const pushApi = {
  getPublicKey: (): ReturnType<typeof http.get<{ enabled: boolean; publicKey: string | null }>> =>
    http.get<{ enabled: boolean; publicKey: string | null }>('/push/public-key'),

  subscribe: (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    notifyTasks?: boolean;
    notifyCi?: boolean;
  }): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/push/subscribe', subscription),

  unsubscribe: (endpoint: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/push/unsubscribe', { endpoint })
};

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

// ---------------------------------- Agent Auth (Cursor, Claude & OpenCode) ----------------------------------
export const agentAuthApi = {
  cursorStatus: (): ReturnType<
    typeof http.get<{ authenticated: boolean; status: CursorAuthStatus; message?: string }>
  > =>
    http.get<{ authenticated: boolean; status: CursorAuthStatus; message?: string }>(
      '/agent-auth/cursor/status'
    ),
  cursorLogin: (): ReturnType<typeof http.post<{ sessionId: string }>> =>
    http.post<{ sessionId: string }>('/agent-auth/cursor/login'),
  cursorLogout: (): ReturnType<typeof http.delete> => http.delete('/agent-auth/cursor/logout'),

  cursorUsage: (): ReturnType<typeof http.get<CursorUsageSummaryResponse>> =>
    http.get<CursorUsageSummaryResponse>('/agent-auth/cursor/usage'),

  claudeStatus: (): ReturnType<typeof http.get<{ authenticated: boolean }>> =>
    http.get<{ authenticated: boolean }>('/agent-auth/claude/status'),
  claudeLogin: (): ReturnType<typeof http.post<{ sessionId: string }>> =>
    http.post<{ sessionId: string }>('/agent-auth/claude/login'),
  claudeLogout: (): ReturnType<typeof http.delete> => http.delete('/agent-auth/claude/logout'),
  claudeSaveToken: (token: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/agent-auth/claude/token', { token }),

  openCodeStatus: (): ReturnType<typeof http.get<{ authenticated: boolean }>> =>
    http.get<{ authenticated: boolean }>('/agent-auth/opencode/status'),
  openCodeLogin: (apiKey: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/agent-auth/opencode/login', { apiKey }),
  openCodeLogout: (): ReturnType<typeof http.delete> => http.delete('/agent-auth/opencode/logout'),

  codexStatus: (): ReturnType<typeof http.get<{ authenticated: boolean }>> =>
    http.get<{ authenticated: boolean }>('/agent-auth/codex/status'),
  codexLogin: (apiKey: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/agent-auth/codex/login', { apiKey }),
  codexLogout: (): ReturnType<typeof http.delete> => http.delete('/agent-auth/codex/logout')
};

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

  read: (
    workspaceId: string,
    path: string
  ): ReturnType<typeof http.get<FileReadResponse>> =>
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

// ---------------------------------- WebSocket ----------------------------------
// API WebSocket routes live at /api/ws/...; ensure base includes /api so WS connects to the right path.
function wsBase(): string {
  const base = (import.meta.env.VITE_API_URL ?? location.origin + '/api')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const pathPrefix = base.endsWith('/api') ? '' : '/api';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${base}${pathPrefix}`;
}

// Auth is bearer.<jwt> Sec-WebSocket-Protocol (see lib/wsClient) — never put
// the token in the URL.
export const buildWsUrl = (sessionId: string): string => {
  return `${wsBase()}/ws/session/${sessionId}`;
};

export const buildChatWsUrl = (sessionId: string): string => {
  return `${wsBase()}/ws/chat/${sessionId}`;
};

export const buildSessionTerminalWsUrl = (workspaceId: string, sessionId: string): string => {
  return `${wsBase()}/ws/workspaces/${workspaceId}/sessions/${sessionId}/terminal`;
};

export const buildSessionsWsUrl = (): string => {
  return `${wsBase()}/ws/sessions`;
};

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
  ): ReturnType<typeof http.patch<{ id: string; sessionId: string; title: string; markdown: string }>> =>
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
    http.post<PlanUpdateResponse>(`/workspaces/${workspaceId}/sessions/${sessionId}/plan-update`, payload),

  bulkDelete: (
    workspaceId: string,
    ids: string[]
  ): ReturnType<typeof http.post<SessionBulkDeleteResponse>> =>
    http.post<SessionBulkDeleteResponse>(`/workspaces/${workspaceId}/sessions/bulk-delete`, { ids }),

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
  create: (workspaceId: string, sessionId: string): ReturnType<typeof http.post<SessionSpecResponse>> =>
    http.post<SessionSpecResponse>(`/workspaces/${workspaceId}/sessions/${sessionId}/spec`)
};

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

  list:(workspaceId: string): ReturnType<typeof http.get<Orchestrator[]>> =>
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
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}/planner`, payload ?? {}),

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
  markRead: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}/read`),

  run: (
    workspaceId: string,
    orchestratorId: string,
    body?: { mode?: OrchestratorRunMode; startIndex?: number; onlyIndex?: number; next?: boolean; fresh?: boolean }
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

// ---------------------------------- Search ----------------------------------
export const searchApi = {
  query: async (query: string, signal?: AbortSignal): Promise<SearchResponse> => {
    const response = await http.get<SearchResponse>('/search', { params: { query }, signal });
    return response.data;
  }
};

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

  update: (
    filename: string,
    content: string
  ): ReturnType<typeof http.put<{ filename: string }>> =>
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
