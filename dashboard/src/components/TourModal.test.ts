// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';

// components
import TourModal from '@/components/TourModal.vue';

function title(): string | null | undefined {
  return document.body.querySelector('#tour-modal-title')?.textContent;
}

async function click(selector: string): Promise<void> {
  const element = document.body.querySelector<HTMLButtonElement>(selector);
  if (!element) {
    throw new Error(`element not found: ${selector}`);
  }
  element.click();
  await nextTick();
}

interface TourHandlers {
  onDone: Mock<() => void>;
  onSkip: Mock<() => void>;
  onAddWorkspace: Mock<() => void>;
  'onUpdate:modelValue': Mock<(value: boolean) => void>;
}

let mounted: VueWrapper | null = null;

// Listener props rather than wrapper.emitted(): emit tracking is off under NODE_ENV=production.
async function mountOpen(): Promise<TourHandlers> {
  const handlers: TourHandlers = {
    onDone: vi.fn(),
    onSkip: vi.fn(),
    onAddWorkspace: vi.fn(),
    'onUpdate:modelValue': vi.fn()
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }]
  });
  const wrapper = mount(TourModal, {
    props: { modelValue: true, ...handlers },
    attachTo: document.getElementById('app')!,
    global: { plugins: [router] }
  });
  mounted = wrapper;
  await nextTick();
  return handlers;
}

describe('TourModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('moves forward and back between cards', async () => {
    await mountOpen();
    expect(title()).toBe('Workspaces');
    expect(document.body.querySelector('.tour__back')).toBeNull();

    await click('.tour__next');
    expect(title()).toBe('Sessions and agents');

    await click('.tour__back');
    expect(title()).toBe('Workspaces');
  });

  it('moves between cards with the arrow keys', async () => {
    await mountOpen();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await nextTick();
    expect(title()).toBe('Sessions and agents');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(title()).toBe('Workspaces');
  });

  it('emits done from Done on the last card', async () => {
    const handlers = await mountOpen();
    await click('.tour__next');
    await click('.tour__next');
    await click('.tour__next');
    expect(title()).toBe('Search and shortcuts');
    expect(document.body.querySelector('.tour__skip')).toBeNull();
    expect(document.body.querySelector('.tour__next')).toBeNull();

    await click('.tour__done');
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onSkip).not.toHaveBeenCalled();
    expect(handlers['onUpdate:modelValue']).toHaveBeenCalledWith(false);
  });

  it('emits skip from Skip', async () => {
    const handlers = await mountOpen();
    await click('.tour__skip');
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('emits addWorkspace from the first card action', async () => {
    const handlers = await mountOpen();
    await click('.tour__action');
    expect(handlers.onAddWorkspace).toHaveBeenCalledTimes(1);
  });
});
