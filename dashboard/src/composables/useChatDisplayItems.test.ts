// @vitest-environment jsdom

// node_modules
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

// composables
import { useChatDisplayItems } from '@/composables/useChatDisplayItems';

// types
import type { ChatMessage } from '@/@types/index';
import type { DisplayItem } from '@/utils/chatDisplayItems';

const planEvent = JSON.stringify({
  sessionId: 's1',
  update: {
    sessionUpdate: 'plan',
    entries: [{ content: 'Do it', status: 'pending', priority: 'medium' }]
  }
});

const user = (content: string, createdAt: string): ChatMessage => ({
  role: 'user',
  content,
  createdAt
});
const assistantWithPlan = (createdAt: string): ChatMessage => ({
  role: 'assistant',
  events: [planEvent],
  createdAt
});

describe('useChatDisplayItems', () => {
  it('keeps row keys and plan ids stable when older messages are prepended', () => {
    const messages = ref<ChatMessage[]>([user('q', 't2'), assistantWithPlan('t3')]);
    const { displayMessages } = useChatDisplayItems({
      messages,
      streamingItems: ref<DisplayItem[]>([])
    });
    const keysBefore = displayMessages.value.map((entry) => entry.key);
    const planIdBefore = displayMessages.value[1]?.items.find(
      (item) => item.kind === 'plan'
    )?.planId;
    expect(planIdBefore).toBeTruthy();

    messages.value = [user('older', 't0'), assistantWithPlan('t1'), ...messages.value];

    const after = displayMessages.value;
    expect(after.slice(2).map((entry) => entry.key)).toEqual(keysBefore);
    expect(after[3]?.items.find((item) => item.kind === 'plan')?.planId).toBe(planIdBefore);
    expect(after[1]?.items.find((item) => item.kind === 'plan')?.planId).not.toBe(planIdBefore);
  });

  it('keeps the row key when prompt-started rewrites an optimistic createdAt', () => {
    const messages = ref<ChatMessage[]>([user('go', 'local')]);
    const { displayMessages } = useChatDisplayItems({
      messages,
      streamingItems: ref<DisplayItem[]>([])
    });
    const keyBefore = displayMessages.value[0]?.key;

    messages.value[0].createdAt = 'server';

    expect(displayMessages.value[0]?.key).toBe(keyBefore);
  });
});
