import { http } from './http';

// types
import type { CursorAuthStatus } from './settings';
import type { CursorUsageSummaryResponse } from '@/@types/index';

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
