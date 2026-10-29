// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/classes/api', () => ({
  settingsApi: { getMcpClients: vi.fn(() => new Promise(() => {})) },
  isGloballyToasted: () => false
}));

// composables
import { NOVA_MCP_OFF_MESSAGE, useSessionOrchestrator } from './useSessionOrchestrator';

// stores
import { useNovaMcpStore } from '@/stores/novaMcp';
import { useToastStore } from '@/stores/toasts';

// types
import type { Orchestrator } from '@/@types/index';

const STEPS_JSON = JSON.stringify([{ name: 'Step 1', prompt: 'Do it' }]);

function mountOrchestrator(initial: Partial<Orchestrator> | null) {
  const orchestrator = ref<Orchestrator | null>(initial as Orchestrator | null);
  let resolveFetch: () => void = () => {};
  const orchestratorsStore = {
    forPlannerSession: vi.fn(() => orchestrator.value),
    ensureFetched: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve;
        })
    )
  };
  const activeTab = ref('chat');
  const sendPrompt = vi.fn();
  const router = { push: vi.fn() } as unknown as Router;
  const api = useSessionOrchestrator({
    workspaceId: () => 'w1',
    sessionId: () => 's1',
    router,
    orchestratorsStore,
    activeTab,
    sendPrompt
  });
  return { api, orchestrator, activeTab, sendPrompt, router, resolveFetch: () => resolveFetch() };
}

describe('useSessionOrchestrator', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('detects whether the planned orchestrator has steps', () => {
    const { api, orchestrator } = mountOrchestrator(null);
    expect(api.bPlanHasSteps.value).toBe(false);

    orchestrator.value = { id: 'o1', subtasksJson: '[]' } as Orchestrator;
    expect(api.bPlanHasSteps.value).toBe(false);

    orchestrator.value = { id: 'o1', subtasksJson: STEPS_JSON } as Orchestrator;
    expect(api.bPlanHasSteps.value).toBe(true);
  });

  it('switches to the Orchestrator tab when steps appear after plans loaded', async () => {
    const { api, orchestrator, activeTab, resolveFetch } = mountOrchestrator({
      id: 'o1',
      subtasksJson: '[]'
    });
    api.loadPlannedOrchestrator();
    resolveFetch();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.bOrchestratorsLoaded.value).toBe(true);

    orchestrator.value = { id: 'o1', subtasksJson: STEPS_JSON } as Orchestrator;
    await nextTick();
    expect(activeTab.value).toBe('orchestrator');
  });

  it('does not switch tabs while plans are still loading', async () => {
    const { api, orchestrator, activeTab } = mountOrchestrator({ id: 'o1', subtasksJson: '[]' });
    api.loadPlannedOrchestrator();

    orchestrator.value = { id: 'o1', subtasksJson: STEPS_JSON } as Orchestrator;
    await nextTick();
    expect(activeTab.value).toBe('chat');
  });

  it('sends the plan prompt from the chat tab', () => {
    const { api, activeTab, sendPrompt } = mountOrchestrator(null);
    activeTab.value = 'git';
    api.planAsOrchestrator();
    expect(activeTab.value).toBe('chat');
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(typeof sendPrompt.mock.calls[0][0]).toBe('string');
  });

  it('toasts instead of sending the prompt while the nova MCP is off', () => {
    useNovaMcpStore().setEnabled(false);
    const { api, activeTab, sendPrompt } = mountOrchestrator(null);
    activeTab.value = 'git';
    api.planAsOrchestrator();
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(activeTab.value).toBe('git');
    expect(useToastStore().toasts.map((toast) => [toast.kind, toast.text])).toEqual([
      ['error', NOVA_MCP_OFF_MESSAGE]
    ]);

    // Unknown state (fetch failed or pending) does not block planning.
    useNovaMcpStore().setEnabled(true);
    api.planAsOrchestrator();
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('opens the orchestrator page only when a plan exists', () => {
    const { api, orchestrator, router } = mountOrchestrator(null);
    api.openOrchestratorPage();
    expect(router.push).not.toHaveBeenCalled();

    orchestrator.value = { id: 'o1', subtasksJson: '[]' } as Orchestrator;
    api.openOrchestratorPage();
    expect(router.push).toHaveBeenCalledWith({
      name: 'orchestrator',
      params: { id: 'w1', orchestratorId: 'o1' }
    });
  });
});
