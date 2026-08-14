/**
 * Extract the JWT from a WebSocket upgrade request.
 * Auth is the `bearer.<token>` Sec-WebSocket-Protocol value so the token
 * never appears in URLs or access logs.
 */
export function extractWsToken(request: {
  headers?: Record<string, unknown>;
}): string | null {
  const protocol = request.headers?.['sec-websocket-protocol'];
  if (typeof protocol !== 'string') {
    return null;
  }
  for (const candidate of protocol.split(',')) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith('bearer.')) {
      continue;
    }
    const token = trimmed.slice('bearer.'.length);
    if (token) {
      return token;
    }
  }
  return null;
}
