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
  /** True while the mouse button is held inside the list (scrollbar drag). */
  let bPointerScrolling = false;
  let touchStartY: number | null = null;

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
    // While the pointer is held on the scrollbar, every scroll event is the user's.
    if (!bPointerScrolling && shouldIgnoreScrollEvent()) {
      return;
    }
    bPinnedToBottom.value = isScrolledToBottom();
    bShowScrollToBottom.value = !bPinnedToBottom.value;
    if (!props.bHasMore || props.bLoadingMore) return;
    if (messagesEl.value && messagesEl.value.scrollTop < 100) {
      options.onLoadOlder();
    }
  }

  // -------------------------------------------------- User-intent unpin --------------------------------------------------
  // While a response streams, the content resizes many times per second and each
  // follow-scroll opens a 150ms ignore window. Those windows overlap, so the scroll
  // events caused by the user scrolling up were dropped and the next resize snapped
  // them back down. Input events are unambiguous user intent, so unpin on them
  // directly instead of inferring it from scroll position.

  function unpinFromUser(): void {
    bIgnoreScrollEvents = false;
    ignoreScrollUntil = 0;
    bPinnedToBottom.value = false;
    bShowScrollToBottom.value = true;
  }

  function onWheel(event: WheelEvent): void {
    if (event.deltaY < 0) {
      unpinFromUser();
    }
  }

  function onTouchStart(event: TouchEvent): void {
    touchStartY = event.touches[0]?.clientY ?? null;
  }

  function onTouchMove(event: TouchEvent): void {
    const y = event.touches[0]?.clientY;
    if (touchStartY === null || y === undefined) return;
    // Finger moving down drags the content down = scrolling up.
    if (y - touchStartY > 8) {
      unpinFromUser();
      touchStartY = null;
    }
  }

  function onTouchEnd(): void {
    touchStartY = null;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
      unpinFromUser();
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    bPointerScrolling = true;
  }

  function onPointerUp(): void {
    bPointerScrolling = false;
  }

  function attachUserIntentListeners(el: HTMLElement): void {
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function detachUserIntentListeners(el: HTMLElement | null): void {
    if (el) {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('pointerdown', onPointerDown);
    }
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
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
    if (messagesEl.value) {
      attachUserIntentListeners(messagesEl.value);
    }
    if (typeof ResizeObserver !== 'undefined' && messagesContentEl.value) {
      contentResizeObserver = new ResizeObserver(() => {
        followPinnedToBottom();
      });
      contentResizeObserver.observe(messagesContentEl.value);
    }
  });

  onUnmounted(() => {
    detachUserIntentListeners(messagesEl.value);
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
