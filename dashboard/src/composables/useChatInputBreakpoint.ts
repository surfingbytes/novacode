/**
 * Tracks the composer's md breakpoint (min-width: 768px) via a media query.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { onMounted, onUnmounted, ref } from 'vue';

const CHAT_INPUT_MD_QUERY = '(min-width: 768px)';

export function useChatInputBreakpoint() {
  // -------------------------------------------------- Refs --------------------------------------------------
  const bChatInputMdUp = ref(false);
  let chatInputMql: MediaQueryList | null = null;

  // -------------------------------------------------- Methods --------------------------------------------------
  function syncChatInputBreakpoint(): void {
    bChatInputMdUp.value = chatInputMql?.matches ?? window.matchMedia(CHAT_INPUT_MD_QUERY).matches;
  }

  // -------------------------------------------------- Lifecycle --------------------------------------------------
  onMounted(() => {
    chatInputMql = window.matchMedia(CHAT_INPUT_MD_QUERY);
    syncChatInputBreakpoint();
    chatInputMql.addEventListener('change', syncChatInputBreakpoint);
  });

  onUnmounted(() => {
    if (chatInputMql) {
      chatInputMql.removeEventListener('change', syncChatInputBreakpoint);
      chatInputMql = null;
    }
  });

  return {
    // data
    bChatInputMdUp
  };
}

export type UseChatInputBreakpoint = ReturnType<typeof useChatInputBreakpoint>;
