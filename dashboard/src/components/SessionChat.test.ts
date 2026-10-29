// @vitest-environment jsdom

// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// classes
import { http } from '@/classes/api';

// test helpers
import { FakeWebSocket } from '@/test/fakeWebSocket';

const { loaded, route, router } = vi.hoisted(() => ({
  /** Lazy tab modules that have been imported so far. */
  loaded: new Set<string>(),
  route: { query: {} },
  router: { replace: () => Promise.resolve(), push: () => Promise.resolve() }
}));

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
  useRouter: () => router
}));

function lazyStub(name: string) {
  loaded.add(name);
  // `__esModule` makes defineAsyncComponent unwrap `default` from the mocked module.
  return {
    __esModule: true,
    default: defineComponent({
      name: `${name}Stub`,
      setup: () => () => h('div', { 'data-test': name })
    })
  };
}

vi.mock('@/components/workspace/FilesComponent.vue', () => lazyStub('files'));
vi.mock('@/components/workspace/GitView.vue', () => lazyStub('git'));
vi.mock('@/components/AppTerminal.vue', () => lazyStub('terminal'));

// Eager children are irrelevant here; render them as empty stubs exposing the
// methods SessionChat calls through template refs.
function emptyStub(exposed: string[] = []) {
  return {
    default: defineComponent({
      setup(_props, { expose }) {
        expose(Object.fromEntries(exposed.map((name) => [name, () => {}])));
        return () => null;
      }
    })
  };
}

vi.mock('@/components/OrchestratorPanel.vue', () => emptyStub());
vi.mock('@/components/ClaudeLimitPopup.vue', () => emptyStub());
vi.mock('@/components/chat/ChatHandoffBanner.vue', () => emptyStub());
vi.mock('@/components/chat/ChatMessageList.vue', () =>
  emptyStub(['forceInitialScrollToBottom', 'notifyHistoryPage'])
);
vi.mock('@/components/chat/ChatComposer.vue', () =>
  emptyStub(['focus', 'observePromptInputBox', 'resizeTextarea'])
);
vi.mock('@/components/chat/ChatStatusRows.vue', () => emptyStub());
vi.mock('@/components/chat/ChatTodoPanel.vue', () => emptyStub());
vi.mock('@/components/chat/SessionChatHeader.vue', () => emptyStub());
vi.mock('@/components/chat/SessionChatModals.vue', () => emptyStub());
vi.mock('@/components/chat/SessionPlanTab.vue', () => emptyStub());
vi.mock('@/components/chat/ImageLightbox.vue', () => emptyStub());

// components
import SessionChat from '@/components/SessionChat.vue';

let wrapper: VueWrapper | null = null;
const originalAdapter = http.defaults.adapter;

beforeEach(() => {
  loaded.clear();
  route.query = reactive({});
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  );
  // REST calls stay pending: this test is only about tab mounting.
  http.defaults.adapter = () => new Promise(() => {});
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  http.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

async function mountChat(): Promise<VueWrapper> {
  wrapper = mount(SessionChat, {
    props: { workspaceId: 'w1', sessionId: 's1', viewportHeight: null }
  });
  await flushPromises();
  return wrapper;
}

async function selectTab(w: VueWrapper, label: string): Promise<void> {
  const tab = w.findAll('[role="tab"]').find((el) => el.text() === label);
  if (!tab) throw new Error(`tab ${label} not found`);
  await tab.trigger('click');
  // Async component: resolve the import, then render.
  await flushPromises();
  await flushPromises();
}

describe('SessionChat tabs', () => {
  it('does not load Files, Git or Terminal while the chat tab is active', async () => {
    const w = await mountChat();

    expect(loaded.size).toBe(0);
    expect(w.find('[data-test="files"]').exists()).toBe(false);
    expect(w.find('[data-test="git"]').exists()).toBe(false);
    expect(w.find('[data-test="terminal"]').exists()).toBe(false);
  });

  it('loads and mounts only the selected tab component', async () => {
    const w = await mountChat();

    await selectTab(w, 'Git');
    expect([...loaded]).toEqual(['git']);
    expect(w.find('[data-test="git"]').exists()).toBe(true);
    expect(w.find('[data-test="files"]').exists()).toBe(false);

    await selectTab(w, 'Files');
    expect(loaded.has('terminal')).toBe(false);
    expect(w.find('[data-test="files"]').exists()).toBe(true);
    expect(w.find('[data-test="git"]').exists()).toBe(false);

    await selectTab(w, 'Terminal');
    expect(w.find('[data-test="terminal"]').exists()).toBe(true);
    expect(w.find('[data-test="files"]').exists()).toBe(false);

    await selectTab(w, 'Chat');
    expect(w.find('[data-test="terminal"]').exists()).toBe(false);
  });
});
