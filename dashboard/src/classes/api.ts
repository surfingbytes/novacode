// node_modules
import axios, { isAxiosError } from 'axios';
import { getActivePinia } from 'pinia';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';

// types
import type {
  Workspace,
  AppSettings,
  McpClientServer,
  McpConnectivityCheckResult,
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  Session,
  Orchestrator,
  RoleTemplate,
  WorkspaceRuleFileSummary,
  WorkspaceRuleFileContent,
  AgentType,
  Automation,
  AutomationRun
} from '@/@types/index';

// ---------------------------------- HTTP ----------------------------------
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || location.origin + '/api'
});

http.interceptors.request.use((requestConfig) => {
  const token: string | null = localStorage.getItem('token');
  if (token) {
    requestConfig.headers['Authorization'] = `Bearer ${token}`;
  }
  return requestConfig;
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

http.interceptors.response.use(
  (response) => {
    touchApiReachability(true);
    return response;
  },
  (error: unknown) => {
    if (isAxiosError(error) && error.response === undefined) {
      touchApiReachability(false);
    }
    return Promise.reject(error);
  }
);

// ---------------------------------- Auth ----------------------------------
export const authApi = {
  needsSetup: (): ReturnType<typeof http.get<{ needsSetup: boolean }>> =>
    http.get<{ needsSetup: boolean }>('/auth/needs-setup'),

  setup: (username: string, password: string): ReturnType<typeof http.post<{ token: string }>> =>
    http.post<{ token: string }>('/auth/setup', { username, password }),

  login: (username: string, password: string): ReturnType<typeof http.post<{ token: string }>> =>
    http.post<{ token: string }>('/auth/login', { username, password }),

  validate: (): ReturnType<typeof http.post<{ valid: boolean; username: string }>> =>
    http.post<{ valid: boolean; username: string }>('/auth/validate'),

  changePassword: (
    currentPassword: string,
    newPassword: string
  ): ReturnType<typeof http.put<{ ok: boolean }>> =>
    http.put<{ ok: boolean }>('/auth/change-password', {
      currentPassword,
      newPassword
    }),

  changeUsername: (newUsername: string): ReturnType<typeof http.put<{ token: string }>> =>
    http.put<{ token: string }>('/auth/change-username', { newUsername })
};

// ---------------------------------- Workspaces ----------------------------------
export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export const workspaceApi = {
  list: (): ReturnType<typeof http.get<Workspace[]>> => http.get<Workspace[]>('/workspaces'),

  browse: (path: string): ReturnType<typeof http.get<{ path: string; entries: BrowseEntry[] }>> =>
    http.get<{ path: string; entries: BrowseEntry[] }>('/workspaces/browse', {
      params: { path: path || undefined }
    }),

  createFolder: (
    parentPath: string,
    name: string
  ): ReturnType<typeof http.post<{ path: string }>> =>
    http.post<{ path: string }>('/workspaces/browse/mkdir', {
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

  remove: (id: string): ReturnType<typeof http.delete> => http.delete(`/workspaces/${id}`)
};

// ---------------------------------- Settings ----------------------------------
export interface CursorModelOption {
  id: string;
  label: string;
}

interface McpClientsResponse {
  servers: Record<string, McpClientServer>;
}

interface McpClientsCheckResponse {
  results: Record<string, McpConnectivityCheckResult>;
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

  getAgentCapabilities: (): ReturnType<
    typeof http.get<{
      cursorAvailable: boolean;
      claudeAvailable: boolean;
      mistralVibeAvailable: boolean;
      openCodeAvailable: boolean;
      codexAvailable: boolean;
    }>
  > =>
    http.get<{
      cursorAvailable: boolean;
      claudeAvailable: boolean;
      mistralVibeAvailable: boolean;
      openCodeAvailable: boolean;
      codexAvailable: boolean;
    }>('/settings/agent-capabilities'),

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
  }): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/push/subscribe', subscription),

  unsubscribe: (endpoint: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/push/unsubscribe', { endpoint })
};

// ---------------------------------- Agent Auth (Cursor, Claude & OpenCode) ----------------------------------
export const agentAuthApi = {
  cursorStatus: (): ReturnType<typeof http.get<{ authenticated: boolean }>> =>
    http.get<{ authenticated: boolean }>('/agent-auth/cursor/status'),
  cursorLogin: (): ReturnType<typeof http.post<{ sessionId: string }>> =>
    http.post<{ sessionId: string }>('/agent-auth/cursor/login'),
  cursorLogout: (): ReturnType<typeof http.delete> => http.delete('/agent-auth/cursor/logout'),

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
export interface GitFile {
  status: string;
  file: string;
  repo: string;
}

export interface GitRepoStatus {
  repo: string;
  aheadCount: number;
  files: GitFile[];
}

export const gitApi = {
  status: (
    workspaceId: string
  ): ReturnType<
    typeof http.get<{ files: GitFile[]; aheadCount: number; repos: GitRepoStatus[] }>
  > =>
    http.get<{ files: GitFile[]; aheadCount: number; repos: GitRepoStatus[] }>(
      `/git/workspace/${workspaceId}/status`
    ),
  diff: (
    workspaceId: string,
    file: string,
    status?: string,
    repo?: string
  ): ReturnType<typeof http.get<{ diff: string }>> =>
    http.get<{ diff: string }>(`/git/workspace/${workspaceId}/diff`, {
      params: { file, status, repo }
    }),
  commit: (
    workspaceId: string,
    message: string,
    files?: string[],
    repo?: string
  ): ReturnType<typeof http.post<{ hash: string; message: string }>> =>
    http.post<{ hash: string; message: string }>(`/git/workspace/${workspaceId}/commit`, {
      message,
      files,
      repo
    }),
  push: (workspaceId: string, repo?: string): ReturnType<typeof http.post<{ output: string }>> =>
    http.post<{ output: string }>(`/git/workspace/${workspaceId}/push`, undefined, {
      params: { repo }
    }),
  discard: (
    workspaceId: string,
    files: string[],
    repo?: string
  ): ReturnType<typeof http.post<{ discarded: number }>> =>
    http.post<{ discarded: number }>(`/git/workspace/${workspaceId}/discard`, {
      files,
      repo
    })
};

// ---------------------------------- Files (workspace-scoped) ----------------------------------
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export const filesApi = {
  list: (
    workspaceId: string,
    path?: string
  ): ReturnType<typeof http.get<{ path: string; entries: FileEntry[] }>> =>
    http.get<{ path: string; entries: FileEntry[] }>(`/workspaces/${workspaceId}/files/list`, {
      params: path ? { path } : undefined
    }),

  read: (
    workspaceId: string,
    path: string
  ): ReturnType<typeof http.get<{ content: string; path: string }>> =>
    http.get<{ content: string; path: string }>(`/workspaces/${workspaceId}/files/read`, {
      params: { path }
    }),

  write: (
    workspaceId: string,
    path: string,
    content: string
  ): ReturnType<typeof http.put<{ path: string }>> =>
    http.put<{ path: string }>(`/workspaces/${workspaceId}/files/write`, { path, content })
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

export const buildWsUrl = (sessionId: string): string => {
  const token: string = localStorage.getItem('token') ?? '';
  return `${wsBase()}/ws/session/${sessionId}?token=${encodeURIComponent(token)}`;
};

export const buildChatWsUrl = (sessionId: string): string => {
  const token: string = localStorage.getItem('token') ?? '';
  return `${wsBase()}/ws/chat/${sessionId}?token=${encodeURIComponent(token)}`;
};

export const buildWorkspaceSessionsWsUrl = (workspaceId: string): string => {
  const token: string = localStorage.getItem('token') ?? '';
  return `${wsBase()}/ws/workspaces/${workspaceId}/sessions?token=${encodeURIComponent(token)}`;
};

export const buildSessionsWsUrl = (): string => {
  const token: string = localStorage.getItem('token') ?? '';
  return `${wsBase()}/ws/sessions?token=${encodeURIComponent(token)}`;
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
    http.get<Session>(`/workspaces/${workspaceId}/sessions/${sessionId}`),

  create: (
    workspaceId: string,
    payload: {
      name: string;
      tags?: string[] | null;
      agentType?: AgentType;
    }
  ): ReturnType<typeof http.post<Session>> =>
    http.post<Session>(`/workspaces/${workspaceId}/sessions`, payload),

  update: (
    workspaceId: string,
    sessionId: string,
    patch: {
      name?: string;
      tags?: string[] | null;
      archived?: boolean;
    }
  ): ReturnType<typeof http.patch<Session>> =>
    http.patch<Session>(`/workspaces/${workspaceId}/sessions/${sessionId}`, patch),

  remove: (workspaceId: string, sessionId: string): ReturnType<typeof http.delete> =>
    http.delete(`/workspaces/${workspaceId}/sessions/${sessionId}`),

  bulkDelete: (
    workspaceId: string,
    ids: string[]
  ): ReturnType<typeof http.post<{ deleted: number }>> =>
    http.post<{ deleted: number }>(`/workspaces/${workspaceId}/sessions/bulk-delete`, { ids }),

  bulkArchive: (
    workspaceId: string,
    ids: string[],
    archived: boolean
  ): ReturnType<typeof http.post<{ updated: number }>> =>
    http.post<{ updated: number }>(`/workspaces/${workspaceId}/sessions/bulk-archive`, {
      ids,
      archived
    }),

  uploadImage: (
    sessionId: string,
    data: string,
    mimeType: string
  ): ReturnType<typeof http.post<{ path: string; filename: string }>> =>
    http.post<{ path: string; filename: string }>(`/sessions/${sessionId}/images`, {
      data,
      mimeType
    }),

  imageUrl: (sessionId: string, filename: string): string => {
    const base = (import.meta.env.VITE_API_URL ?? location.origin + '/api').replace(/\/$/, '');
    const token = localStorage.getItem('token') ?? '';
    return `${base}/sessions/${sessionId}/images/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
  }
};

// ---------------------------------- Orchestrator ----------------------------------
export const orchestratorApi = {
  list: (workspaceId: string): ReturnType<typeof http.get<Orchestrator[]>> =>
    http.get<Orchestrator[]>(`/workspaces/${workspaceId}/orchestrators`),

  get: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.get<Orchestrator>> =>
    http.get<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}`),

  create: (
    workspaceId: string,
    payload?: {
      name?: string;
      tags?: string | null;
      agentType?: AgentType;
    }
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators`, payload ?? {}),

  update: (
    workspaceId: string,
    orchestratorId: string,
    patch: {
      name?: string;
      tags?: string | null;
      subtasksJson?: string | null;
      archived?: boolean;
    }
  ): ReturnType<typeof http.patch<Orchestrator>> =>
    http.patch<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}`, patch),

  remove: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.delete> =>
    http.delete(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}`),

  decompose: (
    workspaceId: string,
    orchestratorId: string,
    body: { userMessage: string }
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(
      `/workspaces/${workspaceId}/orchestrators/${orchestratorId}/decompose`,
      body
    ),

  /** Decompose with SSE stream; calls onThinking(text) for each thinking chunk, resolves with orchestrator on done. */
  async decomposeStream(
    workspaceId: string,
    orchestratorId: string,
    body: { userMessage: string },
    opts: { onThinking: (text: string) => void }
  ): Promise<Orchestrator | null> {
    const baseURL = (import.meta.env.VITE_API_URL ?? location.origin + '/api').replace(/\/$/, '');
    const token = localStorage.getItem('token');
    const response = await fetch(
      `${baseURL}/workspaces/${workspaceId}/orchestrators/${orchestratorId}/decompose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      }
    );
    if (!response.ok || !response.body) {
      return null;
    }
    const reader = response.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    let orchestrator: Orchestrator | null = null;
    let errorMsg: string | null = null;
    let lastAssistantContent: string | undefined;
    let expectedSchema: string | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6)) as {
              type: string;
              text?: string;
              orchestrator?: Orchestrator;
              error?: string;
              lastAssistantContent?: string;
              expectedSchema?: string;
            };
            if (data.type === 'thinking' && typeof data.text === 'string') {
              opts.onThinking(data.text);
            } else if (data.type === 'done' && data.orchestrator) {
              orchestrator = data.orchestrator as Orchestrator;
            } else if (data.type === 'error') {
              errorMsg = data.error ?? 'Decomposition failed';
              if (data.lastAssistantContent !== undefined) {
                lastAssistantContent = data.lastAssistantContent;
              }
              if (data.expectedSchema !== undefined) {
                expectedSchema = data.expectedSchema;
              }
            }
          } catch {
            // skip malformed
          }
        }
      }
    }
    if (errorMsg) {
      const error = new Error(errorMsg) as Error & {
        lastAssistantContent?: string;
        expectedSchema?: string;
      };
      error.lastAssistantContent = lastAssistantContent;
      error.expectedSchema = expectedSchema;
      throw error;
    }
    return orchestrator;
  },

  run: (
    workspaceId: string,
    orchestratorId: string,
    body?: { startIndex?: number }
  ): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(
      `/workspaces/${workspaceId}/orchestrators/${orchestratorId}/run`,
      body ?? {}
    ),

  stop: (workspaceId: string, orchestratorId: string): ReturnType<typeof http.post<Orchestrator>> =>
    http.post<Orchestrator>(`/workspaces/${workspaceId}/orchestrators/${orchestratorId}/stop`)
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
