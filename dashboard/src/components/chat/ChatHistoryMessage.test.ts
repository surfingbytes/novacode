// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// components
import ChatHistoryMessage from '@/components/chat/ChatHistoryMessage.vue';

// composables
import type { DisplayChatMessage } from '@/composables/useChatDisplayItems';

// -------------------------------------------------- Helpers --------------------------------------------------

function mountMessage(entry: DisplayChatMessage, onEdit: (text: string) => void) {
  return mount(ChatHistoryMessage, {
    props: {
      entry,
      onEdit,
      userInitial: 'U',
      agentInitial: 'C',
      agentDisplayName: 'Claude',
      hideToolCalls: false,
      expandedToolOutputIds: new Set<string>(),
      bFindMatch: false,
      bCopied: false
    }
  });
}

describe('ChatHistoryMessage edit button', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('emits edit with the raw text for user messages', async () => {
    const onEdit = vi.fn();
    const wrapper = mountMessage(
      {
        msg: { role: 'user', content: 'fix the **build**', createdAt: '1' },
        key: '1-0',
        items: [],
        fallbackHtml: ''
      },
      onEdit
    );
    await wrapper.get('button[aria-label="Edit message"]').trigger('click');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('fix the **build**');
  });

  it('has no edit button for assistant messages', () => {
    const onEdit = vi.fn();
    const wrapper = mountMessage(
      {
        msg: { role: 'assistant', content: 'done', createdAt: '1' },
        key: '1-1',
        items: [],
        fallbackHtml: ''
      },
      onEdit
    );
    expect(wrapper.find('button[aria-label="Edit message"]').exists()).toBe(false);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
