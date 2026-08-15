// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';

// lib
import { safeGetItem, safeLocalStorageKeys, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';

describe('safeLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips values', () => {
    expect(safeSetItem('k', 'v')).toBe(true);
    expect(safeGetItem('k')).toBe('v');
    safeRemoveItem('k');
    expect(safeGetItem('k')).toBeNull();
  });

  it('lists keys', () => {
    safeSetItem('a', '1');
    safeSetItem('b', '2');
    expect(safeLocalStorageKeys().sort()).toEqual(['a', 'b']);
  });

  it('does not throw when storage is full or blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(safeSetItem('k', 'v')).toBe(false);
    expect(safeGetItem('k')).toBeNull();
    expect(() => safeRemoveItem('k')).not.toThrow();
    vi.restoreAllMocks();
  });
});
