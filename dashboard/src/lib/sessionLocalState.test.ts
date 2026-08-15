// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';

// lib
import { persistSessionPrompt, readSessionPrompt } from '@/lib/pendingSessionPrompt';
import { forgetLocalStateForId, forgetSessionLocalState } from '@/lib/sessionLocalState';
import { readSessionCache, writeSessionCache } from '@/lib/sessionCache';

// types
import type { Session } from '@/@types/index';

function makeSession(): Session {
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
    archived: false
  };
}

describe('sessionLocalState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('drops cache and draft for a workspace session', () => {
    writeSessionCache('ws-1', 'session-1', {
      session: makeSession(),
      messages: [{ role: 'user', content: 'hi', createdAt: '2026-07-24T10:00:00.000Z' }],
      bHasMore: false
    });
    persistSessionPrompt('ws-1', 'session-1', 'draft');

    forgetSessionLocalState('ws-1', 'session-1');

    expect(readSessionCache('ws-1', 'session-1')).toBeNull();
    expect(readSessionPrompt('ws-1', 'session-1')).toBeNull();
  });

  it('drops matching local data by entity id', () => {
    persistSessionPrompt('ws-1', 'session-1', 'draft');
    forgetLocalStateForId('session-1');
    expect(readSessionPrompt('ws-1', 'session-1')).toBeNull();
  });
});
