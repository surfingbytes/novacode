// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installPreloadErrorReload, PRELOAD_RELOAD_KEY } from '@/utils/preloadErrorReload';

function fakeWindow(): { win: Window; reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn();
  const win = Object.assign(new EventTarget(), {
    sessionStorage: window.sessionStorage,
    location: { reload }
  }) as unknown as Window;
  return { win, reload };
}

function dispatchPreloadError(win: Window): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  win.dispatchEvent(event);
  return event;
}

describe('installPreloadErrorReload', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('reloads once and sets the guard', () => {
    const { win, reload } = fakeWindow();
    installPreloadErrorReload(win);

    const event = dispatchPreloadError(win);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY)).toBe('1');
  });

  it('does not reload again when the guard is set, and clears it', () => {
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
    const { win, reload } = fakeWindow();
    installPreloadErrorReload(win);

    const event = dispatchPreloadError(win);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY)).toBeNull();
  });
});
