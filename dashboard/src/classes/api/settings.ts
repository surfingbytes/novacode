import { http } from './http';

// types
import type {
  AgentConfigOption,
  AgentModeOption,
  AgentModelOption,
  AgentOptionsResponse,
  AgentType,
  AppSettings,
  McpAutoloadStatus,
  McpClientServer,
  McpConnectivityCheckResult,
  OpenCodeProvider,
  SaveOpenCodeProviderPayload
} from '@/@types/index';

// ---------------------------------- Settings ----------------------------------
export interface CursorModelOption {
  id: string;
  label: string;
}

export type AgentErrorCode = 'auth_required' | 'rate_limited' | 'timeout' | 'unknown';
export type CursorAuthStatus = 'authenticated' | 'unauthenticated' | 'timeout' | 'error';

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
  getSshPrivateKey: (): ReturnType<typeof http.get<{ sshPrivateKey: string }>> =>
    http.get<{ sshPrivateKey: string }>('/settings/ssh-private-key'),

  getCursorModels: (): ReturnType<
    typeof http.get<{ models: CursorModelOption[]; fromCache: boolean }>
  > => http.get<{ models: CursorModelOption[]; fromCache: boolean }>('/settings/cursor-models'),

  getOpenCodeModels: (): ReturnType<
    typeof http.get<{ models: { id: string; label: string }[]; fromCache: boolean }>
  > =>
    http.get<{ models: { id: string; label: string }[]; fromCache: boolean }>(
      '/settings/opencode-models'
    ),

  getOpenCodeProviders: (): ReturnType<typeof http.get<OpenCodeProvidersResponse>> =>
    http.get<OpenCodeProvidersResponse>('/settings/opencode-providers'),

  saveOpenCodeProvider: (
    provider: SaveOpenCodeProviderPayload
  ): ReturnType<typeof http.put<OpenCodeProvider>> =>
    http.put<OpenCodeProvider>(
      `/settings/opencode-providers/${encodeURIComponent(provider.id)}`,
      provider
    ),

  deleteOpenCodeProvider: (providerId: string): ReturnType<typeof http.delete> =>
    http.delete(`/settings/opencode-providers/${encodeURIComponent(providerId)}`),

  getAgentModels: (
    agentType: AgentType
  ): ReturnType<typeof http.get<{ models: AgentModelOption[]; fromCache: boolean }>> =>
    http.get<{ models: AgentModelOption[]; fromCache: boolean }>(
      `/settings/agent-models/${agentType}`
    ),

  getAgentModes: (
    agentType: AgentType
  ): ReturnType<typeof http.get<{ modes: AgentModeOption[]; fromCache: boolean }>> =>
    http.get<{ modes: AgentModeOption[]; fromCache: boolean }>(
      `/settings/agent-modes/${agentType}`
    ),

  getAgentConfigOptions: (
    agentType: AgentType
  ): ReturnType<typeof http.get<{ options: AgentConfigOption[]; fromCache: boolean }>> =>
    http.get<{ options: AgentConfigOption[]; fromCache: boolean }>(
      `/settings/agent-config/${agentType}`
    ),

  getAgentOptions: (agentType: AgentType): ReturnType<typeof http.get<AgentOptionsResponse>> =>
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
