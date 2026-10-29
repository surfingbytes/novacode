// @vitest-environment jsdom

// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const { getMcpClientsMock } = vi.hoisted(() => ({ getMcpClientsMock: vi.fn() }));

vi.mock('@/classes/api', () => ({
  settingsApi: { getMcpClients: getMcpClientsMock },
  sessionSpecApi: { get: vi.fn(), create: vi.fn() },
  sessionsApi: { updateSpec: vi.fn() },
  isGloballyToasted: () => false
}));

// components
import SessionOrchestratorMenuItems from '@/components/chat/SessionOrchestratorMenuItems.vue';

// composables
import { NOVA_MCP_OFF_MESSAGE } from '@/composables/useSessionOrchestrator';

let mounted: VueWrapper | null = null;

function mountItems(bHasSteps: boolean): VueWrapper {
  mounted = mount(SessionOrchestratorMenuItems, {
    props: { sessionId: 's-1', orchestratorId: bHasSteps ? 'o-1' : null, bHasSteps }
  });
  return mounted;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getMcpClientsMock.mockReset();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SessionOrchestratorMenuItems', () => {
  it('fetches the nova MCP flag on mount and shows no marker while it is on', async () => {
    getMcpClientsMock.mockResolvedValue({ data: { servers: {}, builtin: { nova: { enabled: true } } } });
    const wrapper = mountItems(false);
    await flushPromises();
    expect(getMcpClientsMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="nova-mcp-off-plan"]').exists()).toBe(false);
    expect(wrapper.findAll('button')[0].attributes('title')).toBeUndefined();
  });

  it('marks Plan as orchestrator when the nova MCP is off', async () => {
    getMcpClientsMock.mockResolvedValue({ data: { servers: {}, builtin: { nova: { enabled: false } } } });
    const wrapper = mountItems(false);
    await flushPromises();
    const plan = wrapper.findAll('button')[0];
    expect(plan.text()).toContain('Plan as orchestrator');
    expect(plan.attributes('title')).toBe(NOVA_MCP_OFF_MESSAGE);
    expect(wrapper.find('[data-testid="nova-mcp-off-plan"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nova-mcp-off-update"]').exists()).toBe(false);
  });

  it('marks Update plan but not the Orchestrator item once the plan has steps', async () => {
    getMcpClientsMock.mockResolvedValue({ data: { servers: {}, builtin: { nova: { enabled: false } } } });
    const wrapper = mountItems(true);
    await flushPromises();
    const [open, update] = wrapper.findAll('button');
    expect(open.text()).toContain('Orchestrator');
    expect(open.attributes('title')).toBeUndefined();
    expect(update.attributes('title')).toBe(NOVA_MCP_OFF_MESSAGE);
    expect(wrapper.find('[data-testid="nova-mcp-off-plan"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="nova-mcp-off-update"]').exists()).toBe(true);
  });
});
