// node_modules
import { getCurrentScope, onScopeDispose, readonly, ref, unref, type Ref } from 'vue';

const MAX_BACKOFF_MS = 60_000;

/**
 * Runs `fn` every `intervalMs` while started and the page is visible.
 * - Paused while `document.visibilityState === 'hidden'`; runs once immediately on becoming visible.
 * - Never overlaps: a tick (or `trigger()`) while `fn` is still in flight is skipped.
 * - With `backoffOnError`, consecutive failures double the delay (capped at 60 s); a success resets it.
 * - Stops automatically when the owning component / effect scope is disposed.
 * `intervalMs` may be a getter so callers can adapt the cadence to the last result.
 * `running` is true while polling is started (independent of visibility).
 */
export function usePolling(
  fn: () => Promise<void>,
  intervalMs: number | (() => number),
  opts: {
    immediate?: boolean;
    backoffOnError?: boolean;
    enabled?: Ref<boolean> | (() => boolean);
  } = {}
): {
  start(): void;
  stop(): void;
  trigger(): Promise<void>;
  running: Readonly<Ref<boolean>>;
} {
  const running = ref<boolean>(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let bListening = false;

  const isEnabled = (): boolean => {
    const { enabled } = opts;
    if (enabled === undefined) return true;
    return typeof enabled === 'function' ? enabled() : unref(enabled);
  };

  const isVisible = (): boolean => document.visibilityState !== 'hidden';

  const nextDelay = (): number => {
    const base = typeof intervalMs === 'function' ? intervalMs() : intervalMs;
    if (!opts.backoffOnError || failures === 0) return base;
    return Math.max(base, Math.min(base * 2 ** failures, MAX_BACKOFF_MS));
  };

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    clearTimer();
    if (!running.value || !isVisible()) return;
    timer = setTimeout(() => void tick(), nextDelay());
  };

  const run = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<void> => {
      try {
        await fn();
        failures = 0;
      } catch {
        failures++;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const tick = async (): Promise<void> => {
    timer = null;
    if (!inFlight && isEnabled()) await run();
    schedule();
  };

  const trigger = async (): Promise<void> => {
    await run();
    // Restart the countdown so a manual run is not immediately followed by a tick.
    if (timer) schedule();
  };

  const onVisibility = (): void => {
    if (!running.value) return;
    if (!isVisible()) {
      clearTimer();
      return;
    }
    clearTimer();
    void tick();
  };

  const start = (): void => {
    if (running.value) return;
    running.value = true;
    if (!bListening) {
      document.addEventListener('visibilitychange', onVisibility);
      bListening = true;
    }
    if (opts.immediate && isVisible()) void tick();
    else schedule();
  };

  const stop = (): void => {
    running.value = false;
    clearTimer();
    if (bListening) {
      document.removeEventListener('visibilitychange', onVisibility);
      bListening = false;
    }
  };

  if (getCurrentScope()) onScopeDispose(stop);

  return { start, stop, trigger, running: readonly(running) };
}
