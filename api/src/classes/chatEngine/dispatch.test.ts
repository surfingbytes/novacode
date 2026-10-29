// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, runClaudeAcp } = vi.hoisted(() => ({
  dbMock: {
    getSession: vi.fn(),
    getWorkspace: vi.fn(),
    listSessionMessages: vi.fn(),
    countSessionMessages: vi.fn(),
    persistSessionMessages: vi.fn(),
    getFirstUser: vi.fn(),
    updateSession: vi.fn(),
    setSessionAcpId: vi.fn(async () => {}),
    recordSessionUsage: vi.fn()
  },
  runClaudeAcp: vi.fn()
}));

vi.mock('../database', () => ({ db: dbMock }));
vi.mock('../claudeAcp', () => ({ runClaudeAcp, cancelClaudeAcp: vi.fn() }));
vi.mock('../sessionSpec', () => ({
  readSessionSpec: vi.fn(async () => null),
  workspaceSpecDir: vi.fn(() => '/specs'),
  buildSpecPromptNote: vi.fn(() => '')
}));
vi.mock('../push', () => ({ sendTaskDonePush: vi.fn(async () => {}) }));
vi.mock('../sessionListBroadcast', () => ({ broadcastSessionListUpsert: vi.fn() }));
vi.mock('../workspacePaths', () => ({
  isPathUnderBrowseRoot: () => true,
  resolveWorkspaceAbsolutePath: (path: string) => path
}));

// classes
import { dispatchPrompt } from './dispatch';
import { isSessionBusy } from './state';

// types
import type { ChatMessage } from '../../@types/index';
import type { ChatSubscriber } from './types';

function makeSubscriber(): ChatSubscriber {
  return { onStream: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onHistory: vi.fn() };
}

const history: ChatMessage[] = [
  { role: 'user', content: 'one', createdAt: '2026-01-01T00:00:00.000Z' },
  { role: 'assistant', events: [], createdAt: '2026-01-01T00:00:01.000Z' },
  { role: 'user', content: 'two', createdAt: '2026-01-01T00:00:02.000Z' }
];

beforeEach(() => {
  dbMock.getSession.mockResolvedValue({
    id: 's1',
    workspaceId: 'w1',
    name: 'Session',
    agentType: 'claude',
    sessionId: null,
    sessionMode: 'default',
    sessionConfigJson: null,
    approvalPolicy: null,
    worktreePath: null
  });
  dbMock.getWorkspace.mockResolvedValue({ id: 'w1', name: 'WS', path: '/ws' });
  dbMock.listSessionMessages.mockResolvedValue(history.map((message) => ({ ...message })));
  dbMock.countSessionMessages.mockResolvedValue(history.length);
  dbMock.persistSessionMessages.mockResolvedValue(null);
  dbMock.getFirstUser.mockResolvedValue(null);
  runClaudeAcp.mockResolvedValue({ acpSessionId: 'acp-1', stopReason: 'end_turn' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('dispatchPrompt history loading', () => {
  it('requeues without saving when the history read fails', async () => {
    dbMock.listSessionMessages.mockRejectedValue(new Error('db down'));

    const result = await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber: makeSubscriber() });

    expect(result).toEqual({ error: 'Failed to load chat history', requeue: true });
    expect(dbMock.persistSessionMessages).not.toHaveBeenCalled();
    expect(isSessionBusy('s1')).toBe(false);
  });

  it('requeues without saving when the message count fails', async () => {
    dbMock.countSessionMessages.mockRejectedValue(new Error('db down'));

    const result = await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber: makeSubscriber() });

    expect(result.requeue).toBe(true);
    expect(dbMock.persistSessionMessages).not.toHaveBeenCalled();
  });

  it('saves only this turn after the existing rows', async () => {
    const result = await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber: makeSubscriber() });
    expect(result).toEqual({});
    await vi.waitFor(() => expect(isSessionBusy('s1')).toBe(false));

    expect(dbMock.persistSessionMessages).toHaveBeenCalledTimes(2);
    for (const call of dbMock.persistSessionMessages.mock.calls) {
      expect(call[3]).toEqual({ fromPosition: 3 });
    }
    const saved = dbMock.persistSessionMessages.mock.calls.at(-1)![1] as ChatMessage[];
    expect(saved.slice(3).map((message) => message.role)).toEqual(['user', 'assistant']);
  });
});
