/**
 * Chat display items — history messages and live streaming items prepared for rendering.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, toRaw, type Ref } from 'vue';

// utils
import {
  parseHistoryEventsCached,
  prepareDisplayItem,
  prepareLiveDisplayItem,
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
  /**
   * Client row ids kept per message object: survive older pages being prepended
   * and `prompt-started` rewriting an optimistic turn's createdAt.
   */
  const rowKeys = new WeakMap<ChatMessage, string>();
  let nextRowKey = 0;

  function rowKeyFor(msg: ChatMessage): string {
    const raw = toRaw(msg);
    let key = rowKeys.get(raw);
    if (!key) {
      nextRowKey += 1;
      key = `msg-${nextRowKey}`;
      rowKeys.set(raw, key);
    }
    return key;
  }

  // -------------------------------------------------- Computed --------------------------------------------------
  const displayMessages = computed<DisplayChatMessage[]>(() => {
    // Plan ids come from the message's own createdAt (plus an ordinal for equal
    // timestamps) so they match across load-more and history re-sends.
    const createdAtSeen = new Map<string, number>();
    return options.messages.value.map((msg) => {
      const items =
        msg.role === 'assistant'
          ? parseHistoryEventsCached(msg.events ?? []).map(prepareDisplayItem)
          : [];
      const ordinal = createdAtSeen.get(msg.createdAt) ?? 0;
      createdAtSeen.set(msg.createdAt, ordinal + 1);
      const planPrefix = ordinal === 0 ? msg.createdAt : `${msg.createdAt}~${ordinal}`;
      let planIndex = 0;
      for (const item of items) {
        if (item.kind !== 'plan') continue;
        item.planId = `${planPrefix}-plan-${planIndex}`;
        planIndex += 1;
      }
      return {
        msg,
        key: rowKeyFor(msg),
        items,
        fallbackHtml: items.length === 0 && msg.content ? renderMdCached(msg.content) : ''
      };
    });
  });

  const streamingDisplayItems = computed(() => {
    const items = options.streamingItems.value.map(prepareLiveDisplayItem);
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
