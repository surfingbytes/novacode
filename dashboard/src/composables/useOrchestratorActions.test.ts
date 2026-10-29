// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

// classes
import { orchestratorApi } from '@/classes/api';

// composables
import { useOrchestratorActions } from './useOrchestratorActions';

// stores
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { Orchestrator } from '@/@types/index';

const push = vi.fn();
const route = reactive<{ params: Record<string, string> }>({ params: {} });

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => route
}));

vi.mock('@/classes/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/classes/api')>()),
  isGloballyToasted: () => false,
  orchestratorApi: {
    update: vi.fn(),
    remove: vi.fn(),
    clone: vi.fn(),
    markRead: vi.fn(() => Promise.resolve({ data: null }))
  }
}));

function orchestratorFixture(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    id: 'o1',
    workspaceId: 'w1',
    name: 'Plan',
    tags: null,
    messageJson: '',
    subtasksJson: null,
    archived: false,
    isFavorite: false,
    unread: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as Orchestrator;
}

describe('useOrchestratorActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    route.params = {};
  });

  it('archive applies the API response to the store', async () => {
    const store = useOrchestratorsStore();
    const orchestrator = orchestratorFixture();
    store.upsertOrchestrator(orchestrator);
    vi.mocked(orchestratorApi.update).mockResolvedValue({
      data: { ...orchestrator, archived: true }
    } as never);

    await useOrchestratorActions().archive(orchestrator);

    expect(orchestratorApi.update).toHaveBeenCalledWith('w1', 'o1', { archived: true });
    expect(store.byId('o1')?.archived).toBe(true);
  });

  it('unarchive merges the response into the existing row', async () => {
    const store = useOrchestratorsStore();
    const orchestrator = orchestratorFixture({ archived: true, messageJson: '[{"x":1}]' });
    store.upsertOrchestrator(orchestrator);
    // response without the heavy field — the store merge keeps it
    const response: Partial<Orchestrator> = { ...orchestrator, archived: false };
    delete response.messageJson;
    vi.mocked(orchestratorApi.update).mockResolvedValue({ data: response } as never);

    await useOrchestratorActions().unarchive(orchestrator);

    expect(store.byId('o1')?.archived).toBe(false);
    expect(store.byId('o1')?.messageJson).toBe('[{"x":1}]');
  });

  it('remove calls the API, then removes the orchestrator from the store', async () => {
    const store = useOrchestratorsStore();
    const orchestrator = orchestratorFixture();
    store.upsertOrchestrator(orchestrator);
    vi.mocked(orchestratorApi.remove).mockImplementation(async () => {
      expect(store.byId('o1')).not.toBeNull();
      return { data: null };
    });

    await useOrchestratorActions().remove(orchestrator);

    expect(orchestratorApi.remove).toHaveBeenCalledWith('w1', 'o1');
    expect(store.byId('o1')).toBeNull();
  });

  it('remove keeps the store when the API fails', async () => {
    const store = useOrchestratorsStore();
    const orchestrator = orchestratorFixture();
    store.upsertOrchestrator(orchestrator);
    vi.mocked(orchestratorApi.remove).mockRejectedValue(new Error('nope'));

    await useOrchestratorActions().remove(orchestrator);

    expect(store.byId('o1')).not.toBeNull();
  });

  it('remove leaves the deleted orchestrator when it is open', async () => {
    route.params = { id: 'w1', orchestratorId: 'o1' };
    vi.mocked(orchestratorApi.remove).mockResolvedValue({ data: null });

    await useOrchestratorActions().remove(orchestratorFixture());

    expect(push).toHaveBeenCalledWith({ name: 'workspace-sessions', params: { id: 'w1' } });
  });

  it('menuItems reflects archived and favorite state', () => {
    const { menuItems } = useOrchestratorActions();
    const keys = (o: Orchestrator): string[] => menuItems(o).map((item) => item.key);

    expect(keys(orchestratorFixture())).toEqual([
      'open',
      'edit',
      'favorite',
      'clone',
      'archive',
      'delete'
    ]);
    expect(
      menuItems(orchestratorFixture({ isFavorite: true })).find((i) => i.key === 'favorite')
        ?.label
    ).toBe('Remove favorite');
    expect(keys(orchestratorFixture({ archived: true }))).toEqual([
      'open',
      'edit',
      'clone',
      'unarchive',
      'delete'
    ]);
  });

  it('clone upserts the copy and opens it', async () => {
    const store = useOrchestratorsStore();
    vi.mocked(orchestratorApi.clone).mockResolvedValue({
      data: orchestratorFixture({ id: 'o2' })
    } as never);

    await useOrchestratorActions().clone(orchestratorFixture());

    expect(store.byId('o2')).not.toBeNull();
    expect(push).toHaveBeenCalledWith({
      name: 'orchestrator',
      params: { id: 'w1', orchestratorId: 'o2' }
    });
  });

  it('saveEdit renames through the store', async () => {
    const store = useOrchestratorsStore();
    const orchestrator = orchestratorFixture();
    store.upsertOrchestrator(orchestrator);
    vi.mocked(orchestratorApi.update).mockResolvedValue({
      data: { ...orchestrator, name: 'Renamed' }
    } as never);
    const actions = useOrchestratorActions();
    actions.pick(orchestrator, 'edit');

    await actions.saveEdit('Renamed');

    expect(orchestratorApi.update).toHaveBeenCalledWith('w1', 'o1', { name: 'Renamed' });
    expect(store.byId('o1')?.name).toBe('Renamed');
    expect(actions.orchestratorToEdit.value).toBeNull();
  });
});
