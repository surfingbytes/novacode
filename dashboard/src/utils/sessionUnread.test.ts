// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  isSessionUnread,
  isViewingSession,
  resetSessionUnreadState,
  setViewingSession
} from '@/utils/sessionUnread';

describe('sessionUnread', () => {
  beforeEach(() => {
    resetSessionUnreadState();
  });

  it('treats session.unread as unread when the chat is not open', () => {
    expect(isSessionUnread({ id: 'a', unread: true })).toBe(true);
  });

  it('treats missing unread as read', () => {
    expect(isSessionUnread({ id: 'a' })).toBe(false);
    expect(isSessionUnread({ id: 'a', unread: false })).toBe(false);
  });

  it('hides unread while the user is looking at the session', () => {
    setViewingSession('a');
    expect(isViewingSession('a')).toBe(true);
    expect(isSessionUnread({ id: 'a', unread: true })).toBe(false);
  });

  it('still shows unread for other sessions while one is open', () => {
    setViewingSession('a');
    expect(isSessionUnread({ id: 'b', unread: true })).toBe(true);
  });
});
