<script setup lang="ts">
/**
 * Chat scroll container: history messages, live stream, thinking box, usage
 * meter, inline error, and all scroll management (pinned-bottom follow,
 * load-more on scroll-to-top, history-page scroll restore).
 * Extracted from SessionChat.vue; message markup follows the design handoff
 * (avatar square + mono name/age caption + flat bubble). Rows, request cards,
 * find bar and scroll/find/response state live in sibling components and
 * composables.
 */

// node_modules
import { computed, onUnmounted, ref } from 'vue';

// components
import ChatDisplayItems from '@/components/chat/ChatDisplayItems.vue';
import ChatFindBar from '@/components/chat/ChatFindBar.vue';
import ChatHistoryMessage from '@/components/chat/ChatHistoryMessage.vue';
import ChatMessageRow from '@/components/chat/ChatMessageRow.vue';
import ChatPendingRequests from '@/components/chat/ChatPendingRequests.vue';
import ChatThinkingStream from '@/components/chat/ChatThinkingStream.vue';
import ChatUsageMeter from '@/components/chat/ChatUsageMeter.vue';

// composables
import type { DisplayChatMessage } from '@/composables/useChatDisplayItems';
import { useChatFind } from '@/composables/useChatFind';
import { useChatRequestResponses } from '@/composables/useChatRequestResponses';
import { useChatScroll } from '@/composables/useChatScroll';

// stores
import { useToastStore } from '@/stores/toasts';

// utils
import { agentTypeShortLabel } from '@/utils/agentTypeMeta';
import { handleChatMarkdownClick } from '@/utils/chatMarkdownClick';
import {
  isToolCallDisplayItem,
  type DisplayItem,
  type StreamUsage
} from '@/utils/chatDisplayItems';

// types
import type {
  AgentType,
  ChatApprovalRequest,
  ChatQuestionAnswer,
  ChatQuestionRequest,
  SessionUsageTurn
} from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    /** False while another session tab is shown (pane stays mounted via v-show); disables Ctrl/Cmd+F capture */
    bActive?: boolean;
    bLoading: boolean;
    /** False while the first chat history frame is still in flight */
    bHistoryLoaded: boolean;
    displayMessages: DisplayChatMessage[];
    streamingDisplayItems: DisplayItem[];
    pendingApprovals: ChatApprovalRequest[];
    pendingQuestions: ChatQuestionRequest[];
    streamingThinkingText: string;
    streamingUsage: StreamUsage | null;
    usageTurns?: SessionUsageTurn[];
    bIsStreaming: boolean;
    bHasMore: boolean;
    bLoadingMore: boolean;
    chatError: string | null;
    chatErrorActionLabel: string;
    hideThinkingOutput: boolean;
    hideToolCalls: boolean;
    expandedToolOutputIds: Set<string>;
    agentType?: AgentType | null;
    userName?: string | null;
    viewportHeight?: number | null;
    /** Returns false when the socket is down and nothing was sent */
    sendApprovalResponse?: (approvalRequestId: string, approvalOptionId: string) => boolean;
    sendQuestionResponse?: (
      questionRequestId: string,
      payload: { skipped: true } | { answers: ChatQuestionAnswer[] }
    ) => boolean;
  }>(),
  {
    agentType: null,
    userName: null,
    viewportHeight: null,
    usageTurns: () => [],
    hideToolCalls: false,
    bActive: true,
    sendApprovalResponse: () => false,
    sendQuestionResponse: () => false
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'loadOlder'): void;
  (e: 'toggleToolOutput', callId: string): void;
  (e: 'openPlan', planId: string | undefined): void;
  (e: 'openFile', path: string): void;
  (e: 'lightbox', src: string): void;
  (e: 'chatErrorAction'): void;
}>();

const toasts = useToastStore();

// -------------------------------------------------- Composables --------------------------------------------------

const {
  messagesEl,
  messagesContentEl,
  messagesScrollAnchor,
  bShowScrollToBottom,
  onMessagesScroll,
  scrollToBottom,
  notifyHistoryPage,
  forceInitialScrollToBottom
} = useChatScroll({ source: props, onLoadOlder: () => emit('loadOlder') });

const findBarRef = ref<InstanceType<typeof ChatFindBar>>();

const {
  bFindOpen,
  findQuery,
  findMatchIndex,
  findMatchKeys,
  stepFindMatch,
  openFind,
  closeFind,
  onFindKeydown
} = useChatFind({
  source: props,
  containerEl: messagesEl,
  focusInput: () => findBarRef.value?.focusInput()
});

const {
  questionSelections,
  pendingResponseIds,
  toggleQuestionOption,
  submitQuestion,
  skipQuestion,
  respondToApproval
} = useChatRequestResponses(props);

// -------------------------------------------------- Computed --------------------------------------------------

const agentInitial = computed(() => {
  const label = agentTypeShortLabel(props.agentType ?? '') || 'a';
  return label.charAt(0).toUpperCase();
});

const agentDisplayName = computed(() => agentTypeShortLabel(props.agentType ?? '') || 'agent');

const visibleStreamingDisplayItems = computed(() =>
  props.hideToolCalls
    ? props.streamingDisplayItems.filter((item) => !isToolCallDisplayItem(item))
    : props.streamingDisplayItems
);

const userInitial = computed(() => {
  const name = props.userName ?? '';
  return name.charAt(0).toUpperCase() || 'U';
});

// -------------------------------------------------- Markdown clicks --------------------------------------------------

function onChatMarkdownClick(e: MouseEvent): void {
  handleChatMarkdownClick(e, (src) => emit('lightbox', src));
}

// -------------------------------------------------- Copy whole message --------------------------------------------------

const copiedMessageKey = ref<string | null>(null);
let copiedMessageTimer: number | undefined;

async function copyMessageText(key: string, text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    toasts.error('Clipboard is not available');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toasts.error('Could not copy message');
    return;
  }
  copiedMessageKey.value = key;
  window.clearTimeout(copiedMessageTimer);
  copiedMessageTimer = window.setTimeout(() => {
    copiedMessageKey.value = null;
  }, 1500);
}

onUnmounted(() => {
  window.clearTimeout(copiedMessageTimer);
});

defineExpose({
  scrollToBottom,
  notifyHistoryPage,
  forceInitialScrollToBottom,
  openFind
});
</script>

<template>
  <div class="flex-1 overflow-hidden flex flex-col min-h-0">
    <ChatFindBar
      v-if="bFindOpen"
      ref="findBarRef"
      v-model:query="findQuery"
      :match-index="findMatchIndex"
      :match-count="findMatchKeys.length"
      @keydown="onFindKeydown"
      @step="stepFindMatch"
      @close="closeFind"
    />
    <!-- Messages -->
    <div class="relative flex-1 min-h-0">
    <div
      ref="messagesEl"
      class="h-full overflow-y-auto px-4 md:px-6 py-4 [overflow-anchor:none]"
      @scroll="onMessagesScroll"
    >
      <div ref="messagesContentEl" class="min-h-full space-y-4">
      <!-- Chat skeleton -->
      <template v-if="bLoading || (!bHistoryLoaded && !chatError)">
        <div class="space-y-4">
          <div class="flex gap-2.5">
            <div class="w-[26px] h-[26px] rounded-md bg-fg/10 animate-pulse shrink-0" />
            <div class="h-16 flex-1 max-w-md rounded-lg bg-fg/10 animate-pulse" />
          </div>
          <div class="flex gap-2.5">
            <div class="w-[26px] h-[26px] rounded-md bg-fg/10 animate-pulse shrink-0" />
            <div class="h-10 flex-1 max-w-sm rounded-lg bg-fg/10 animate-pulse" />
          </div>
          <div class="flex gap-2.5">
            <div class="w-[26px] h-[26px] rounded-md bg-fg/10 animate-pulse shrink-0" />
            <div class="h-12 flex-1 max-w-lg rounded-lg bg-fg/10 animate-pulse" />
          </div>
        </div>
      </template>
      <template v-else>
        <!-- Load more -->
        <div v-if="bLoadingMore" class="flex justify-center py-2">
          <div class="w-5 h-5 border-2 border-surface border-t-primary rounded-full animate-spin"></div>
        </div>
        <div v-else-if="bHasMore" class="flex justify-center py-2">
          <button
            class="text-xs text-text-muted hover:text-text-primary transition-colors"
            @click="emit('loadOlder')"
          >
            Load older messages
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-if="bHistoryLoaded && displayMessages.length === 0 && !bIsStreaming && !bLoadingMore"
          class="h-full flex items-center justify-center"
        >
          <p class="text-sm text-text-muted">Start the conversation below.</p>
        </div>

        <!-- History messages -->
        <ChatHistoryMessage
          v-for="entry in displayMessages"
          :key="entry.key"
          :entry="entry"
          :agent-type="agentType"
          :user-name="userName"
          :user-initial="userInitial"
          :agent-initial="agentInitial"
          :agent-display-name="agentDisplayName"
          :hide-tool-calls="hideToolCalls"
          :expanded-tool-output-ids="expandedToolOutputIds"
          :b-find-match="findMatchKeys[findMatchIndex] === entry.key"
          :b-copied="copiedMessageKey === entry.key"
          @copy="(text) => copyMessageText(entry.key, text)"
          @toggle-tool-output="(callId) => emit('toggleToolOutput', callId)"
          @open-plan="(planId) => emit('openPlan', planId)"
          @open-file="(path) => emit('openFile', path)"
          @lightbox="(src) => emit('lightbox', src)"
        />

        <!-- Live streaming turn -->
        <ChatMessageRow
          v-if="bIsStreaming"
          :avatar-variant="agentType ?? 'agent'"
          :initial="agentInitial"
          :name="agentDisplayName"
          age="now"
        >
          <ChatDisplayItems
            :items="streamingDisplayItems"
            :b-live="true"
            :hide-tool-calls="hideToolCalls"
            :expanded-tool-output-ids="expandedToolOutputIds"
            @toggle-tool-output="(callId) => emit('toggleToolOutput', callId)"
            @open-plan="(planId) => emit('openPlan', planId)"
            @open-file="(path) => emit('openFile', path)"
            @markdown-click="onChatMarkdownClick"
          />

          <ChatPendingRequests
            :pending-approvals="pendingApprovals"
            :pending-questions="pendingQuestions"
            :question-selections="questionSelections"
            :pending-response-ids="pendingResponseIds"
            @respond-approval="respondToApproval"
            @toggle-question-option="toggleQuestionOption"
            @submit-question="submitQuestion"
            @skip-question="skipQuestion"
          />

          <!-- Token usage meter -->
          <ChatUsageMeter
            v-if="streamingUsage || usageTurns.length > 0"
            :streaming-usage="streamingUsage"
            :usage-turns="usageTurns"
          />

          <!-- Model thinking stream -->
          <ChatThinkingStream
            v-if="streamingThinkingText.trim() && !hideThinkingOutput"
            :text="streamingThinkingText"
          />

          <!-- Thinking indicator (no streamed content yet) -->
          <div
            v-if="visibleStreamingDisplayItems.length === 0 && (!streamingThinkingText.trim() || hideThinkingOutput)"
            class="flex justify-start"
          >
            <div class="chat-bubble px-3.5 py-3 rounded-lg">
              <span class="inline-flex items-center gap-1 text-text-muted">
                <span class="animate-pulse text-sm">●</span>
                <span class="animate-pulse text-sm" style="animation-delay: 0.2s">●</span>
                <span class="animate-pulse text-sm" style="animation-delay: 0.4s">●</span>
              </span>
            </div>
          </div>
        </ChatMessageRow>

        <!-- Inline chat error -->
        <div v-if="chatError" class="flex justify-center">
          <div
            class="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 px-3 py-1.5 rounded-lg"
          >
            <span>{{ chatError }}</span>
            <button
              v-if="chatErrorActionLabel"
              type="button"
              class="text-xs font-medium underline underline-offset-2 hover:text-destructive/80"
              @click="emit('chatErrorAction')"
            >
              {{ chatErrorActionLabel }}
            </button>
          </div>
        </div>

        <!-- Pinned-to-bottom anchor -->
        <div ref="messagesScrollAnchor" class="h-px w-full shrink-0" aria-hidden="true" />
      </template>
      </div>
    </div>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <button
        v-if="bShowScrollToBottom"
        type="button"
        class="absolute bottom-3 right-4 md:right-6 z-10 button is-transparent is-icon h-9! w-9! min-w-9! rounded-full! border border-fg/15 bg-surface/90 shadow-md backdrop-blur-sm hover:bg-surface"
        title="Scroll to bottom"
        aria-label="Scroll to bottom"
        @click="scrollToBottom(true)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      </button>
    </Transition>
    </div>
  </div>
</template>

<style scoped>
.chat-bubble {
  background: var(--bg-elev-2);
}
</style>
