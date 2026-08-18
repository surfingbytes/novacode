// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';

// lib
import { isSendOnEnter, SEND_ON_ENTER_KEY, setSendOnEnter } from '@/lib/sendOnEnter';

describe('sendOnEnter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to Enter-to-send when unset', () => {
    expect(isSendOnEnter()).toBe(true);
  });

  it('persists the per-device preference', () => {
    setSendOnEnter(false);
    expect(localStorage.getItem(SEND_ON_ENTER_KEY)).toBe('0');
    expect(isSendOnEnter()).toBe(false);

    setSendOnEnter(true);
    expect(localStorage.getItem(SEND_ON_ENTER_KEY)).toBe('1');
    expect(isSendOnEnter()).toBe(true);
  });
});
