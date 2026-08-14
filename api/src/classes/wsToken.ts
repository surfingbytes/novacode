import { readSessionCookie } from './sessionCookie';

/**
 * Extract the JWT from a WebSocket upgrade request.
 * Prefer `bearer.<token>` Sec-WebSocket-Protocol (API keys / leftover JWTs)
 * so the token never appears in URLs. Dashboard sessions use the httpOnly cookie.
 */
export function extractWsToken(request: {
  headers?: Record<string, unknown>;
}): string | null {
  const protocol = request.headers?.['sec-websocket-protocol'];
  if (typeof protocol === 'string') {
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
  }
  const cookie = request.headers?.cookie;
  return readSessionCookie(typeof cookie === 'string' ? cookie : undefined);
}
