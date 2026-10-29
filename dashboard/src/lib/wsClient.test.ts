// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagedSocket, PING_INTERVAL_MS, type ManagedSocket } from '@/lib/wsClient';
import { FakeWebSocket, liveFakeSockets as live } from '@/test/fakeWebSocket';

let client: ManagedSocket | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // Jitter = backoff × (0.75 + random × 0.5) → exactly the backoff.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  client?.close();
  client = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function create(overrides: Partial<Parameters<typeof createManagedSocket>[0]> = {}) {
  const onMessage = vi.fn();
  client = createManagedSocket({ url: 'ws://test/api/ws/sessions', onMessage, ...overrides });
  return { client, onMessage };
}

describe('createManagedSocket', () => {
  it('does not put a token in the subprotocol', () => {
    localStorage.setItem('token', 'legacy');
    create();
    expect(FakeWebSocket.instances[0]?.protocols).toBeUndefined();
    localStorage.removeItem('token');
  });

  it('reconnects with exponential backoff after unexpected closes', () => {
    create();
    FakeWebSocket.instances[0].serverClose(1006);

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].serverClose(1006);
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    // A successful open resets the backoff.
    FakeWebSocket.instances[2].serverOpen();
    FakeWebSocket.instances[2].serverClose(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('does not open a second socket while the previous one is CLOSING', () => {
    const { client } = create();
    const first = FakeWebSocket.instances[0];
    first.serverOpen();
    first.readyState = FakeWebSocket.CLOSING;

    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);

    first.serverClose(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(live()).toHaveLength(1);
  });

  it('ignores events from a replaced socket', () => {
    const onConnectionChange = vi.fn();
    const { onMessage } = create({ onConnectionChange });
    const first = FakeWebSocket.instances[0];
    first.serverOpen();

    // Liveness drop replaces the socket before its close handshake finishes.
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    vi.advanceTimersByTime(1000);
    const second = FakeWebSocket.instances[1];
    second.serverOpen();
    onConnectionChange.mockClear();

    first.serverMessage('{"type":"refresh"}');
    first.serverClose(1006);

    expect(onMessage).not.toHaveBeenCalled();
    expect(onConnectionChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PING_INTERVAL_MS / 2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(live()).toEqual([second]);
  });

  it('pings, swallows pongs, and keeps a responsive socket open', () => {
    const { onMessage } = create();
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();

    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
      expect(ws.sent.at(-1)).toBe('{"type":"ping"}');
      ws.serverMessage('{"type":"pong"}');
    }

    expect(onMessage).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('closes and reconnects when no frame arrives within two ping intervals', () => {
    const onConnectionChange = vi.fn();
    create({ onConnectionChange });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    vi.advanceTimersByTime(PING_INTERVAL_MS);

    expect(ws.readyState).toBe(FakeWebSocket.CLOSING);
    expect(onConnectionChange).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stays closed after 4001 until reset() + connect() re-arm it', () => {
    const onUnauthorized = vi.fn();
    const { client } = create({ onUnauthorized });
    FakeWebSocket.instances[0].serverOpen();
    FakeWebSocket.instances[0].serverClose(4001);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    client.connect();
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(1);

    client.reset();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].serverOpen();
    expect(client.bConnected).toBe(true);
  });

  it('re-registers online/visibility listeners when reset after close()', () => {
    const { client } = create();
    client.close();
    client.reset();
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
