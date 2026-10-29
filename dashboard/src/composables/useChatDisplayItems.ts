/**
 * Chat display items — history messages and live streaming items prepared for rendering.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, type Ref } from 'vue';

// utils
import {
  parseHistoryEventsCached,
  prepareDisplayItem,
  renderMdCached,
  type DisplayItem
} from '@/utils/chatDisplayItems';

// types
import type { ChatMessage } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface DisplayChatMessage {
  msg: ChatMessage;
  key: string;
  items: DisplayItem[];
  fallbackHtml: string;
}

export interface UseChatDisplayItemsOptions {
  messages: Ref<ChatMessage[]>;
  streamingItems: Ref<DisplayItem[]>;
}

export function useChatDisplayItems(options: UseChatDisplayItemsOptions) {
  // -------------------------------------------------- Computed --------------------------------------------------
  const displayMessages = computed<DisplayChatMessage[]>(() =>
    options.messages.value.map((msg, index) => {
      const items =
        msg.role === 'assistant'
          ? parseHistoryEventsCached(msg.events ?? []).map(prepareDisplayItem)
          : [];
      let planIndex = 0;
      for (const item of items) {
        if (item.kind !== 'plan') continue;
        item.planId = `${msg.createdAt}-${index}-plan-${planIndex}`;
        planIndex += 1;
      }
      return {
        msg,
        key: `${msg.createdAt}-${index}`,
        items,
        fallbackHtml: items.length === 0 && msg.content ? renderMdCached(msg.content) : ''
      };
    })
  );

  const streamingDisplayItems = computed(() => {
    const items = options.streamingItems.value.map(prepareDisplayItem);
    let planIndex = 0;
    for (const item of items) {
      if (item.kind !== 'plan') continue;
      item.planId = `live-plan-${planIndex}`;
      planIndex += 1;
    }
    return items;
  });

  return {
    // data
    displayMessages,
    streamingDisplayItems
  };
}
