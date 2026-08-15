// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';

// lib
import {
  clearSessionPrompt,
  persistDraftPrompt,
  persistSessionPrompt,
  readSessionPrompt,
  sessionPromptStorageKey,
  setPendingSessionPrompt
} from '@/lib/pendingSessionPrompt';

describe('pendingSessionPrompt', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads a prompt from localStorage when nothing is pending in memory', () => {
    localStorage.setItem('sessionPrompt:ws-1:session-1', 'saved draft');
    expect(readSessionPrompt('ws-1', 'session-1')).toBe('saved draft');
  });

  it('prefers the in-memory handoff, then falls back to localStorage', () => {
    setPendingSessionPrompt('ws-1', 'session-1', 'implement the plan');
    expect(readSessionPrompt('ws-1', 'session-1')).toBe('implement the plan');
    expect(readSessionPrompt('ws-1', 'session-1')).toBe('implement the plan');
  });

  it('still hands off the prompt when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    setPendingSessionPrompt('ws-1', 'session-1', 'implement the plan');
    expect(readSessionPrompt('ws-1', 'session-1')).toBe('implement the plan');
    expect(readSessionPrompt('ws-1', 'session-1')).toBeNull();
    vi.restoreAllMocks();
  });

  it('does not throw when persisting to a full localStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => persistSessionPrompt('ws-1', 'session-1', 'draft')).not.toThrow();
    vi.restoreAllMocks();
  });

  it('deletes the stored draft when the prompt is cleared (send)', () => {
    persistSessionPrompt('ws-1', 'session-1', 'draft to send');
    expect(localStorage.getItem('sessionPrompt:ws-1:session-1')).toBe('draft to send');
    clearSessionPrompt('ws-1', 'session-1');
    expect(localStorage.getItem('sessionPrompt:ws-1:session-1')).toBeNull();
  });

  it('evicts the oldest drafts once the cap is exceeded', () => {
    for (let i = 0; i < 21; i += 1) {
      persistDraftPrompt(`sessionPrompt:ws-1:session-${i}`, `draft ${i}`);
    }
    expect(localStorage.getItem('sessionPrompt:ws-1:session-0')).toBeNull();
    expect(localStorage.getItem('sessionPrompt:ws-1:session-20')).toBe('draft 20');
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith('sessionPrompt:'))
    ).toHaveLength(20);
  });

  it('uses a stable storage key', () => {
    expect(sessionPromptStorageKey('ws-1', 'session-1')).toBe('sessionPrompt:ws-1:session-1');
  });
});
