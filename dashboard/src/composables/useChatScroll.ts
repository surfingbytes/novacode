/**
 * Chat scroll management: pinned-bottom follow, load-more on scroll-to-top and
 * history-page scroll restore.
 * Extracted from ChatMessageList.vue.
 */

// node_modules
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

// utils
import { motionSafeScrollBehavior } from '@/utils/reducedMotion';
import type { DisplayItem } from '@/utils/chatDisplayItems';

// types
import type { ChatApprovalRequest, ChatQuestionRequest } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

interface ChatScrollSource {
  displayMessages: readonly unknown[];
  streamingDisplayItems: DisplayItem[];
  pendingApprovals: ChatApprovalRequest[];
  pendingQuestions: ChatQuestionRequest[];
  streamingThinkingText: string;
  hideThinkingOutput: boolean;
  chatError: string | null;
  bHasMore: boolean;
  bLoadingMore: boolean;
  viewportHeight?: number | null;
}

export interface UseChatScrollOptions {
  /** Reactive source (component props) */
  source: ChatScrollSource;
  onLoadOlder: () => void;
}

export function useChatScroll(options: UseChatScrollOptions) {
  const props = options.source;

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
      anchor.scrollIntoView({ block: 'end', behavior: motionSafeScrollBehavior(smooth ? 'smooth' : 'auto') });
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
      options.onLoadOlder();
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

  // -------------------------------------------------- Lifecycle --------------------------------------------------

  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined' && messagesContentEl.value) {
      contentResizeObserver = new ResizeObserver(() => {
        followPinnedToBottom();
      });
      contentResizeObserver.observe(messagesContentEl.value);
    }
  });

  onUnmounted(() => {
    contentResizeObserver?.disconnect();
    contentResizeObserver = null;
  });

  return {
    messagesEl,
    messagesContentEl,
    messagesScrollAnchor,
    bShowScrollToBottom,
    onMessagesScroll,
    scrollToBottom,
    notifyHistoryPage,
    forceInitialScrollToBottom
  };
}
