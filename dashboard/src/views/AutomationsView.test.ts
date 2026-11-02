// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

// types
import type { Automation, AutomationRun } from '@/@types/index';

const { listMock, listRunsMock } = vi.hoisted(() => ({ listMock: vi.fn(), listRunsMock: vi.fn() }));

vi.mock('@/classes/api', () => ({
  automationsApi: { list: listMock, listRuns: listRunsMock },
  workspaceApi: { list: vi.fn().mockResolvedValue({ data: [] }) }
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composables/useAgentCapabilities', () => ({
  useAgentCapabilities: () => ({
    claudeAvailable: ref(true),
    cursorAvailable: ref(true),
    mistralVibeAvailable: ref(false),
    openCodeAvailable: ref(false),
    codexAvailable: ref(false),
    bCapabilitiesLoaded: ref(true),
    ensureLoaded: vi.fn()
  })
}));

// components
import AutomationsView from '@/views/AutomationsView.vue';
import AutomationCard from '@/components/automations/AutomationCard.vue';

function automation(id: string): Automation {
  return { id, name: `auto ${id}`, workspaceId: 'ws', enabled: true } as Automation;
}

function runsOf(count: number): AutomationRun[] {
  return Array.from({ length: count }, (_, i) => ({ id: `run-${i}`, status: 'completed' }) as AutomationRun);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AutomationsView runs panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMock.mockReset().mockResolvedValue({ data: [automation('x'), automation('y')] });
    listRunsMock.mockReset();
  });

  it("ignores a late runs response for an automation that is no longer selected", async () => {
    const slowRuns = deferred<{ data: AutomationRun[] }>();
    listRunsMock.mockImplementation((id: string) =>
      id === 'x' ? slowRuns.promise : Promise.resolve({ data: runsOf(1) })
    );
    const wrapper = mount(AutomationsView, {
      global: { stubs: { AutomationCard: true, AutomationFormModal: true, ConfirmModal: true, PageHeader: true } }
    });
    await flushPromises();

    const cards = wrapper.findAllComponents(AutomationCard);
    cards[0].vm.$emit('select');
    await flushPromises();
    cards[1].vm.$emit('select');
    await flushPromises();
    slowRuns.resolve({ data: runsOf(3) });
    await flushPromises();

    expect(wrapper.text()).toContain('auto y — Runs');
    expect(wrapper.text()).toContain('1 runs');
    wrapper.unmount();
  });
});
