// node_modules
import { onBeforeUnmount, ref } from 'vue';
import type { Ref } from 'vue';

// -------------------------------------------------- Types --------------------------------------------------
export interface UseLongPress<T> {
  /** True once a long-press has fired; the caller resets it after swallowing the trailing click. */
  bTriggered: Ref<boolean>;
  onPointerDown: (e: PointerEvent, payload: T) => void;
  onPointerUp: () => void;
  onPointerMove: (e: PointerEvent) => void;
}

// -------------------------------------------------- Constants --------------------------------------------------
const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

/**
 * Pointer long-press (mouse + touch via Pointer Events): holding for 500ms fires
 * the callback with the payload bound at pointerdown; releasing, leaving,
 * cancelling or moving further than 10px first cancels the press.
 */
export function useLongPress<T>(onLongPress: (payload: T) => void): UseLongPress<T> {
  const bTriggered = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pointerStart: { x: number; y: number } | null = null;

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onPointerDown(e: PointerEvent, payload: T): void {
    cancelTimer();
    bTriggered.value = false;
    pointerStart = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      bTriggered.value = true;
      onLongPress(payload);
      if (navigator.vibrate) {
        navigator.vibrate(30);
      }
    }, LONG_PRESS_MS);
  }

  function onPointerUp(): void {
    cancelTimer();
  }

  function onPointerMove(e: PointerEvent): void {
    if (timer !== null && pointerStart !== null) {
      const dx = e.clientX - pointerStart.x;
      const dy = e.clientY - pointerStart.y;
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
        cancelTimer();
      }
    }
  }

  onBeforeUnmount(cancelTimer);

  return { bTriggered, onPointerDown, onPointerUp, onPointerMove };
}
