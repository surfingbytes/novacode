// node_modules
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    listUsers: vi.fn(),
    listSessions: vi.fn(),
    updateSession: vi.fn()
  },
  dispatchPrompt: vi.fn()
}));

vi.mock('../database', () => ({ db: mocks.db }));
vi.mock('./dispatch', () => ({ dispatchPrompt: mocks.dispatchPrompt }));

// classes
import { startClaudeAutoContinue, stopClaudeAutoContinue } from './autoContinue';

function setUp(dispatchResult: { error?: string; requeue?: boolean }): void {
  mocks.db.listUsers.mockResolvedValue([{ claudeAutoContinue: true }]);
  mocks.db.listSessions.mockResolvedValue([
    { id: 's1', sessionMode: 'default', claudeLimitResetAt: '2020-01-01T00:00:00.000Z' }
  ]);
  mocks.dispatchPrompt.mockResolvedValue(dispatchResult);
}

afterEach(() => {
  stopClaudeAutoContinue();
  vi.clearAllMocks();
});

describe('Claude auto-continue', () => {
  it('clears the reset time once the continue prompt is dispatched', async () => {
    setUp({});
    startClaudeAutoContinue();

    await vi.waitFor(() => expect(mocks.db.updateSession).toHaveBeenCalledWith('s1', { claudeLimitResetAt: null }));
  });

  it('keeps the reset time for a retry when the agent is busy', async () => {
    setUp({ error: 'Agent is busy', requeue: true });
    startClaudeAutoContinue();

    await vi.waitFor(() => expect(mocks.dispatchPrompt).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.db.updateSession).not.toHaveBeenCalled();
  });
});
