// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';

// classes
import type { SearchResponse } from '@/@types/index';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/classes/api', () => ({
  searchApi: { query: queryMock },
  isGloballyToasted: () => false
}));

// components
import GlobalSearchModal from '@/components/GlobalSearchModal.vue';

function response(name: string): SearchResponse {
  return {
    workspaces: [{ id: `ws-${name}`, name, type: 'workspace' }],
    sessions: [],
    orchestrators: [],
    roleTemplates: [],
    automations: []
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function mountModal(): Promise<ReturnType<typeof mount>> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: { template: '<div />' } }]
  });
  await router.push('/');
  await router.isReady();
  return mount(GlobalSearchModal, {
    props: { isOpen: true },
    global: { plugins: [router] },
    attachTo: document.getElementById('app')!
  });
}

describe('GlobalSearchModal search', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setActivePinia(createPinia());
    vi.useFakeTimers();
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces typing into a single request', async () => {
    queryMock.mockResolvedValue(response('abc'));
    const wrapper = await mountModal();
    const input = document.querySelector<HTMLInputElement>('input.search-input')!;

    input.value = 'ab';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(100);
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(199);
    expect(queryMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]?.[0]).toBe('abc');
    wrapper.unmount();
  });

  it('ignores a late response for a superseded query and aborts it', async () => {
    const slow = deferred<SearchResponse>();
    queryMock.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(response('abc-result'));
    const wrapper = await mountModal();
    const input = document.querySelector<HTMLInputElement>('input.search-input')!;

    input.value = 'ab';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const firstSignal = queryMock.mock.calls[0]?.[1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    input.value = 'abc';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
    await flushPromises();
    expect(document.body.textContent).toContain('abc-result');

    slow.resolve(response('ab-stale'));
    await flushPromises();
    expect(document.body.textContent).toContain('abc-result');
    expect(document.body.textContent).not.toContain('ab-stale');
    expect(document.querySelector('.search-spinner')).toBeNull();
    wrapper.unmount();
  });

  it('keeps current results when a later search fails', async () => {
    queryMock.mockResolvedValueOnce(response('first-result')).mockRejectedValueOnce(new Error('boom'));
    const wrapper = await mountModal();
    const input = document.querySelector<HTMLInputElement>('input.search-input')!;

    input.value = 'first';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(document.body.textContent).toContain('first-result');

    input.value = 'firstx';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(document.body.textContent).toContain('first-result');
    expect(document.querySelector('.search-state--error')).toBeNull();
    wrapper.unmount();
  });
});
