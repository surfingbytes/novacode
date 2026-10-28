/**
 * Action button on the chat error banner (open settings / retry the last prompt).
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, type Ref } from 'vue';
import type { Router } from 'vue-router';

// types
import type { AgentErrorCode } from '@/classes/api';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseChatErrorActionOptions {
  chatErrorCode: Ref<AgentErrorCode | null>;
  lastPromptRequest: Ref<unknown>;
  retryLastPrompt: (model: string) => void;
  modelSelection: Ref<string>;
  router: Router;
}

export function useChatErrorAction(options: UseChatErrorActionOptions) {
  const { chatErrorCode } = options;

  // -------------------------------------------------- Computed --------------------------------------------------
  const chatErrorActionLabel = computed(() => {
    if (chatErrorCode.value === 'auth_required') return 'Open Settings';
    if (
      (chatErrorCode.value === 'timeout' || chatErrorCode.value === 'rate_limited') &&
      options.lastPromptRequest.value
    ) {
      return 'Try again';
    }
    return '';
  });

  // -------------------------------------------------- Methods --------------------------------------------------
  function handleChatErrorAction(): void {
    if (chatErrorCode.value === 'auth_required') {
      options.router.push({ name: 'settings' });
      return;
    }
    if (chatErrorCode.value === 'timeout' || chatErrorCode.value === 'rate_limited') {
      options.retryLastPrompt(options.modelSelection.value);
    }
  }

  return {
    // data
    chatErrorActionLabel,
    // methods
    handleChatErrorAction
  };
}

export type UseChatErrorAction = ReturnType<typeof useChatErrorAction>;
