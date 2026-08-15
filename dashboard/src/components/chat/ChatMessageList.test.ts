// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// components
import ChatMessageList from '@/components/chat/ChatMessageList.vue';

// -------------------------------------------------- Helpers --------------------------------------------------

function mountList(overrides: Record<string, unknown> = {}) {
  return mount(ChatMessageList, {
    props: {
      bLoading: false,
      bHistoryLoaded: true,
      displayMessages: [],
      streamingDisplayItems: [],
      pendingApprovals: [],
      pendingQuestions: [],
      streamingThinkingText: '',
      streamingUsage: null,
      bIsStreaming: false,
      bHasMore: false,
      bLoadingMore: false,
      chatError: null,
      chatErrorActionLabel: '',
      hideThinkingOutput: false,
      hideToolCalls: false,
      expandedToolOutputIds: new Set<string>(),
      ...overrides
    }
  });
}

describe('ChatMessageList loading states', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('keeps the skeleton while the first history frame is in flight', () => {
    const wrapper = mountList({ bHistoryLoaded: false });
    expect(wrapper.find('.animate-pulse').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Start the conversation below.');
  });

  it('shows the empty state only after history has loaded', () => {
    const wrapper = mountList({ bHistoryLoaded: true });
    expect(wrapper.find('.animate-pulse').exists()).toBe(false);
    expect(wrapper.text()).toContain('Start the conversation below.');
  });

  it('opens find and counts matching messages', async () => {
    const wrapper = mountList({
      displayMessages: [
        {
          msg: { role: 'user', content: 'hello world', createdAt: '1' },
          key: '1-0',
          items: [],
          fallbackHtml: ''
        },
        {
          msg: { role: 'assistant', content: '', createdAt: '2' },
          key: '2-1',
          items: [{ kind: 'text', text: 'goodbye' }],
          fallbackHtml: ''
        }
      ]
    });
    wrapper.vm.openFind();
    await wrapper.vm.$nextTick();
    const input = wrapper.get('input[aria-label="Find in conversation"]');
    await input.setValue('hello');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1/1');
  });

  it('hides tool-call cards when hideToolCalls is on', () => {
    const wrapper = mountList({
      hideToolCalls: true,
      displayMessages: [
        {
          msg: { role: 'assistant', content: '', createdAt: '1' },
          key: '1-0',
          items: [
            { kind: 'text', text: 'hello', renderedHtml: 'hello' },
            { kind: 'tool', toolName: 'Read', toolSummary: 'src/app.ts' },
            { kind: 'todos', todoItems: [{ id: 't1', content: 'do it', status: 'pending' }], todoDoneCount: 0 }
          ],
          fallbackHtml: ''
        }
      ]
    });
    expect(wrapper.text()).toContain('hello');
    expect(wrapper.text()).not.toContain('Read');
    expect(wrapper.text()).not.toContain('Todos');
    expect(wrapper.text()).not.toContain('src/app.ts');
  });

  it('excludes hidden tool calls from find matches', async () => {
    const wrapper = mountList({
      hideToolCalls: true,
      displayMessages: [
        {
          msg: { role: 'assistant', content: '', createdAt: '1' },
          key: '1-0',
          items: [{ kind: 'tool', toolName: 'Read', toolSummary: 'unique-tool-path.ts' }],
          fallbackHtml: ''
        },
        {
          msg: { role: 'user', content: 'unique-tool-path.ts please', createdAt: '2' },
          key: '2-1',
          items: [],
          fallbackHtml: ''
        }
      ]
    });
    wrapper.vm.openFind();
    await wrapper.vm.$nextTick();
    const input = wrapper.get('input[aria-label="Find in conversation"]');
    await input.setValue('unique-tool-path');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1/1');
  });
});
