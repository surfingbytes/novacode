<script setup lang="ts">
/**
 * Chat scroll container: history messages, live stream, thinking box, usage
 * meter, inline error, and all scroll management (pinned-bottom follow,
 * load-more on scroll-to-top, history-page scroll restore).
 * Extracted from SessionChat.vue; message markup follows the design handoff
 * (avatar square + mono name/age caption + flat bubble).
 */

// node_modules
import { computed, nextTick, ref, watch } from 'vue';

// components
import ChatDisplayItems from '@/components/chat/ChatDisplayItems.vue';

// classes
import { sessionsApi } from '@/classes/api';

// utils
import { relativeTimeShort } from '@/utils/relativeTime';
import { agentTypeShortLabel } from '@/utils/agentTypeMeta';
import type { DisplayItem, StreamUsage } from '@/utils/chatDisplayItems';

// types
import type { AgentType, ChatMessage } from '@/@types/index';

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
    streamingThinkingText: string;
    streamingUsage: StreamUsage | null;
    bIsStreaming: boolean;
    bHasMore: boolean;
    bLoadingMore: boolean;
    chatError: string | null;
    chatErrorActionLabel: string;
    hideThinkingOutput: boolean;
    expandedToolOutputIds: Set<string>;
    agentType?: AgentType | null;
    userName?: string | null;
    viewportHeight?: number | null;
  }>(),
  {
    agentType: null,
    userName: null,
    viewportHeight: null
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'loadOlder'): void;
  (e: 'toggleToolOutput', callId: string): void;
  (e: 'openPlan', planId: string | undefined): void;
  (e: 'lightbox', src: string): void;
  (e: 'chatErrorAction'): void;
  (e: 'cancel'): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const messagesEl = ref<HTMLElement | null>(null);
const messagesScrollAnchor = ref<HTMLElement | null>(null);
const bShowScrollToBottom = ref(false);
/** True while the user is parked at the bottom (updated from real scroll events). */
const bPinnedToBottom = ref(true);

// -------------------------------------------------- Computed --------------------------------------------------

const agentInitial = computed(() => {
  const label = agentTypeShortLabel(props.agentType ?? '') || 'a';
  return label.charAt(0).toUpperCase();
});

const agentDisplayName = computed(() => agentTypeShortLabel(props.agentType ?? '') || 'agent');

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
  bShowScrollToBottom.value = false;
  const anchor = messagesScrollAnchor.value;
  if (anchor) {
    anchor.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
    return;
  }
  el.scrollTop = el.scrollHeight;
}

async function scrollToBottom(smooth = false): Promise<void> {
  await waitForLayout();
  applyScrollToBottom(smooth);
}

async function scrollToBottomIfPinned(): Promise<void> {
  if (!bPinnedToBottom.value) return;
  await waitForLayout();
  // The user may have scrolled away while we waited for layout — don't yank them back.
  if (!bPinnedToBottom.value) return;
  applyScrollToBottom();
}

function onMessagesScroll(): void {
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
  await nextTick();
  if (container) {
    container.scrollTop += container.scrollHeight - oldScrollHeight;
  }
}

function forceInitialScrollToBottom(): void {
  void scrollToBottom();
  // Some message content (e.g. markdown/images) can expand after first paint.
  requestAnimationFrame(() => {
    void scrollToBottom();
  });
}

// -------------------------------------------------- Watchers --------------------------------------------------

// Follow new content while pinned to the bottom. The thinking box has a fixed
// height, so its text streaming by can't move the chat — only the box
// appearing/disappearing can, so watch its visibility rather than text length.
watch(
  () => [
    props.displayMessages.length,
    props.streamingDisplayItems.length,
    props.streamingThinkingText.trim().length > 0 && !props.hideThinkingOutput
  ],
  () => {
    void scrollToBottomIfPinned();
  }
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

defineExpose({ scrollToBottom, notifyHistoryPage, forceInitialScrollToBottom });
</script>

<template>
  <div class="flex-1 overflow-hidden flex flex-col min-h-0">
    <!-- Messages -->
    <div
      ref="messagesEl"
      class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4 min-h-0"
      @scroll="onMessagesScroll"
    >
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
          <div class="chat-msg-row">
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
                  :expanded-tool-output-ids="expandedToolOutputIds"
                  @toggle-tool-output="(callId) => emit('toggleToolOutput', callId)"
                  @open-plan="(planId) => emit('openPlan', planId)"
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
              :expanded-tool-output-ids="expandedToolOutputIds"
              @toggle-tool-output="(callId) => emit('toggleToolOutput', callId)"
              @open-plan="(planId) => emit('openPlan', planId)"
              @markdown-click="onChatMarkdownClick"
            />

            <!-- Token usage meter -->
            <div v-if="streamingUsage" class="flex justify-start">
              <div class="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-muted/50 font-mono">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M12 12l-3-3"/></svg>
                {{ streamingUsage.used.toLocaleString() }} /
                {{ streamingUsage.size.toLocaleString() }}
                <template v-if="streamingUsage.cost">
                  <span class="text-text-muted/30">·</span>
                  ${{ streamingUsage.cost.amount.toFixed(4) }}
                </template>
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
              v-if="streamingDisplayItems.length === 0 && (!streamingThinkingText.trim() || hideThinkingOutput)"
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

    <!-- Scroll-to-bottom + stop actions -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div v-if="bShowScrollToBottom" class="flex justify-center py-2 shrink-0">
        <div class="chat-fixed-actions">
          <button
            v-if="bIsStreaming"
            @click="emit('cancel')"
            class="button is-transparent is-icon chat-fixed-action !text-destructive hover:!bg-destructive/10"
            title="Stop"
            aria-label="Stop generating"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
          </button>
          <button
            @click="scrollToBottom(true)"
            class="button is-transparent is-icon chat-fixed-action"
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          </button>
        </div>
      </div>
    </Transition>

    <!-- Floating stop button (when already at bottom) -->
    <div v-if="bIsStreaming && !bShowScrollToBottom" class="flex justify-center py-2 shrink-0">
      <button
        @click="emit('cancel')"
        class="button is-transparent is-icon chat-fixed-action !text-destructive hover:!bg-destructive/10"
        title="Stop"
        aria-label="Stop generating"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Redesign message row: avatar square + mono meta + flat bubble */
.chat-msg-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
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

.chat-fixed-actions {
  display: inline-flex;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 0.375rem;
  overflow: hidden;
  background: rgb(255 255 255 / 0.04);
}

.chat-fixed-action {
  border: 0 !important;
  border-radius: 0 !important;
  width: 2rem !important;
  min-width: 2rem !important;
  height: 2rem !important;
}
</style>
