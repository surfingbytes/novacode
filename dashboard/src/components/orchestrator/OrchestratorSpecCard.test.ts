// @vitest-environment jsdom

// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// types
import type { SessionSpecStatus } from '@/@types/index';

const { getMock, updateSpecMock } = vi.hoisted(() => ({ getMock: vi.fn(), updateSpecMock: vi.fn() }));

vi.mock('@/classes/api', () => ({
  sessionSpecApi: { get: getMock, create: vi.fn() },
  sessionsApi: { updateSpec: updateSpecMock },
  isGloballyToasted: () => false
}));

// components
import OrchestratorSpecCard from '@/components/orchestrator/OrchestratorSpecCard.vue';

// stores
import { useSessionSpecsStore } from '@/stores/sessionSpecs';

function status(overrides: Partial<SessionSpecStatus> = {}): SessionSpecStatus {
  return {
    sessionId: 's-1',
    exists: true,
    hasContent: true,
    path: '/tmp/spec.md',
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides
  } as SessionSpecStatus;
}

let mounted: VueWrapper | null = null;

function mountCard(): VueWrapper {
  mounted = mount(OrchestratorSpecCard, { props: { workspaceId: 'ws-1', sessionId: 's-1' } });
  return mounted;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getMock.mockReset();
  updateSpecMock.mockReset();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OrchestratorSpecCard', () => {
  it('starts collapsed and shows the relative update time from the store status', async () => {
    useSessionSpecsStore().applyStatus(status());
    const wrapper = mountCard();
    await flushPromises();
    expect(getMock).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="spec-body"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="spec-toggle"]').text()).toContain('Spec');
    expect(wrapper.find('[data-testid="spec-updated"]').text()).toBe('updated 5m ago');
  });

  it('fetches the status on mount when unknown and reads "empty" without content', async () => {
    getMock.mockResolvedValue({ data: { status: status({ hasContent: false }), content: null } });
    const wrapper = mountCard();
    await flushPromises();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="spec-updated"]').text()).toBe('empty');

    await wrapper.find('[data-testid="spec-toggle"]').trigger('click');
    await flushPromises();
    // Content already loaded on mount; expanding does not fetch again.
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="spec-empty"]').text()).toBe('The planning chat has not written a spec yet.');
    await wrapper.find('[data-testid="spec-edit"]').trigger('click');
    expect((wrapper.find('[data-testid="spec-textarea"]').element as HTMLTextAreaElement).value).toBe('');
  });

  it('fetches once on expand, renders markdown and refetches when the status changes', async () => {
    const store = useSessionSpecsStore();
    store.applyStatus(status());
    getMock.mockResolvedValue({ data: { status: status(), content: '# Title\n\nBody' } });
    const wrapper = mountCard();

    await wrapper.find('[data-testid="spec-toggle"]').trigger('click');
    await flushPromises();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="spec-rendered"] h1').text()).toBe('Title');

    await wrapper.find('[data-testid="spec-toggle"]').trigger('click');
    await wrapper.find('[data-testid="spec-toggle"]').trigger('click');
    await flushPromises();
    expect(getMock).toHaveBeenCalledTimes(1);

    // The agent rewrote the spec: a newer status arrives over the socket.
    const newer = status({ updatedAt: new Date().toISOString() });
    getMock.mockResolvedValue({ data: { status: newer, content: '# Rewritten' } });
    store.applyStatus(newer);
    await flushPromises();
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="spec-rendered"] h1').text()).toBe('Rewritten');
  });

  it('edits in a monospace textarea, saves through the store and shows the result', async () => {
    useSessionSpecsStore().applyStatus(status());
    getMock.mockResolvedValue({ data: { status: status(), content: '# Old' } });
    const saved = status({ updatedAt: new Date().toISOString() });
    updateSpecMock.mockResolvedValue({ data: { status: saved, content: '# New\n' } });
    const wrapper = mountCard();
    await wrapper.find('[data-testid="spec-toggle"]').trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="spec-edit"]').trigger('click');
    const textarea = wrapper.find('[data-testid="spec-textarea"]');
    expect(textarea.attributes('rows')).toBe('12');
    expect(textarea.classes()).toContain('font-mono');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('# Old');

    await textarea.setValue('# New');
    await wrapper.find('[data-testid="spec-save"]').trigger('click');
    await flushPromises();
    expect(updateSpecMock).toHaveBeenCalledWith('ws-1', 's-1', '# New');
    expect(wrapper.find('[data-testid="spec-textarea"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="spec-rendered"] h1').text()).toBe('New');
    // The status applied by the save must not trigger another fetch.
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the draft and keeps the rendered spec', async () => {
    useSessionSpecsStore().applyStatus(status());
    getMock.mockResolvedValue({ data: { status: status(), content: '# Old' } });
    const wrapper = mountCard();
    await wrapper.find('[data-testid="spec-toggle"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="spec-edit"]').trigger('click');
    await wrapper.find('[data-testid="spec-textarea"]').setValue('scratch');
    await wrapper.find('[data-testid="spec-cancel"]').trigger('click');
    expect(updateSpecMock).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="spec-textarea"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="spec-rendered"] h1').text()).toBe('Old');
  });
});
