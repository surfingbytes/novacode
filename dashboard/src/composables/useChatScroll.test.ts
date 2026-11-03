// @vitest-environment jsdom

// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

// composables
import { useChatScroll } from '@/composables/useChatScroll';

const SCROLL_HEIGHT = 5000;
const CLIENT_HEIGHT = 500;
const BOTTOM = SCROLL_HEIGHT - CLIENT_HEIGHT;

function makeSource() {
  return reactive({
    displayMessages: [{}] as unknown[],
    streamingDisplayItems: [] as { kind: string; status?: string }[],
    pendingApprovals: [],
    pendingQuestions: [],
    streamingThinkingText: '',
    hideThinkingOutput: false,
    chatError: null as string | null,
    bHasMore: false,
    bLoadingMore: false,
    viewportHeight: 800
  });
}

function mountHarness(source: ReturnType<typeof makeSource>) {
  let api!: ReturnType<typeof useChatScroll>;
  const Harness = defineComponent({
    setup() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api = useChatScroll({ source: source as any, onLoadOlder: () => {} });
      return () =>
        h('div', { ref: api.messagesEl, onScroll: api.onMessagesScroll }, [
          h('div', { ref: api.messagesContentEl }),
          h('div', { ref: api.messagesScrollAnchor })
        ]);
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body });
  const el = wrapper.element as HTMLElement;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
  // jsdom has no layout: model scrollIntoView on the bottom anchor as a jump to the bottom.
  (api.messagesScrollAnchor.value as HTMLElement).scrollIntoView = () => {
    el.scrollTop = BOTTOM;
    el.dispatchEvent(new Event('scroll'));
  };
  return { wrapper, el, api };
}

function userScrollTo(el: HTMLElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
}

describe('useChatScroll', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    // Let the 150ms ignore window and rAF-based layout waits pass.
    vi.advanceTimersByTime(500);
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushPromises();
  }

  it('stays unpinned after a small upward scroll while a response streams', async () => {
    const source = makeSource();
    const h = mountHarness(source);
    wrapper = h.wrapper;
    userScrollTo(h.el, BOTTOM);
    await settle();

    // First frame of a smooth wheel scroll: only 10px up, still inside the 80px threshold.
    userScrollTo(h.el, BOTTOM - 10);
    expect(h.api.bShowScrollToBottom.value).toBe(true);

    // A new streamed item arrives: the view must not snap back to the bottom.
    source.streamingDisplayItems.push({ kind: 'text' });
    await nextTick();
    await settle();
    expect(h.el.scrollTop).toBe(BOTTOM - 10);
  });

  it('re-pins when the user scrolls back down to the bottom', async () => {
    const source = makeSource();
    const h = mountHarness(source);
    wrapper = h.wrapper;
    userScrollTo(h.el, BOTTOM);
    await settle();

    userScrollTo(h.el, BOTTOM - 1000);
    userScrollTo(h.el, BOTTOM - 20);
    expect(h.api.bShowScrollToBottom.value).toBe(false);

    source.streamingDisplayItems.push({ kind: 'text' });
    await nextTick();
    await settle();
    expect(h.el.scrollTop).toBe(BOTTOM);
  });

  it('does not jump to the bottom on a viewport resize while scrolled up', async () => {
    const source = makeSource();
    const h = mountHarness(source);
    wrapper = h.wrapper;
    userScrollTo(h.el, BOTTOM);
    await settle();

    userScrollTo(h.el, 1000);
    // Mobile URL bar hides during the scroll and resizes the visual viewport.
    source.viewportHeight = 860;
    await nextTick();
    await settle();
    expect(h.el.scrollTop).toBe(1000);
  });
});
