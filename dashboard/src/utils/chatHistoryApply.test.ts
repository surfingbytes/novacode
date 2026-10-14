// node_modules
import { describe, expect, it } from 'vitest';

// utils
import { shouldRetainLocalChatHistory } from '@/utils/chatHistoryApply';

describe('shouldRetainLocalChatHistory', () => {
  it('keeps local messages when a stale empty history frame arrives', () => {
    expect(shouldRetainLocalChatHistory(0, 1)).toBe(true);
  });

  it('applies empty history when local is also empty', () => {
    expect(shouldRetainLocalChatHistory(0, 0)).toBe(false);
  });

  it('applies non-empty server history', () => {
    expect(shouldRetainLocalChatHistory(2, 1)).toBe(false);
  });
});
