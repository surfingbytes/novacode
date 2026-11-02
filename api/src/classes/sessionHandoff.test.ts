import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSessionMessagesPage: vi.fn(),
  runServerPromptInSession: vi.fn()
}));

vi.mock('./database', () => ({
  db: {
    getSession: (...args: unknown[]) => mocks.getSession(...args),
    listSessionMessagesPage: (...args: unknown[]) => mocks.listSessionMessagesPage(...args)
  }
}));
vi.mock('./chatEngine', () => ({ getActiveRun: () => undefined }));
vi.mock('./chatQueue', () => ({
  drainQueue: vi.fn(),
  enqueuePrompt: vi.fn(),
  runServerPromptInSession: (...args: unknown[]) => mocks.runServerPromptInSession(...args)
}));
vi.mock('./chatSockets', () => ({ broadcastChat: vi.fn() }));
vi.mock('./sessionListBroadcast', () => ({ broadcastSessionListUpsert: vi.fn() }));
vi.mock('./sessionService', () => ({ createSessionWithAgent: vi.fn() }));
vi.mock('./sessionTitle', () => ({ maybeNameUntitledSession: vi.fn() }));

import { startContinueInNewChat } from './sessionHandoff';
import { BadRequestError, ConflictError } from './httpErrors';

const input = { workspaceId: 'w1', sessionId: 's1', text: 'go on', imagePaths: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ id: 's1', workspaceId: 'w1' });
  mocks.listSessionMessagesPage.mockResolvedValue({ messages: [{ id: 'm1' }] });
  // The summary turn fails fast so the slot is released after each test.
  mocks.runServerPromptInSession.mockResolvedValue({ error: 'stop' });
});

describe('startContinueInNewChat', () => {
  it('starts only one handoff when two requests race', async () => {
    const results = await Promise.allSettled([startContinueInNewChat(input), startContinueInNewChat(input)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictError);
    await vi.waitFor(() => expect(mocks.runServerPromptInSession).toHaveBeenCalledTimes(1));
  });

  it('frees the slot when the session has nothing to continue from', async () => {
    mocks.listSessionMessagesPage.mockResolvedValueOnce({ messages: [] });

    await expect(startContinueInNewChat(input)).rejects.toBeInstanceOf(BadRequestError);
    await expect(startContinueInNewChat(input)).resolves.toBeUndefined();
  });
});
