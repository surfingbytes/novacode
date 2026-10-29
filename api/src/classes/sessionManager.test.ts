import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { FakePty, ptys } = vi.hoisted(() => {
  const ptys: FakePty[] = [];

  class FakePty {
    exited = false;
    readonly kill = vi.fn(() => this.exit(143));
    private readonly subscribers = new Set<(data: string) => void>();
    private readonly exitHandlers: ((code: number | undefined) => void)[] = [];

    constructor() {
      ptys.push(this);
    }

    subscribe(handler: (data: string) => void): void {
      this.subscribers.add(handler);
    }

    onExit(handler: (code: number | undefined) => void): void {
      this.exitHandlers.push(handler);
    }

    emit(data: string): void {
      for (const handler of this.subscribers) handler(data);
    }

    exit(code: number | undefined): void {
      this.exited = true;
      for (const handler of this.exitHandlers) handler(code);
    }
  }

  return { FakePty, ptys };
});

vi.mock('./ptyProcess', () => ({ PtyProcess: FakePty }));
vi.mock('./config', () => ({ config: { configDir: '/tmp', agentEnv: () => ({}) } }));

import { AUTH_SESSION_EXIT_RETENTION_MS, AUTH_SESSION_IDLE_TTL_MS, sessionManager } from './sessionManager';

beforeEach(() => {
  vi.useFakeTimers();
  ptys.length = 0;
});

afterEach(() => {
  sessionManager.stopAll();
  vi.useRealTimers();
});

describe('sessionManager auth session TTL', () => {
  it('kills and drops an idle session after the TTL', () => {
    const { id } = sessionManager.createAuthSession('cursor-agent', ['login']);
    vi.advanceTimersByTime(AUTH_SESSION_IDLE_TTL_MS - 1);
    expect(sessionManager.get(id)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(sessionManager.get(id)).toBeUndefined();
    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it('resets the idle timer on activity', () => {
    const { id } = sessionManager.createAuthSession('cursor-agent', ['login']);
    vi.advanceTimersByTime(AUTH_SESSION_IDLE_TTL_MS - 1000);
    sessionManager.touch(id);
    vi.advanceTimersByTime(AUTH_SESSION_IDLE_TTL_MS - 1000);
    expect(sessionManager.get(id)).toBeDefined();
    ptys[0]?.emit('output');
    vi.advanceTimersByTime(AUTH_SESSION_IDLE_TTL_MS - 1000);
    expect(sessionManager.get(id)).toBeDefined();
    vi.advanceTimersByTime(1000);
    expect(sessionManager.get(id)).toBeUndefined();
  });

  it('drops the session shortly after the PTY exits', () => {
    const { id } = sessionManager.createAuthSession('claude', ['setup-token']);
    const statuses: string[] = [];
    sessionManager.subscribeStatus(id, (status) => statuses.push(status));
    ptys[0]?.exit(0);
    expect(statuses).toEqual(['stopped']);
    expect(sessionManager.get(id)?.meta.status).toBe('stopped');
    sessionManager.touch(id);
    vi.advanceTimersByTime(AUTH_SESSION_EXIT_RETENTION_MS);
    expect(sessionManager.get(id)).toBeUndefined();
    expect(ptys[0]?.kill).not.toHaveBeenCalled();
  });

  it('stopAll kills running PTYs and clears sessions', () => {
    const { id } = sessionManager.createAuthSession('cursor-agent', ['login']);
    sessionManager.stopAll();
    expect(sessionManager.get(id)).toBeUndefined();
    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
