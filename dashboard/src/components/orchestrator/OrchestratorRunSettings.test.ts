// @vitest-environment jsdom

// node_modules
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

// types
import type { Orchestrator, Session } from '@/@types/index';

vi.mock('@/classes/api', () => ({
  orchestratorApi: { update: vi.fn() },
  settingsApi: { getAgentOptions: vi.fn(async () => ({ data: { models: [] } })) },
  isGloballyToasted: () => false
}));

// components
import OrchestratorRunSettings from '@/components/orchestrator/OrchestratorRunSettings.vue';

let mounted: VueWrapper | null = null;

function mountSettings(orchestrator: Partial<Orchestrator>, plannerSession: Partial<Session> | null = null): VueWrapper {
  mounted = mount(OrchestratorRunSettings, {
    props: {
      workspaceId: 'ws-1',
      orchestratorId: 'o-1',
      orchestrator: { id: 'o-1', agentType: 'claude', maxParallel: 3, ...orchestrator } as Orchestrator,
      plannerSession: plannerSession as Session | null,
      canEdit: true
    },
    global: { stubs: { AgentModelPicker: true, UiToggle: true } }
  });
  return mounted;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OrchestratorRunSettings', () => {
  it('is collapsed by default and summarises the planning-chat defaults', () => {
    const wrapper = mountSettings({ workerModel: null, verifyAgentType: null }, { agentType: 'claude' });
    expect(wrapper.find('#orch-max-parallel').exists()).toBe(false);
    expect(wrapper.get('[data-testid="run-settings-toggle"]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[data-testid="run-settings-summary"]').text()).toBe(
      'Workers: Claude · same as planning chat · 3 parallel — Verify: same as planning chat'
    );
  });

  it('summarises explicit worker and verify choices', () => {
    const wrapper = mountSettings(
      { agentType: 'codex', workerModel: 'gpt-5', maxParallel: 2, verifyAgentType: 'claude', verifyModel: 'opus' },
      { agentType: 'claude' }
    );
    expect(wrapper.get('[data-testid="run-settings-summary"]').text()).toBe(
      'Workers: Codex · gpt-5 · 2 parallel — Verify: Claude · opus'
    );
  });

  it('expands to the full controls and hides the summary', async () => {
    const wrapper = mountSettings({ workerModel: null, verifyAgentType: null }, { agentType: 'claude' });
    await wrapper.get('[data-testid="run-settings-toggle"]').trigger('click');
    expect(wrapper.get('[data-testid="run-settings-toggle"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[data-testid="run-settings-summary"]').exists()).toBe(false);
    expect(wrapper.find('#orch-max-parallel').exists()).toBe(true);

    await wrapper.get('[data-testid="run-settings-toggle"]').trigger('click');
    expect(wrapper.find('#orch-max-parallel').exists()).toBe(false);
  });
});
