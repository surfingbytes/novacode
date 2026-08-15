// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';

// lib
import { readSessionCache, removeSessionCache, writeSessionCache } from '@/lib/sessionCache';

// types
import type { ChatMessage, Session } from '@/@types/index';

// -------------------------------------------------- Helpers --------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Test session',
    tags: null,
    sessionId: 'agent-session-1',
    agentType: 'claude',
    modelSelection: 'auto',
    sessionMode: 'agent',
    approvalPolicy: 'ask',
    workspaceId: 'ws-1',
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
    archived: false,
    ...overrides
  };
}

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
    createdAt: `2026-07-24T10:${String(i).padStart(2, '0')}:00.000Z`
  }));
}

// -------------------------------------------------- Tests --------------------------------------------------

describe('sessionCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is cached', () => {
    expect(readSessionCache('ws-1', 'session-1')).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const session = makeSession();
    const messages = makeMessages(4);
    writeSessionCache('ws-1', 'session-1', { session, messages, bHasMore: true });

    const cached = readSessionCache('ws-1', 'session-1');
    expect(cached).not.toBeNull();
    expect(cached?.session?.id).toBe('session-1');
    expect(cached?.messages).toHaveLength(4);
    expect(cached?.bHasMore).toBe(true);
  });

  it('strips bulky client-only fields (messageJson, imageDataUrls)', () => {
    const session = makeSession({ messageJson: '["huge raw history"]' });
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'with image',
        imagePaths: ['/prompt-images/session-1/a.png'],
        imageDataUrls: ['data:image/png;base64,AAA='],
        createdAt: '2026-07-24T10:00:00.000Z'
      }
    ];
    writeSessionCache('ws-1', 'session-1', { session, messages, bHasMore: false });

    const raw = localStorage.getItem('nova:sessionCache:ws-1:session-1') ?? '';
    expect(raw).not.toContain('huge raw history');
    expect(raw).not.toContain('imageDataUrls');

    const cached = readSessionCache('ws-1', 'session-1');
    expect(cached?.messages[0]?.imagePaths).toEqual(['/prompt-images/session-1/a.png']);
    expect(cached?.messages[0]?.imageDataUrls).toBeUndefined();
  });

  it('keeps only the latest 50 messages', () => {
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession(),
      messages: makeMessages(60),
      bHasMore: true
    });

    const cached = readSessionCache('ws-1', 'session-1');
    expect(cached?.messages).toHaveLength(50);
    expect(cached?.messages.at(-1)?.content).toBe('message 59');
  });

  it('never clobbers an existing snapshot with an empty one', () => {
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession(),
      messages: makeMessages(2),
      bHasMore: false
    });
    writeSessionCache('ws-1', 'session-1', { session: null, messages: [], bHasMore: false });

    const cached = readSessionCache('ws-1', 'session-1');
    expect(cached?.messages).toHaveLength(2);
  });

  it('preserves existing messages when writing a session-only snapshot', () => {
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession({ name: 'Old name' }),
      messages: makeMessages(3),
      bHasMore: true
    });
    // Fresh session meta arrived before the history frame — must not wipe messages.
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession({ name: 'New name' }),
      messages: [],
      bHasMore: false
    });

    const cached = readSessionCache('ws-1', 'session-1');
    expect(cached?.session?.name).toBe('New name');
    expect(cached?.messages).toHaveLength(3);
    expect(cached?.bHasMore).toBe(true);
  });

  it('allows server-confirmed empty history to replace cached messages', () => {
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession(),
      messages: makeMessages(3),
      bHasMore: true
    });
    writeSessionCache(
      'ws-1',
      'session-1',
      { session: makeSession(), messages: [], bHasMore: false },
      { allowEmptyMessages: true }
    );

    const cached = readSessionCache('ws-1', 'session-1');
    expect(cached?.messages).toHaveLength(0);
    expect(cached?.bHasMore).toBe(false);
  });

  it('keeps only the latest 5 session caches', () => {
    for (let i = 0; i < 7; i += 1) {
      writeSessionCache('ws-1', `session-${i}`, {
        session: makeSession({ id: `session-${i}` }),
        messages: makeMessages(1),
        bHasMore: false
      });
    }
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('nova:sessionCache:'));
    expect(keys).toHaveLength(5);
    expect(localStorage.getItem('nova:sessionCache:ws-1:session-6')).not.toBeNull();
  });

  it('removes a session cache on delete', () => {
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession(),
      messages: makeMessages(2),
      bHasMore: false
    });
    removeSessionCache('ws-1', 'session-1');
    expect(readSessionCache('ws-1', 'session-1')).toBeNull();
  });

  it('returns null for corrupt or foreign data', () => {
    localStorage.setItem('nova:sessionCache:ws-1:session-1', '{not json');
    expect(readSessionCache('ws-1', 'session-1')).toBeNull();

    localStorage.setItem(
      'nova:sessionCache:ws-1:session-1',
      JSON.stringify({ version: 999, messages: [] })
    );
    expect(readSessionCache('ws-1', 'session-1')).toBeNull();
  });
});
