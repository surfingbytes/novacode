// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

// classes
import { sessionsApi } from '@/classes/api';

// composables
import { useSessionListActions } from './useSessionListActions';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { Session } from '@/@types/index';

const push = vi.fn();
const route = reactive<{ params: Record<string, string> }>({ params: {} });

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => route
}));

vi.mock('@/classes/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/classes/api')>()),
  isGloballyToasted: () => false,
  sessionsApi: {
    update: vi.fn(),
    remove: vi.fn(),
    create: vi.fn(),
    markRead: vi.fn(() => Promise.resolve({ data: null }))
  }
}));

function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    workspaceId: 'w1',
    name: 'Session one',
    tags: ['a'],
    agentType: 'claude',
    modelSelection: 'auto',
    sessionMode: 'agent',
    approvalPolicy: 'ask',
    archived: false,
    isFavorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as Session;
}

describe('useSessionListActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    route.params = {};
  });

  it('archive applies the API response to the store without waiting for the socket', async () => {
    const store = useWorkspacesStore();
    const session = sessionFixture();
    store.upsertSession(session);
    vi.mocked(sessionsApi.update).mockResolvedValue({
      data: { ...session, archived: true }
    } as never);

    await useSessionListActions().archive(session);

    expect(sessionsApi.update).toHaveBeenCalledWith('w1', 's1', { archived: true });
    expect(store.allSessions.find((s) => s.id === 's1')?.archived).toBe(true);
  });

  it('unarchive applies the API response to the store', async () => {
    const store = useWorkspacesStore();
    const session = sessionFixture({ archived: true });
    store.upsertSession(session);
    vi.mocked(sessionsApi.update).mockResolvedValue({
      data: { ...session, archived: false }
    } as never);

    await useSessionListActions().unarchive(session);

    expect(sessionsApi.update).toHaveBeenCalledWith('w1', 's1', { archived: false });
    expect(store.allSessions.find((s) => s.id === 's1')?.archived).toBe(false);
  });

  it('remove calls the API, then removes the session from the store', async () => {
    const store = useWorkspacesStore();
    const session = sessionFixture();
    store.upsertSession(session);
    vi.mocked(sessionsApi.remove).mockImplementation(async () => {
      // still in the store while the request is in flight
      expect(store.allSessions.some((s) => s.id === 's1')).toBe(true);
      return { data: null };
    });

    await useSessionListActions().remove(session);

    expect(sessionsApi.remove).toHaveBeenCalledWith('w1', 's1');
    expect(store.allSessions.some((s) => s.id === 's1')).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('remove keeps the store when the API fails', async () => {
    const store = useWorkspacesStore();
    const session = sessionFixture();
    store.upsertSession(session);
    vi.mocked(sessionsApi.remove).mockRejectedValue(new Error('nope'));

    await useSessionListActions().remove(session);

    expect(store.allSessions.some((s) => s.id === 's1')).toBe(true);
  });

  it('remove leaves the deleted session when it is open', async () => {
    route.params = { id: 'w1', sessionId: 's1' };
    vi.mocked(sessionsApi.remove).mockResolvedValue({ data: null });

    await useSessionListActions().remove(sessionFixture());

    expect(push).toHaveBeenCalledWith({ name: 'workspace-sessions', params: { id: 'w1' } });
  });

  it('confirmRemove deletes the pending session and closes the dialog', async () => {
    vi.mocked(sessionsApi.remove).mockResolvedValue({ data: null });
    const actions = useSessionListActions();
    actions.pick(sessionFixture(), 'delete');
    expect(actions.sessionPendingDelete.value?.id).toBe('s1');

    await actions.confirmRemove();

    expect(sessionsApi.remove).toHaveBeenCalledWith('w1', 's1');
    expect(actions.sessionPendingDelete.value).toBeNull();
  });

  it('menuItems reflects archived and favorite state', () => {
    const { menuItems } = useSessionListActions();
    const keys = (s: Session): string[] => menuItems(s).map((item) => item.key);

    expect(keys(sessionFixture())).toEqual([
      'open',
      'edit',
      'favorite',
      'clone',
      'archive',
      'delete'
    ]);
    expect(menuItems(sessionFixture()).find((i) => i.key === 'favorite')?.label).toBe(
      'Add to favorites'
    );
    expect(
      menuItems(sessionFixture({ isFavorite: true })).find((i) => i.key === 'favorite')?.label
    ).toBe('Remove favorite');
    expect(keys(sessionFixture({ archived: true }))).toEqual([
      'open',
      'edit',
      'clone',
      'unarchive',
      'delete'
    ]);
  });

  it('toggleFavorite updates the store from the response', async () => {
    const store = useWorkspacesStore();
    const session = sessionFixture();
    store.upsertSession(session);
    vi.mocked(sessionsApi.update).mockResolvedValue({
      data: { ...session, isFavorite: true }
    } as never);

    await useSessionListActions().toggleFavorite(session);

    expect(sessionsApi.update).toHaveBeenCalledWith('w1', 's1', { isFavorite: true });
    expect(store.allSessions.find((s) => s.id === 's1')?.isFavorite).toBe(true);
  });

  it('clone creates a session with the same settings and opens it', async () => {
    const store = useWorkspacesStore();
    vi.mocked(sessionsApi.create).mockResolvedValue({
      data: sessionFixture({ id: 's2', name: 'Session one (copy)' })
    } as never);

    await useSessionListActions().clone(sessionFixture());

    expect(sessionsApi.create).toHaveBeenCalledWith('w1', {
      name: 'Session one (copy)',
      tags: ['a'],
      agentType: 'claude',
      modelSelection: 'auto',
      sessionMode: 'agent',
      approvalPolicy: 'ask'
    });
    expect(store.allSessions.some((s) => s.id === 's2')).toBe(true);
    expect(push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'w1', sessionId: 's2' }
    });
  });

  it('saveEdit applies the response to the store and closes the modal', async () => {
    const store = useWorkspacesStore();
    const session = sessionFixture();
    store.upsertSession(session);
    vi.mocked(sessionsApi.update).mockResolvedValue({
      data: { ...session, name: 'Renamed' }
    } as never);
    const actions = useSessionListActions();
    actions.edit(session);

    await actions.saveEdit({ name: 'Renamed', tags: null });

    expect(store.allSessions.find((s) => s.id === 's1')?.name).toBe('Renamed');
    expect(actions.sessionToEdit.value).toBeNull();
  });
});
