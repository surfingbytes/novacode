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
      streamingThinkingText: '',
      streamingUsage: null,
      bIsStreaming: false,
      bHasMore: false,
      bLoadingMore: false,
      chatError: null,
      chatErrorActionLabel: '',
      hideThinkingOutput: false,
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

  it('stops the skeleton when the socket failed (error shown instead)', () => {
    const wrapper = mountList({ bHistoryLoaded: false, chatError: 'Connection closed (auth)' });
    expect(wrapper.text()).not.toContain('Start the conversation below.');
    expect(wrapper.text()).toContain('Connection closed (auth)');
  });
});
