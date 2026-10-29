/**
 * Managed WebSocket client — single implementation for the whole dashboard
 * (previously three divergent inline versions with fixed 2s reconnects and
 * no keepalive).
 *
 * Features:
 *  - Auth via the httpOnly session cookie on the upgrade request (token stays
 *    out of URLs, subprotocols and server access logs).
 *  - Exponential reconnect backoff (1s → 30s) with jitter.
 *  - Reconnect on window `online` and tab `visibilitychange`.
 *  - App-level ping every 30s to keep the connection warm through proxies;
 *    the server answers with a pong, and a socket that receives no frame for
 *    two ping intervals is treated as dead and replaced.
 *  - Close code 4001 (auth) → no reconnect, surfaced via onUnauthorized;
 *    `reset()` re-arms the client after the user signs in again.
 */

export interface ManagedSocketOptions {
  /** ws(s):// URL without credentials */
  url: string;
  onMessage: (data: string) => void;
  onOpen?: () => void;
  /** Called whenever the underlying socket (re)connects or drops */
  onConnectionChange?: (bConnected: boolean) => void;
  /** Called once when the server rejects auth (close code 4001) */
  onUnauthorized?: () => void;
  /** Return false to suppress reconnects (e.g. tab switched away) */
  shouldBeConnected?: () => boolean;
}

export interface ManagedSocket {
  send: (payload: unknown) => void;
  /** Open the socket if it should be connected and is not already open/opening. */
  connect: () => void;
  /** Re-arm after a 4001/4004 or `close()` (e.g. after re-login); call `connect()` afterwards. */
  reset: () => void;
  close: () => void;
  readonly bConnected: boolean;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
export const PING_INTERVAL_MS = 30000;
/** No frame (pong or data) for this long → the connection is considered dead. */
const LIVENESS_TIMEOUT_MS = PING_INTERVAL_MS * 2;
const PONG_FRAME = '{"type":"pong"}';
/** Synthetic close code used when the liveness check drops a silent socket. */
const LIVENESS_CLOSE_CODE = 4000;

export function createManagedSocket(options: ManagedSocketOptions): ManagedSocket {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let bClosedByUser = false;
  let bConnected = false;
  let bListening = false;
  let lastFrameAt = 0;

  const setConnected = (value: boolean): void => {
    if (bConnected === value) {
      return;
    }
    bConnected = value;
    options.onConnectionChange?.(value);
  };

  const clearPingTimer = (): void => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const clearTimers = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearPingTimer();
  };

  const shouldBeConnected = (): boolean => {
    if (bClosedByUser) {
      return false;
    }
    return options.shouldBeConnected?.() ?? true;
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null || !shouldBeConnected()) {
      return;
    }
    // ±25% jitter avoids thundering-herd reconnects after a server restart.
    const jitter = backoffMs * (0.75 + Math.random() * 0.5);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, jitter);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  };

  /** Shared by real close events and the liveness check (which can't wait for a dead socket's close handshake). */
  const handleClose = (code: number): void => {
    socket = null;
    setConnected(false);
    clearPingTimer();
    if (code === 4001) {
      bClosedByUser = true;
      options.onUnauthorized?.();
      return;
    }
    if (code === 4004) {
      // Resource gone (e.g. session deleted) — no point reconnecting.
      bClosedByUser = true;
      return;
    }
    scheduleReconnect();
  };

  const connect = (): void => {
    if (!shouldBeConnected()) {
      return;
    }
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.CLOSING)
    ) {
      // CLOSING: its onclose schedules the reconnect; opening now would race it.
      return;
    }
    // Auth rides on the httpOnly session cookie sent with the upgrade request.
    const thisSocket = new WebSocket(options.url);
    socket = thisSocket;

    thisSocket.onopen = () => {
      if (socket !== thisSocket) return;
      backoffMs = INITIAL_BACKOFF_MS;
      lastFrameAt = Date.now();
      setConnected(true);
      options.onOpen?.();
      clearPingTimer();
      pingTimer = setInterval(() => {
        if (socket !== thisSocket || thisSocket.readyState !== WebSocket.OPEN) {
          return;
        }
        if (Date.now() - lastFrameAt >= LIVENESS_TIMEOUT_MS) {
          // Half-open connection (sleep, network switch): drop it now and
          // reconnect instead of waiting for a close that may never come.
          handleClose(LIVENESS_CLOSE_CODE);
          thisSocket.close();
          return;
        }
        // Keeps the connection alive through idle-dropping proxies and
        // elicits a pong that proves the server is still there.
        thisSocket.send(JSON.stringify({ type: 'ping' }));
      }, PING_INTERVAL_MS);
    };

    thisSocket.onmessage = (event: MessageEvent) => {
      if (socket !== thisSocket) return;
      lastFrameAt = Date.now();
      if (typeof event.data === 'string' && event.data !== PONG_FRAME) {
        options.onMessage(event.data);
      }
    };

    thisSocket.onclose = (event: CloseEvent) => {
      if (socket !== thisSocket) return;
      handleClose(event.code);
    };

    thisSocket.onerror = () => {
      // onclose follows and handles reconnect.
    };
  };

  const handleOnline = (): void => {
    backoffMs = INITIAL_BACKOFF_MS;
    connect();
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      backoffMs = INITIAL_BACKOFF_MS;
      connect();
    }
  };

  const startListening = (): void => {
    if (bListening) return;
    bListening = true;
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  };

  const stopListening = (): void => {
    if (!bListening) return;
    bListening = false;
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };

  startListening();
  connect();

  return {
    send: (payload: unknown): void => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
      }
    },
    connect,
    reset: (): void => {
      bClosedByUser = false;
      backoffMs = INITIAL_BACKOFF_MS;
      startListening();
    },
    close: (): void => {
      bClosedByUser = true;
      clearTimers();
      stopListening();
      const current = socket;
      socket = null;
      current?.close();
      setConnected(false);
    },
    get bConnected() {
      return bConnected;
    }
  };
}
