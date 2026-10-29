/**
 * Find in chat: query/match state, Ctrl/Cmd+F capture and scrolling the
 * current match into view.
 * Extracted from ChatMessageList.vue.
 */

// node_modules
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

// composables
import type { DisplayChatMessage } from '@/composables/useChatDisplayItems';

// utils
import { isToolCallDisplayItem } from '@/utils/chatDisplayItems';

// -------------------------------------------------- Types --------------------------------------------------

interface ChatFindSource {
  bActive?: boolean;
  displayMessages: DisplayChatMessage[];
  hideToolCalls: boolean;
}

export interface UseChatFindOptions {
  /** Reactive source (component props) */
  source: ChatFindSource;
  /** Scroll container holding the `[data-find-key]` message rows */
  containerEl: Ref<HTMLElement | null>;
  /** Focus and select the find input */
  focusInput: () => void;
}

// -------------------------------------------------- Constants --------------------------------------------------

const FIND_EVENT = 'novacode:find-in-chat';

// -------------------------------------------------- Helpers --------------------------------------------------

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

export function useChatFind(options: UseChatFindOptions) {
  const props = options.source;

  const bFindOpen = ref(false);
  const findQuery = ref('');
  const findMatchIndex = ref(0);

  function displayMessageSearchText(entry: DisplayChatMessage): string {
    const parts = [entry.msg.content ?? ''];
    for (const item of entry.items) {
      if (props.hideToolCalls && isToolCallDisplayItem(item)) {
        continue;
      }
      if (item.text) {
        parts.push(item.text);
      }
      if (item.toolName) {
        parts.push(item.toolName);
      }
      if (item.toolSummary) {
        parts.push(item.toolSummary);
      }
    }
    return parts.join('\n').toLowerCase();
  }

  const findMatchKeys = computed((): string[] => {
    const query = findQuery.value.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return props.displayMessages
      .filter((entry) => displayMessageSearchText(entry).includes(query))
      .map((entry) => entry.key);
  });

  watch(findMatchKeys, (keys) => {
    if (keys.length === 0) {
      findMatchIndex.value = 0;
      return;
    }
    if (findMatchIndex.value >= keys.length) {
      findMatchIndex.value = 0;
    }
    scrollFindMatchIntoView();
  });

  function scrollFindMatchIntoView(): void {
    const key = findMatchKeys.value[findMatchIndex.value];
    if (!key) {
      return;
    }
    void nextTick(() => {
      const el = options.containerEl.value?.querySelector(`[data-find-key="${cssEscape(key)}"]`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center' });
      }
    });
  }

  function stepFindMatch(delta: number): void {
    const count = findMatchKeys.value.length;
    if (count === 0) {
      return;
    }
    findMatchIndex.value = (findMatchIndex.value + delta + count) % count;
    scrollFindMatchIntoView();
  }

  async function openFind(): Promise<void> {
    if (bFindOpen.value && findQuery.value.trim()) {
      stepFindMatch(1);
      return;
    }
    bFindOpen.value = true;
    await nextTick();
    options.focusInput();
  }

  function closeFind(): void {
    bFindOpen.value = false;
    findQuery.value = '';
    findMatchIndex.value = 0;
  }

  function onFindKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      stepFindMatch(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
    }
  }

  function onWindowFindKeydown(event: KeyboardEvent): void {
    if (!props.bActive) return;
    if (event.key === 'Escape' && bFindOpen.value) {
      event.preventDefault();
      closeFind();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') {
      return;
    }
    event.preventDefault();
    void openFind();
  }

  function onFindEvent(): void {
    void openFind();
  }

  onMounted(() => {
    window.addEventListener('keydown', onWindowFindKeydown);
    window.addEventListener(FIND_EVENT, onFindEvent);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onWindowFindKeydown);
    window.removeEventListener(FIND_EVENT, onFindEvent);
  });

  return {
    bFindOpen,
    findQuery,
    findMatchIndex,
    findMatchKeys,
    stepFindMatch,
    openFind,
    closeFind,
    onFindKeydown
  };
}
