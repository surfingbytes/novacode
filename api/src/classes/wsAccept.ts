// node_modules
import type { WebSocket } from 'ws';

// classes
import { rejectUnauthorizedWebSocket } from './auth';
import { isAllowedWsOrigin, WS_CLOSE_ORIGIN_NOT_ALLOWED } from './wsOrigin';

const PING_FRAME = '{"type":"ping"}';
const PONG_FRAME = '{"type":"pong"}';

/** Answer the dashboard's app-level ping so its liveness check sees a frame on idle sockets. */
function answerPings(socket: WebSocket): void {
  socket.on('message', (raw: Buffer) => {
    if (raw.length === PING_FRAME.length && raw.toString() === PING_FRAME && socket.readyState === socket.OPEN) {
      socket.send(PONG_FRAME);
    }
  });
}

/**
 * Gate every WebSocket route: origin check (4003), then auth (4001).
 * Returns true only when the socket is accepted and still open, so callers
 * can safely register it for broadcasts afterwards.
 */
export async function acceptWebSocket(
  socket: WebSocket,
  request: { headers?: Record<string, unknown> }
): Promise<boolean> {
  if (!isAllowedWsOrigin(request)) {
    socket.close(WS_CLOSE_ORIGIN_NOT_ALLOWED, 'Origin not allowed');
    return false;
  }
  if (await rejectUnauthorizedWebSocket(socket, request)) {
    return false;
  }
  if (socket.readyState !== socket.OPEN) {
    return false;
  }
  answerPings(socket);
  return true;
}
