<script setup lang="ts">
/**
 * Chat scroll container: history messages, live stream, thinking box, usage
 * meter, inline error, and all scroll management (pinned-bottom follow,
 * load-more on scroll-to-top, history-page scroll restore).
 * Extracted from SessionChat.vue; message markup follows the design handoff
 * (avatar square + mono name/age caption + flat bubble).
 */

// node_modules
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

// components
import ChatDisplayItems from '@/components/chat/ChatDisplayItems.vue';

// classes
import { sessionsApi } from '@/classes/api';

// utils
import { relativeTimeShort } from '@/utils/relativeTime';
import { agentTypeShortLabel } from '@/utils/agentTypeMeta';
import { isToolCallDisplayItem, type DisplayItem, type StreamUsage } from '@/utils/chatDisplayItems';

// types
import type {
  AgentType,
  ChatApprovalRequest,
  ChatMessage,
  ChatQuestionAnswer,
  ChatQuestionRequest,
  SessionUsageTurn
} from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

interface DisplayChatMessage {
  msg: ChatMessage;
  key: string;
  items: DisplayItem[];
  fallbackHtml: string;
}

const props = withDefaults(
  defineProps<{
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
  }>(),
  {
    agentType: null,
    userName: null,
    viewportHeight: null,
    usageTurns: () => [],
    hideToolCalls: false
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
  (e: 'approvalResponse', approvalRequestId: string, approvalOptionId: string): void;
  (
    e: 'questionResponse',
    questionRequestId: string,
    payload: { skipped: true } | { answers: ChatQuestionAnswer[] }
  ): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const messagesEl = ref<HTMLElement | null>(null);
const messagesContentEl = ref<HTMLElement | null>(null);
const messagesScrollAnchor = ref<HTMLElement | null>(null);
const bShowScrollToBottom = ref(false);
/** True while the user is parked at the bottom (updated from real scroll events). */
const bPinnedToBottom = ref(true);
/** Ignore layout/programmatic scroll events so growing content cannot unpin follow. */
let bIgnoreScrollEvents = false;
let ignoreScrollUntil = 0;
let contentResizeObserver: ResizeObserver | null = null;
let bRestoringHistoryScroll = false;

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

// -------------------------------------------------- Attachments / markdown clicks --------------------------------------------------

const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp)$/i;

function isImageAttachmentPath(path: string): boolean {
  return IMAGE_PATH_RE.test(path);
}

function attachmentDisplayName(path: string): string {
  return path.split('/').pop() ?? path;
}

function imageApiUrl(serverPath: string): string {
  // serverPath is <configDir>/prompt-images/<sessionId>/<filename>
  const parts = serverPath.split('/');
  const fname = parts[parts.length - 1];
  const sid = parts[parts.length - 2];
  return sessionsApi.imageUrl(sid, fname);
}

/** Copy code blocks and open images in the lightbox (chat markdown bubbles). */
async function copyCodeBlockFromEvent(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement | null)?.closest('.code-copy-btn') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const code = btn.closest('.code-block-card')?.querySelector('code');
  const text = code?.textContent ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    btn.setAttribute('aria-label', 'Copied');
    btn.setAttribute('title', 'Copied');
    btn.dataset.copied = '1';
    window.setTimeout(() => {
      btn.textContent = prev ?? 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('title', 'Copy');
      delete btn.dataset.copied;
    }, 2000);
  } catch {
    // Clipboard may be unavailable; leave button unchanged.
  }
}

function onChatMarkdownClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('.code-copy-btn')) {
    void copyCodeBlockFromEvent(e);
    return;
  }
  if (!(target instanceof HTMLImageElement)) return;
  e.preventDefault();
  e.stopPropagation();
  const src = target.currentSrc || target.src;
  if (src) emit('lightbox', src);
}

// -------------------------------------------------- Scroll management --------------------------------------------------

function isScrolledToBottom(): boolean {
  const el = messagesEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function beginIgnoreScrollEvents(): void {
  bIgnoreScrollEvents = true;
  ignoreScrollUntil = performance.now() + 150;
}

function endIgnoreScrollEvents(): void {
  requestAnimationFrame(() => {
    bIgnoreScrollEvents = false;
  });
}

function shouldIgnoreScrollEvent(): boolean {
  return bIgnoreScrollEvents || performance.now() < ignoreScrollUntil;
}

/** Wait for layout/paint so scrollHeight and the thinking block height are final. */
async function waitForLayout(): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function applyScrollToBottom(smooth = false): void {
  const el = messagesEl.value;
  if (!el) return;
  beginIgnoreScrollEvents();
  bShowScrollToBottom.value = false;
  const anchor = messagesScrollAnchor.value;
  if (anchor) {
    anchor.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  } else {
    el.scrollTop = el.scrollHeight;
  }
  endIgnoreScrollEvents();
}

function followPinnedToBottom(): void {
  if (!bPinnedToBottom.value || bRestoringHistoryScroll) {
    return;
  }
  applyScrollToBottom();
}

async function scrollToBottom(smooth = false): Promise<void> {
  beginIgnoreScrollEvents();
  await waitForLayout();
  applyScrollToBottom(smooth);
}

async function scrollToBottomIfPinned(): Promise<void> {
  if (!bPinnedToBottom.value) return;
  // Hold pin through the layout wait: adding the 240px thinking box (or a tool
  // card) fires a scroll event that looks like the user moved away, because the
  // near-bottom threshold is 80px.
  beginIgnoreScrollEvents();
  await waitForLayout();
  if (!bPinnedToBottom.value) {
    return;
  }
  applyScrollToBottom();
}

function onMessagesScroll(): void {
  if (shouldIgnoreScrollEvent()) {
    return;
  }
  bPinnedToBottom.value = isScrolledToBottom();
  bShowScrollToBottom.value = !bPinnedToBottom.value;
  if (!props.bHasMore || props.bLoadingMore) return;
  if (messagesEl.value && messagesEl.value.scrollTop < 100) {
    emit('loadOlder');
  }
}

/** Keep scroll position stable when older messages are prepended. */
async function notifyHistoryPage(): Promise<void> {
  const container = messagesEl.value;
  const oldScrollHeight = container?.scrollHeight ?? 0;
  bRestoringHistoryScroll = true;
  beginIgnoreScrollEvents();
  await nextTick();
  if (container) {
    container.scrollTop += container.scrollHeight - oldScrollHeight;
  }
  requestAnimationFrame(() => {
    bRestoringHistoryScroll = false;
    endIgnoreScrollEvents();
  });
}

function forceInitialScrollToBottom(): void {
  void scrollToBottom();
  // Some message content (e.g. markdown/images) can expand after first paint.
  requestAnimationFrame(() => {
    void scrollToBottom();
  });
}

// -------------------------------------------------- Watchers --------------------------------------------------

// Follow new content while pinned. Length-only is not enough: a tool card can
// grow in place (status/output) without a new item. ResizeObserver covers the
// rest (thinking box 240px mount/unmount, images, mermaid).
watch(
  () => [
    props.displayMessages.length,
    props.streamingDisplayItems.length,
    props.streamingDisplayItems.map((item) => item.status ?? item.kind).join(','),
    props.pendingApprovals.length,
    props.pendingQuestions.length,
    props.streamingThinkingText.trim().length > 0 && !props.hideThinkingOutput,
    Boolean(props.chatError)
  ],
  () => {
    void scrollToBottomIfPinned();
  },
  { flush: 'post' }
);

// First history load → jump to the latest message.
watch(
  () => props.displayMessages.length,
  (length, previous) => {
    if (length > 0 && (previous === 0 || previous === undefined)) {
      forceInitialScrollToBottom();
    }
  }
);

// On-screen keyboard resizes the viewport — keep the latest message visible.
watch(
  () => props.viewportHeight,
  async () => {
    await nextTick();
    await scrollToBottom();
  }
);

function approvalOptionClass(kind: string): string {
  if (kind.startsWith('reject')) {
    return 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15';
  }
  if (kind === 'allow_always') {
    return 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15';
  }
  return 'border-fg/15 bg-fg/[0.04] text-text-primary hover:bg-fg/[0.08]';
}

function approvalSubtitle(approval: ChatApprovalRequest): string {
  if (approval.toolName && approval.toolKind) return `${approval.toolName} · ${approval.toolKind}`;
  return approval.toolName ?? approval.toolKind ?? 'Tool permission';
}

/** questionRequestId -> questionId -> selected option ids */
const questionSelections = ref<Record<string, Record<string, string[]>>>({});

watch(
  () => props.pendingQuestions.map((question) => question.id).join(','),
  () => {
    const next: Record<string, Record<string, string[]>> = {};
    for (const question of props.pendingQuestions) {
      next[question.id] = questionSelections.value[question.id] ?? {};
    }
    questionSelections.value = next;
  }
);

function selectedOptionIds(questionRequestId: string, questionId: string): string[] {
  return questionSelections.value[questionRequestId]?.[questionId] ?? [];
}

function isOptionSelected(questionRequestId: string, questionId: string, optionId: string): boolean {
  return selectedOptionIds(questionRequestId, questionId).includes(optionId);
}

function toggleQuestionOption(
  request: ChatQuestionRequest,
  questionId: string,
  optionId: string,
  allowMultiple: boolean
): void {
  const current = selectedOptionIds(request.id, questionId);
  let next: string[];
  if (allowMultiple) {
    next = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];
  } else {
    next = current.includes(optionId) && current.length === 1 ? [] : [optionId];
  }
  questionSelections.value = {
    ...questionSelections.value,
    [request.id]: {
      ...(questionSelections.value[request.id] ?? {}),
      [questionId]: next
    }
  };
}

function canSubmitQuestion(request: ChatQuestionRequest): boolean {
  return request.questions.every(
    (question) => selectedOptionIds(request.id, question.id).length > 0
  );
}

function submitQuestion(request: ChatQuestionRequest): void {
  if (!canSubmitQuestion(request)) return;
  const answers: ChatQuestionAnswer[] = request.questions.map((question) => ({
    questionId: question.id,
    selectedOptionIds: selectedOptionIds(request.id, question.id)
  }));
  emit('questionResponse', request.id, { answers });
}

function skipQuestion(request: ChatQuestionRequest): void {
  emit('questionResponse', request.id, { skipped: true });
}

const FIND_EVENT = 'novacode:find-in-chat';
const bFindOpen = ref(false);
const findQuery = ref('');
const findMatchIndex = ref(0);
const findInputRef = ref<HTMLInputElement | null>(null);

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

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

function scrollFindMatchIntoView(): void {
  const key = findMatchKeys.value[findMatchIndex.value];
  if (!key) {
    return;
  }
  void nextTick(() => {
    const el = messagesEl.value?.querySelector(`[data-find-key="${cssEscape(key)}"]`);
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
  findInputRef.value?.focus();
  findInputRef.value?.select();
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

onMounted(() => {
  window.addEventListener('keydown', onWindowFindKeydown);
  window.addEventListener(FIND_EVENT, openFind as EventListener);
  if (typeof ResizeObserver !== 'undefined' && messagesContentEl.value) {
    contentResizeObserver = new ResizeObserver(() => {
      followPinnedToBottom();
    });
    contentResizeObserver.observe(messagesContentEl.value);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowFindKeydown);
  window.removeEventListener(FIND_EVENT, openFind as EventListener);
  contentResizeObserver?.disconnect();
  contentResizeObserver = null;
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
    <div
      v-if="bFindOpen"
      class="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-fg/10 shrink-0"
    >
      <input
        ref="findInputRef"
        v-model="findQuery"
        type="search"
        placeholder="Find in conversation"
        class="flex-1 min-w-0 bg-transparent text-sm text-text-primary outline-none"
        aria-label="Find in conversation"
        @keydown="onFindKeydown"
      />
      <span class="text-[11px] text-text-muted tabular-nums shrink-0 nc-mono">
        {{
          findQuery.trim()
            ? findMatchKeys.length
              ? `${findMatchIndex + 1}/${findMatchKeys.length}`
              : '0/0'
            : ''
        }}
      </span>
      <button
        type="button"
        class="button is-transparent is-icon"
        title="Previous"
        aria-label="Previous match"
        :disabled="findMatchKeys.length === 0"
        @click="stepFindMatch(-1)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button
        type="button"
        class="button is-transparent is-icon"
        title="Next"
        aria-label="Next match"
        :disabled="findMatchKeys.length === 0"
        @click="stepFindMatch(1)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button
        type="button"
        class="button is-transparent is-icon"
        title="Close"
        aria-label="Close find"
        @click="closeFind"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12"/></svg>
      </button>
    </div>
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
        <template v-for="{ msg, key, items, fallbackHtml } in displayMessages" :key="key">
          <div
            class="chat-msg-row"
            :class="{ 'chat-msg-row--find': findMatchKeys[findMatchIndex] === key }"
            :data-find-key="key"
          >
            <!-- Avatar -->
            <div
              class="chat-avatar nc-mono"
              :class="msg.role === 'user' ? 'chat-avatar--user' : `chat-avatar--${agentType ?? 'agent'}`"
              aria-hidden="true"
            >
              {{ msg.role === 'user' ? userInitial : agentInitial }}
            </div>
            <div class="min-w-0 flex-1 space-y-2">
              <!-- Name + age -->
              <div class="chat-msg-meta nc-mono">
                <span class="chat-msg-name">{{ msg.role === 'user' ? (userName ?? 'You') : agentDisplayName }}</span>
                <span class="chat-msg-age">· {{ relativeTimeShort(msg.createdAt) }}</span>
              </div>

              <!-- User attachments -->
              <div v-if="msg.role === 'user' && msg.imagePaths?.length" class="flex flex-wrap gap-2">
                <template v-for="(imgPath, j) in msg.imagePaths" :key="j">
                  <img
                    v-if="isImageAttachmentPath(imgPath)"
                    :src="msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath)"
                    class="max-h-48 max-w-[12rem] rounded-lg object-cover border border-fg/10 cursor-pointer"
                    title="View full size"
                    @click="emit('lightbox', msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath))"
                  />
                  <a
                    v-else
                    :href="imageApiUrl(imgPath)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex max-w-[12rem] items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.06] px-3 py-2 text-xs text-text-primary hover:bg-fg/[0.1]"
                    :title="attachmentDisplayName(imgPath)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-text-muted" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span class="truncate">{{ attachmentDisplayName(imgPath) }}</span>
                  </a>
                </template>
              </div>

              <!-- User text -->
              <div
                v-if="msg.role === 'user' && msg.content"
                class="chat-bubble text-text-primary px-3.5 py-3 rounded-lg text-sm whitespace-pre-wrap break-words max-w-full md:max-w-[85%]"
              >
                {{ msg.content }}
              </div>

              <!-- Assistant items -->
              <template v-if="msg.role === 'assistant'">
                <ChatDisplayItems
                  :items="items"
                  :hide-tool-calls="hideToolCalls"
                  :expanded-tool-output-ids="expandedToolOutputIds"
                  @toggle-tool-output="(callId) => emit('toggleToolOutput', callId)"
                  @open-plan="(planId) => emit('openPlan', planId)"
                  @open-file="(path) => emit('openFile', path)"
                  @markdown-click="onChatMarkdownClick"
                />
                <div
                  v-if="fallbackHtml"
                  class="flex justify-start"
                >
                  <div
                    class="chat-markdown chat-bubble max-w-full md:max-w-[85%] text-text-primary px-3.5 py-3 rounded-lg text-sm"
                    v-html="fallbackHtml"
                    @click="onChatMarkdownClick"
                  ></div>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- Live streaming turn -->
        <div v-if="bIsStreaming" class="chat-msg-row">
          <div class="chat-avatar nc-mono" :class="`chat-avatar--${agentType ?? 'agent'}`" aria-hidden="true">
            {{ agentInitial }}
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="chat-msg-meta nc-mono">
              <span class="chat-msg-name">{{ agentDisplayName }}</span>
              <span class="chat-msg-age">· now</span>
            </div>
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

            <!-- ACP approval requests -->
            <div
              v-for="approval in pendingApprovals"
              :key="approval.id"
              class="flex justify-start"
            >
              <div class="chat-card max-w-full md:max-w-[85%] w-[34rem] rounded-lg px-3 py-3 text-sm">
                <div class="flex items-start gap-2">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="mt-0.5 shrink-0 text-yellow-500"
                    aria-hidden="true"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  </svg>
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-text-primary">{{ approval.title }}</div>
                    <div class="mt-0.5 text-xs text-text-muted">{{ approvalSubtitle(approval) }}</div>
                    <pre
                      v-if="approval.command"
                      class="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-fg/[0.04] px-2 py-1.5 font-mono text-[11px] text-text-muted"
                      >{{ approval.command }}</pre
                    >
                    <div v-if="approval.cwd" class="mt-1 truncate font-mono text-[11px] text-text-muted/70">
                      cwd: {{ approval.cwd }}
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        v-for="option in approval.options"
                        :key="option.optionId"
                        type="button"
                        class="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
                        :class="approvalOptionClass(option.kind)"
                        @click="emit('approvalResponse', approval.id, option.optionId)"
                      >
                        {{ option.name }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Cursor ACP ask_question prompts -->
            <div
              v-for="questionRequest in pendingQuestions"
              :key="questionRequest.id"
              class="flex justify-start"
            >
              <div class="chat-card max-w-full md:max-w-[85%] w-[34rem] rounded-lg px-3 py-3 text-sm">
                <div class="flex items-start gap-2">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="mt-0.5 shrink-0 text-sky-500"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-text-primary">
                      {{ questionRequest.title || 'Agent needs input' }}
                    </div>
                    <div class="mt-0.5 text-xs text-text-muted">Answer to continue</div>
                    <div class="mt-3 space-y-3">
                      <div
                        v-for="question in questionRequest.questions"
                        :key="question.id"
                        class="rounded-md bg-fg/[0.03] px-2.5 py-2"
                      >
                        <div class="text-sm text-text-primary">{{ question.prompt }}</div>
                        <div
                          v-if="question.allowMultiple"
                          class="mt-1 text-[11px] text-text-muted/70"
                        >
                          Select one or more
                        </div>
                        <div class="mt-2 flex flex-wrap gap-2">
                          <button
                            v-for="option in question.options"
                            :key="option.id"
                            type="button"
                            class="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
                            :class="
                              isOptionSelected(questionRequest.id, question.id, option.id)
                                ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                                : 'border-fg/15 bg-fg/[0.04] text-text-primary hover:bg-fg/[0.08]'
                            "
                            @click="
                              toggleQuestionOption(
                                questionRequest,
                                question.id,
                                option.id,
                                question.allowMultiple === true
                              )
                            "
                          >
                            {{ option.label }}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="!canSubmitQuestion(questionRequest)"
                        @click="submitQuestion(questionRequest)"
                      >
                        Submit
                      </button>
                      <button
                        type="button"
                        class="rounded-md border border-fg/15 bg-fg/[0.04] px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-fg/[0.08]"
                        @click="skipQuestion(questionRequest)"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Token usage meter -->
            <div v-if="streamingUsage || usageTurns.length > 0" class="flex justify-start">
              <div class="flex flex-col gap-1 px-2 py-1 text-[11px] text-text-muted/50 font-mono">
                <div v-if="streamingUsage" class="flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M12 12l-3-3"/></svg>
                  {{ streamingUsage.used.toLocaleString() }} /
                  {{ streamingUsage.size.toLocaleString() }}
                  <template v-if="streamingUsage.cost">
                    <span class="text-text-muted/30">·</span>
                    ${{ streamingUsage.cost.amount.toFixed(4) }}
                    <span v-if="streamingUsage.cost.currency && streamingUsage.cost.currency !== 'USD'" class="text-text-muted/30">{{ streamingUsage.cost.currency }}</span>
                  </template>
                </div>
                <details v-if="usageTurns.length > 1" class="text-text-muted/40">
                  <summary class="cursor-pointer select-none">{{ usageTurns.length }} turns</summary>
                  <ul class="mt-1 space-y-0.5 pl-4">
                    <li v-for="turn in usageTurns" :key="turn.id">
                      {{ turn.used.toLocaleString() }} / {{ turn.size.toLocaleString() }}
                      <template v-if="turn.cost"> · ${{ turn.cost.amount.toFixed(4) }}</template>
                      <span class="text-text-muted/30"> · {{ relativeTimeShort(turn.createdAt) }}</span>
                    </li>
                  </ul>
                </details>
              </div>
            </div>

            <!-- Model thinking stream -->
            <div v-if="streamingThinkingText.trim() && !hideThinkingOutput" class="flex justify-start">
              <div
                class="flex h-[240px] max-w-full md:max-w-[85%] min-h-0 flex-col overflow-hidden rounded-lg chat-card px-3 py-2 text-xs text-text-muted"
              >
                <div class="flex shrink-0 items-center gap-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted/90">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M9 12a3 3 0 006 0 3 3 0 00-6 0"/><path d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26A7 7 0 0012 2z"/><path d="M9 17v1a3 3 0 006 0v-1"/></svg>
                  Thinking
                </div>
                <div class="min-h-0 flex-1 overflow-hidden">
                  <div class="flex h-full max-h-full flex-col-reverse overflow-y-auto overflow-x-hidden [overflow-anchor:none]">
                    <pre class="w-full min-w-0 whitespace-pre-wrap break-words font-sans leading-snug text-text-muted">{{ streamingThinkingText }}</pre>
                  </div>
                </div>
              </div>
            </div>

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
          </div>
        </div>

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
/* Redesign message row: avatar square + mono meta + flat bubble */
.chat-msg-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border-radius: 8px;
}
.chat-msg-row--find {
  outline: 1px solid color-mix(in oklab, var(--accent) 55%, transparent);
  outline-offset: 4px;
  background: color-mix(in oklab, var(--accent) 8%, transparent);
}
.chat-avatar {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
  margin-top: 1px;
}
.chat-avatar--user {
  background: var(--accent-soft);
  color: var(--accent);
}
.chat-avatar--claude {
  background: color-mix(in oklab, var(--agent-claude) 16%, transparent);
  color: var(--agent-claude);
}
.chat-avatar--cursor-agent {
  background: color-mix(in oklab, var(--agent-cursor) 16%, transparent);
  color: var(--agent-cursor);
}
.chat-avatar--mistral-vibe {
  background: color-mix(in oklab, var(--agent-vibe) 16%, transparent);
  color: var(--agent-vibe);
}
.chat-avatar--open-code {
  background: color-mix(in oklab, var(--agent-opencode) 16%, transparent);
  color: var(--agent-opencode);
}
.chat-avatar--codex,
.chat-avatar--agent {
  background: var(--bg-elev-2);
  color: var(--fg-muted);
}
.chat-msg-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
  color: var(--fg-subtle);
  line-height: 1;
  padding-top: 3px;
}
.chat-msg-name {
  color: var(--fg-muted);
  font-weight: 500;
}
.chat-msg-age {
  color: var(--fg-faint);
}
.chat-bubble {
  background: var(--bg-elev-2);
}
.chat-card {
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
}
</style>
