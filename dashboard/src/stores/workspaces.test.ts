// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { sessionsApi, workspaceApi } from '@/classes/api';
import { createManagedSocket } from '@/lib/wsClient';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { Session, Workspace } from '@/@types/index';

vi.mock('@/classes/api', () => ({
  workspaceApi: {
    listAll: vi.fn()
  },
  sessionsApi: {
    listAll: vi.fn(),
    markRead: vi.fn()
  },
  orchestratorApi: {
    listAll: vi.fn(() => Promise.resolve({ data: [] }))
  },
  buildSessionsWsUrl: () => 'ws://localhost/api/ws/sessions',
  isApiUnreachableError: (error: unknown) => (error as { unreachable?: boolean })?.unreachable === true
}));

vi.mock('@/lib/wsClient', () => ({
  createManagedSocket: vi.fn(() => ({
    send: vi.fn(),
    close: vi.fn(),
    bConnected: false
  }))
}));

vi.mock('@/stores/orchestrators', () => ({
  useOrchestratorsStore: () => ({
    upsertOrchestrator: vi.fn(),
    applySummaries: vi.fn()
  })
}));

function workspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Nova',
    path: 'src/github/novacode',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    isFavorite: false,
    ...overrides
  };
}

function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    name: 'Recent session',
    tags: null,
    sessionId: null,
    agentType: 'cursor-agent',
    modelSelection: 'auto',
    sessionMode: 'agent',
    approvalPolicy: 'ask',
    workspaceId: 'ws-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    isFavorite: false,
    ...overrides
  };
}

describe('workspaces store bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.mocked(workspaceApi.listAll).mockReset();
    vi.mocked(sessionsApi.listAll).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('does not treat a failed workspace fetch as an empty list', async () => {
    vi.mocked(workspaceApi.listAll).mockRejectedValueOnce(new Error('network'));
    const store = useWorkspacesStore();

    await store.fetchAll();

    expect(store.workspaces).toEqual([]);
    expect(store.bWorkspacesLoadFailed).toBe(true);
    expect(store.bIsLoading).toBe(false);
  });

  it('retries a dropped-connection workspace fetch before reporting failure', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(workspaceApi.listAll)
        .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { unreachable: true }))
        .mockResolvedValueOnce({ data: [workspaceFixture()] } as never);
      const store = useWorkspacesStore();

      const pending = store.fetchAll();
      await vi.runAllTimersAsync();
      await pending;

      expect(workspaceApi.listAll).toHaveBeenCalledTimes(2);
      expect(store.workspaces).toHaveLength(1);
      expect(store.bWorkspacesLoadFailed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps previously loaded workspaces when a later fetch fails', async () => {
    vi.mocked(workspaceApi.listAll)
      .mockResolvedValueOnce({ data: [workspaceFixture()] } as never)
      .mockRejectedValueOnce(new Error('blip'));
    const store = useWorkspacesStore();

    await store.fetchAll();
    await store.fetchAll();

    expect(store.workspaces).toHaveLength(1);
    expect(store.workspaces[0]?.name).toBe('Nova');
    expect(store.bWorkspacesLoadFailed).toBe(false);
  });

  it('retries workspace loading after a failed startup fetch', async () => {
    vi.mocked(workspaceApi.listAll)
      .mockRejectedValueOnce(new Error('starting'))
      .mockResolvedValueOnce({ data: [workspaceFixture()] } as never);
    const store = useWorkspacesStore();

    await store.ensureWorkspacesInitialized();
    expect(store.bWorkspacesLoadFailed).toBe(true);
    expect(store.workspaces).toEqual([]);

    await store.ensureWorkspacesInitialized();
    expect(store.bWorkspacesLoadFailed).toBe(false);
    expect(store.workspaces).toHaveLength(1);
  });

  it('does not wipe sessions when the list request fails', async () => {
    vi.mocked(sessionsApi.listAll)
      .mockResolvedValueOnce({ data: [sessionFixture()] } as never)
      .mockRejectedValueOnce(new Error('blip'));
    const store = useWorkspacesStore();

    await store.ensureSessionsInitialized();
    expect(store.allSessions).toHaveLength(1);

    await store.fetchAllSessions();
    expect(store.allSessions).toHaveLength(1);
    expect(store.bSessionsLoadFailed).toBe(false);
  });

  it('retries session loading after a failed startup fetch', async () => {
    vi.mocked(sessionsApi.listAll)
      .mockRejectedValueOnce(new Error('starting'))
      .mockResolvedValueOnce({ data: [sessionFixture()] } as never);
    const store = useWorkspacesStore();

    await store.ensureSessionsInitialized();
    expect(store.bSessionsLoadFailed).toBe(true);
    expect(store.allSessions).toEqual([]);

    await store.ensureSessionsInitialized();
    expect(store.bSessionsLoadFailed).toBe(false);
    expect(store.allSessions).toHaveLength(1);
  });

  it('reloads workspaces and sessions after the API comes back', async () => {
    vi.mocked(workspaceApi.listAll)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ data: [workspaceFixture()] } as never);
    vi.mocked(sessionsApi.listAll)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ data: [sessionFixture()] } as never);
    const store = useWorkspacesStore();

    await store.ensureWorkspacesInitialized();
    await store.ensureSessionsInitialized();
    expect(store.bWorkspacesLoadFailed).toBe(true);
    expect(store.bSessionsLoadFailed).toBe(true);

    await store.reloadAfterReconnect();

    expect(store.workspaces).toHaveLength(1);
    expect(store.allSessions).toHaveLength(1);
    expect(store.bWorkspacesLoadFailed).toBe(false);
    expect(store.bSessionsLoadFailed).toBe(false);
  });

  it('retries reconnect reload after joining an in-flight failed fetch', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    vi.mocked(workspaceApi.listAll)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          })
      )
      .mockResolvedValueOnce({ data: [workspaceFixture()] } as never);
    vi.mocked(sessionsApi.listAll).mockResolvedValue({ data: [] } as never);
    const store = useWorkspacesStore();

    const first = store.fetchAll();
    const reload = store.reloadAfterReconnect();
    rejectFirst(new Error('down'));
    await first;
    await reload;

    expect(store.workspaces).toHaveLength(1);
    expect(store.bWorkspacesLoadFailed).toBe(false);
  });

  it('skips reloadIfLoadFailed once both lists have loaded', async () => {
    vi.mocked(workspaceApi.listAll).mockResolvedValue({ data: [workspaceFixture()] } as never);
    vi.mocked(sessionsApi.listAll).mockResolvedValue({ data: [sessionFixture()] } as never);
    const store = useWorkspacesStore();

    await store.ensureWorkspacesInitialized();
    await store.ensureSessionsInitialized();
    vi.mocked(workspaceApi.listAll).mockClear();
    vi.mocked(sessionsApi.listAll).mockClear();

    await store.reloadIfLoadFailed();

    expect(workspaceApi.listAll).not.toHaveBeenCalled();
    expect(sessionsApi.listAll).not.toHaveBeenCalled();
  });

  it('reset() clears data, closes the sessions socket and reconnects on the next init', async () => {
    vi.mocked(workspaceApi.listAll).mockResolvedValue({ data: [workspaceFixture()] } as never);
    vi.mocked(sessionsApi.listAll).mockResolvedValue({ data: [sessionFixture()] } as never);
    vi.mocked(createManagedSocket).mockClear();
    const store = useWorkspacesStore();

    await store.ensureWorkspacesInitialized();
    await store.setActiveWorkspace('ws-1');
    expect(createManagedSocket).toHaveBeenCalledTimes(1);
    const firstSocket = vi.mocked(createManagedSocket).mock.results[0]?.value as { close: ReturnType<typeof vi.fn> };

    store.reset();

    expect(firstSocket.close).toHaveBeenCalledTimes(1);
    expect(store.workspaces).toEqual([]);
    expect(store.allSessions).toEqual([]);
    expect(store.activeWorkspaceId).toBeNull();

    await store.ensureWorkspacesInitialized();
    await store.ensureSessionsInitialized();

    expect(store.workspaces).toHaveLength(1);
    expect(store.allSessions).toHaveLength(1);
    expect(createManagedSocket).toHaveBeenCalledTimes(2);
  });

  it('keeps live session events that arrive while a list refresh is in flight', async () => {
    vi.mocked(workspaceApi.listAll).mockResolvedValue({ data: [workspaceFixture()] } as never);
    vi.mocked(sessionsApi.listAll).mockResolvedValueOnce({ data: [sessionFixture()] } as never);
    vi.mocked(createManagedSocket).mockClear();
    const store = useWorkspacesStore();
    await store.setActiveWorkspace('ws-1');
    const socketOptions = vi.mocked(createManagedSocket).mock.calls.at(-1)![0];
    const serverSends = (message: unknown) => socketOptions.onMessage(JSON.stringify(message));

    let finishList: (value: unknown) => void = () => undefined;
    vi.mocked(sessionsApi.listAll).mockReturnValueOnce(
      new Promise((resolve) => (finishList = resolve)) as never
    );
    const refresh = store.fetchAllSessions();
    serverSends({ type: 'busy-changed', id: 'sess-1', busy: true });
    serverSends({ type: 'session-upsert', session: sessionFixture({ id: 'sess-2', name: 'Brand new' }) });
    // Stale snapshot taken before both events.
    finishList({ data: [sessionFixture({ busy: false })] });
    await refresh;

    expect(store.allSessions.map((session) => [session.id, session.busy ?? false])).toEqual([
      ['sess-2', false],
      ['sess-1', true]
    ]);
  });
});


describe('workspaces store list cache', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.mocked(workspaceApi.listAll).mockReset();
    vi.mocked(sessionsApi.listAll).mockReset();
  });

  it('shows the last fetched lists on the next start while the fresh fetch is pending', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(workspaceApi.listAll).mockResolvedValueOnce({ data: [workspaceFixture()] } as never);
      vi.mocked(sessionsApi.listAll).mockResolvedValueOnce({ data: [sessionFixture()] } as never);
      const firstStart = useWorkspacesStore();
      await firstStart.fetchAll();
      await firstStart.fetchAllSessions();
      await vi.runAllTimersAsync();

      setActivePinia(createPinia());
      vi.mocked(workspaceApi.listAll).mockReturnValueOnce(new Promise(() => undefined));
      const secondStart = useWorkspacesStore();
      void secondStart.ensureWorkspacesInitialized();

      expect(secondStart.workspaces.map((workspace) => workspace.id)).toEqual(['ws-1']);
      expect(secondStart.allSessions.map((session) => session.id)).toEqual(['sess-1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the cached lists with the fetched ones', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(workspaceApi.listAll).mockResolvedValueOnce({ data: [workspaceFixture()] } as never);
      const firstStart = useWorkspacesStore();
      await firstStart.fetchAll();
      await vi.runAllTimersAsync();

      setActivePinia(createPinia());
      vi.mocked(workspaceApi.listAll).mockResolvedValueOnce({ data: [workspaceFixture({ id: 'ws-2' })] } as never);
      const secondStart = useWorkspacesStore();
      await secondStart.ensureWorkspacesInitialized();

      expect(secondStart.workspaces.map((workspace) => workspace.id)).toEqual(['ws-2']);
    } finally {
      vi.useRealTimers();
    }
  });
});
