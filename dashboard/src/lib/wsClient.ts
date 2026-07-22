/**
 * Managed WebSocket client — single implementation for the whole dashboard
 * (previously three divergent inline versions with fixed 2s reconnects and
 * no keepalive).
 *
 * Features:
 *  - Auth via `bearer.<jwt>` Sec-WebSocket-Protocol (token stays out of URLs
 *    and server access logs); `?token=` remains as server-side fallback.
 *  - Exponential reconnect backoff (1s → 30s) with jitter.
 *  - Reconnect on window `online` and tab `visibilitychange`.
 *  - App-level ping every 30s to keep the connection warm through proxies.
 *  - Close code 4001 (auth) → no reconnect, surfaced via onUnauthorized.
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
  close: () => void;
  readonly bConnected: boolean;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const PING_INTERVAL_MS = 30000;

export function createManagedSocket(options: ManagedSocketOptions): ManagedSocket {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let bClosedByUser = false;
  let bConnected = false;

  const setConnected = (value: boolean): void => {
    if (bConnected === value) {
      return;
    }
    bConnected = value;
    options.onConnectionChange?.(value);
  };

  const clearTimers = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
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

  const connect = (): void => {
    if (!shouldBeConnected()) {
      return;
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = localStorage.getItem('token') ?? '';
    socket = new WebSocket(options.url, token ? [`bearer.${token}`] : undefined);

    socket.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS;
      setConnected(true);
      options.onOpen?.();
      if (pingTimer !== null) {
        clearInterval(pingTimer);
      }
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          // Keeps the connection alive through idle-dropping proxies; the
          // server safely ignores unknown frame types.
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        options.onMessage(event.data);
      }
    };

    socket.onclose = (event: CloseEvent) => {
      socket = null;
      setConnected(false);
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (event.code === 4001) {
        bClosedByUser = true;
        options.onUnauthorized?.();
        return;
      }
      if (event.code === 4004) {
        // Resource gone (e.g. session deleted) — no point reconnecting.
        bClosedByUser = true;
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
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

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  connect();

  return {
    send: (payload: unknown): void => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
      }
    },
    close: (): void => {
      bClosedByUser = true;
      clearTimers();
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket?.close();
      socket = null;
      setConnected(false);
    },
    get bConnected() {
      return bConnected;
    }
  };
}

