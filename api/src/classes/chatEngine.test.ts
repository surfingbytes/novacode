// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, runClaudeAcp, cancelClaudeAcp } = vi.hoisted(() => ({
  dbMock: {
    getSession: vi.fn(),
    getWorkspace: vi.fn(),
    listSessionMessages: vi.fn(),
    countSessionMessages: vi.fn(),
    persistSessionMessages: vi.fn(),
    getFirstUser: vi.fn(),
    updateSession: vi.fn(),
    setSessionAcpId: vi.fn(async () => {}),
    recordSessionUsage: vi.fn(),
    listUsers: vi.fn(async () => [])
  },
  runClaudeAcp: vi.fn(),
  cancelClaudeAcp: vi.fn()
}));

vi.mock('./database', () => ({ db: dbMock }));
vi.mock('./claudeAcp', () => ({ runClaudeAcp, cancelClaudeAcp }));
vi.mock('./sessionSpec', () => ({
  readSessionSpec: vi.fn(async () => null),
  workspaceSpecDir: vi.fn(() => '/specs'),
  buildSpecPromptNote: vi.fn(() => '')
}));
vi.mock('./push', () => ({ sendTaskDonePush: vi.fn(async () => {}) }));
vi.mock('./sessionListBroadcast', () => ({ broadcastSessionListUpsert: vi.fn() }));
vi.mock('./workspacePaths', () => ({
  isPathUnderBrowseRoot: () => true,
  resolveWorkspaceAbsolutePath: (path: string) => path
}));

// classes
import {
  cancelAllRuns,
  dispatchPrompt,
  getActiveSessionIds,
  isSessionBusy,
  startClaudeAutoContinue,
  stopClaudeAutoContinue,
  subscribeBusy,
  unsubscribeBusy
} from './chatEngine';
import { HANDOFF_CONTEXT_CONFIG_KEY, serializeHandoffContext } from './sessionHandoffConfig';

// types
import type { ChatMessage } from '../@types/index';
import type { ChatSubscriber } from './chatEngine';

function makeSubscriber() {
  return {
    onStream: vi.fn(),
    onDone: vi.fn<ChatSubscriber['onDone']>(),
    onError: vi.fn<ChatSubscriber['onError']>(),
    onHistory: vi.fn()
  } satisfies ChatSubscriber;
}

const busyEvents: Array<{ sessionId: string; busy: boolean }> = [];
const onBusy = (sessionId: string, _workspaceId: string, busy: boolean): void => {
  busyEvents.push({ sessionId, busy });
};

beforeEach(() => {
  busyEvents.length = 0;
  subscribeBusy(onBusy);
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
  dbMock.listSessionMessages.mockResolvedValue([]);
  dbMock.countSessionMessages.mockResolvedValue(0);
  dbMock.persistSessionMessages.mockResolvedValue(null);
  dbMock.getFirstUser.mockResolvedValue(null);
});

afterEach(() => {
  unsubscribeBusy(onBusy);
  vi.clearAllMocks();
});

async function waitForIdle(sessionId: string): Promise<void> {
  await vi.waitFor(() => expect(isSessionBusy(sessionId)).toBe(false));
}

describe('dispatchPrompt failure path', () => {
  it('cleans up and broadcasts one error when the agent throws before any output', async () => {
    runClaudeAcp.mockImplementation(() => {
      throw new Error('adapter exploded');
    });
    const subscriber = makeSubscriber();

    expect(await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber })).toEqual({});
    await waitForIdle('s1');
    await vi.waitFor(() => expect(subscriber.onError).toHaveBeenCalledTimes(1));

    expect(getActiveSessionIds().size).toBe(0);
    expect(busyEvents).toEqual([
      { sessionId: 's1', busy: true },
      { sessionId: 's1', busy: false }
    ]);
    expect(subscriber.onError.mock.calls[0]![0]).toContain('adapter exploded');
    expect(subscriber.onDone).not.toHaveBeenCalled();

    // The error is saved on the turn's assistant message so the chat history shows it.
    const lastPersist = dbMock.persistSessionMessages.mock.calls.at(-1)!;
    const saved = lastPersist[1] as ChatMessage[];
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saved[1]!.events!.map((line) => JSON.parse(line))).toEqual([{ type: 'stderr', text: 'adapter exploded' }]);
  });

  it('still emits onDone exactly once on success', async () => {
    runClaudeAcp.mockResolvedValue({ acpSessionId: 'acp-1', stopReason: 'end_turn' });
    const subscriber = makeSubscriber();

    await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber });
    await waitForIdle('s1');
    await vi.waitFor(() => expect(subscriber.onDone).toHaveBeenCalledTimes(1));
    expect(subscriber.onError).not.toHaveBeenCalled();
  });
});

describe('dispatchPrompt fresh-session context', () => {
  it('saves the ACP session id as soon as the agent reports it', async () => {
    runClaudeAcp.mockImplementation(async (opts: { onSessionId: (id: string) => void }) => {
      opts.onSessionId('acp-1');
      return { acpSessionId: 'acp-1', stopReason: 'end_turn' };
    });

    await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber: makeSubscriber() });
    await waitForIdle('s1');

    expect(dbMock.setSessionAcpId).toHaveBeenCalledWith('s1', 'acp-1');
  });

  it('gives the handoff note to a fresh ACP session on a later turn, not in the prompt', async () => {
    dbMock.getSession.mockResolvedValue({
      ...(await dbMock.getSession()),
      sessionConfigJson: JSON.stringify({
        [HANDOFF_CONTEXT_CONFIG_KEY]: serializeHandoffContext({ sessionId: 'src', sessionName: 'Old chat', summary: 'NOTE-123' })
      })
    });
    // Earlier turn was interrupted before its ACP session id was saved.
    dbMock.listSessionMessages.mockResolvedValue([
      { role: 'user', content: 'first', createdAt: '2026-01-01T00:00:00.000Z' }
    ]);
    dbMock.countSessionMessages.mockResolvedValue(1);
    runClaudeAcp.mockResolvedValue({ acpSessionId: 'acp-2', stopReason: 'end_turn' });

    await dispatchPrompt({ sessionId: 's1', text: 'continue', subscriber: makeSubscriber() });
    await waitForIdle('s1');

    const opts = runClaudeAcp.mock.calls[0]![0] as { promptText: string; getFreshSessionPrefix: () => Promise<string> };
    expect(opts.promptText).toBe('continue');
    expect(await opts.getFreshSessionPrefix()).toContain('NOTE-123');
  });
});

describe('cancelAllRuns', () => {
  it('cancels every active run and waits for its cleanup', async () => {
    let finishRun: (() => void) | undefined;
    runClaudeAcp.mockImplementation(
      (opts: { onSessionId: (id: string) => void }) =>
        new Promise((resolve) => {
          opts.onSessionId('acp-1');
          finishRun = () => resolve({ acpSessionId: 'acp-1', stopReason: 'cancelled' });
        })
    );
    cancelClaudeAcp.mockImplementation(() => finishRun?.());
    const subscriber = makeSubscriber();

    await dispatchPrompt({ sessionId: 's1', text: 'hi', subscriber });
    await vi.waitFor(() => expect(finishRun).toBeDefined());
    expect(isSessionBusy('s1')).toBe(true);

    await cancelAllRuns('shutdown');

    expect(cancelClaudeAcp).toHaveBeenCalledWith('acp-1');
    expect(isSessionBusy('s1')).toBe(false);
    expect(subscriber.onDone).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately when nothing runs', async () => {
    await expect(cancelAllRuns('shutdown')).resolves.toBeUndefined();
  });
});

describe('Claude auto-continue scheduler', () => {
  afterEach(() => {
    stopClaudeAutoContinue();
    vi.useRealTimers();
  });

  it('does not touch the database on import; only once started', async () => {
    expect(dbMock.listUsers).not.toHaveBeenCalled();

    vi.useFakeTimers();
    startClaudeAutoContinue();
    startClaudeAutoContinue();
    await vi.advanceTimersByTimeAsync(0);
    expect(dbMock.listUsers).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(dbMock.listUsers).toHaveBeenCalledTimes(2);

    stopClaudeAutoContinue();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(dbMock.listUsers).toHaveBeenCalledTimes(2);
  });
});
