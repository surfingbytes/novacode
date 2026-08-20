// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { sessionsApi, workspaceApi } from '@/classes/api';
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
  buildSessionsWsUrl: () => 'ws://localhost/api/ws/sessions'
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
    upsertOrchestrator: vi.fn()
  })
}));

function workspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Nova',
    path: '/data-root/opt/src/novacode',
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
    ...overrides
  };
}

describe('workspaces store bootstrap', () => {
  beforeEach(() => {
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
});
