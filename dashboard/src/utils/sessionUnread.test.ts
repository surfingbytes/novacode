// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  isSessionUnread,
  markSessionFinished,
  resetSessionUnreadState,
  setViewingSession
} from '@/utils/sessionUnread';

describe('sessionUnread', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSessionUnreadState();
  });

  it('marks a finished session unread when it is not being viewed', () => {
    markSessionFinished('a');
    expect(isSessionUnread('a')).toBe(true);
  });

  it('does not mark the session the user is looking at', () => {
    setViewingSession('a');
    markSessionFinished('a');
    expect(isSessionUnread('a')).toBe(false);
  });

  it('clears unread when the session is opened', () => {
    markSessionFinished('b');
    setViewingSession('b');
    expect(isSessionUnread('b')).toBe(false);
  });
});
