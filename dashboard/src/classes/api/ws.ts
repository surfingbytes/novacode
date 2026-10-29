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
