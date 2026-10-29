// @vitest-environment jsdom
// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, ref } from 'vue';
import { mount } from '@vue/test-utils';

// composables
import { usePolling } from './usePolling';

let visibility: DocumentVisibilityState = 'visible';

const setVisibility = (state: DocumentVisibilityState): void => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};

/** Resolvable promise so tests control when `fn` settles. */
const deferred = (): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePolling', () => {
  it('runs on each interval and immediately when requested', async () => {
    const scope = effectScope();
    const fn = vi.fn(async () => {});
    const poll = scope.run(() => usePolling(fn, 1000, { immediate: true }))!;
    poll.start();
    expect(poll.running.value).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).toHaveBeenCalledTimes(4);
    scope.stop();
  });

  it('never overlaps calls when fn is slow, and trigger respects the guard', async () => {
    const scope = effectScope();
    let active = 0;
    let maxActive = 0;
    let pending = deferred();
    const fn = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await pending.promise;
      active--;
    });
    const poll = scope.run(() => usePolling(fn, 1000))!;
    poll.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    void poll.trigger();
    expect(fn).toHaveBeenCalledTimes(1);

    const first = pending;
    pending = deferred();
    first.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    pending.resolve();
    scope.stop();
  });

  it('does not run while hidden and runs once on becoming visible', async () => {
    const scope = effectScope();
    const fn = vi.fn(async () => {});
    const poll = scope.run(() => usePolling(fn, 1000))!;
    poll.start();

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).not.toHaveBeenCalled();

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('doubles the interval on consecutive errors up to 60 s and resets on success', async () => {
    const scope = effectScope();
    let bFail = true;
    const callTimes: number[] = [];
    const fn = vi.fn(async () => {
      callTimes.push(Date.now());
      if (bFail) throw new Error('boom');
    });
    const t0 = Date.now();
    const poll = scope.run(() => usePolling(fn, 10_000, { backoffOnError: true }))!;
    poll.start();

    await vi.advanceTimersByTimeAsync(10_000 + 20_000 + 40_000 + 60_000 + 60_000);
    expect(callTimes.map((t) => t - t0)).toEqual([10_000, 30_000, 70_000, 130_000, 190_000]);

    bFail = false;
    await vi.advanceTimersByTimeAsync(60_000); // next tick still backed off; this one succeeds
    expect(fn).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(10_000); // reset to the base interval
    expect(fn).toHaveBeenCalledTimes(7);
    scope.stop();
  });

  it('skips ticks while enabled is false', async () => {
    const scope = effectScope();
    const enabled = ref(false);
    const fn = vi.fn(async () => {});
    const poll = scope.run(() => usePolling(fn, 1000, { enabled }))!;
    poll.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).not.toHaveBeenCalled();
    enabled.value = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('stops when the owning component unmounts', async () => {
    const fn = vi.fn(async () => {});
    let running: { value: boolean } | null = null;
    const Comp = defineComponent({
      setup() {
        const poll = usePolling(fn, 1000);
        poll.start();
        running = poll.running;
        return () => h('div');
      }
    });
    const wrapper = mount(Comp);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(running!.value).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
