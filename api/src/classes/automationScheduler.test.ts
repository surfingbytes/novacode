import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAutomation = vi.fn();
const getWorkspace = vi.fn();
const createAutomationRun = vi.fn();
const updateAutomation = vi.fn();
const updateAutomationRun = vi.fn();
const pruneAutomationRuns = vi.fn();
const createSessionWithAgent = vi.fn();
const dispatchPromptAndWait = vi.fn();
const sendPushToAll = vi.fn();
const broadcastAutomationRunFinished = vi.fn();

vi.mock('./database', () => ({
  db: {
    getAutomation: (...args: unknown[]) => getAutomation(...args),
    getWorkspace: (...args: unknown[]) => getWorkspace(...args),
    createAutomationRun: (...args: unknown[]) => createAutomationRun(...args),
    updateAutomation: (...args: unknown[]) => updateAutomation(...args),
    updateAutomationRun: (...args: unknown[]) => updateAutomationRun(...args),
    pruneAutomationRuns: (...args: unknown[]) => pruneAutomationRuns(...args)
  },
  normalizeTagStringList: (tags: string[]) => tags
}));

vi.mock('./runGit', () => ({
  runGit: vi.fn().mockRejectedValue(new Error('not a git repo'))
}));

vi.mock('./sessionService', () => ({
  createSessionWithAgent: (...args: unknown[]) => createSessionWithAgent(...args)
}));

vi.mock('./chatEngine', () => ({
  dispatchPromptAndWait: (...args: unknown[]) => dispatchPromptAndWait(...args)
}));

vi.mock('./push', () => ({
  sendPushToAll: (...args: unknown[]) => sendPushToAll(...args)
}));

vi.mock('./wsBroadcast', () => ({
  broadcastAutomationRunFinished: (...args: unknown[]) => broadcastAutomationRunFinished(...args)
}));

vi.mock('./workspacePaths', () => ({
  resolveWorkspaceAbsolutePath: () => '/nonexistent/automation-scheduler-test'
}));

vi.mock('./logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

import { runAutomation } from './automationScheduler';

const automationRow = {
  id: 'a1',
  workspaceId: 'w1',
  name: 'Nightly check',
  agentType: 'claude',
  prompt: 'Check things',
  intervalMinutes: 60
};

/** finishedAt the scheduler stored on the run row. */
function storedFinishedAt(): string {
  const call = updateAutomationRun.mock.calls.find(
    (args) => typeof (args[1] as { finishedAt?: string }).finishedAt === 'string'
  );
  return (call?.[1] as { finishedAt: string }).finishedAt;
}

describe('automationScheduler run-finished broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAutomation.mockResolvedValue(automationRow);
    getWorkspace.mockResolvedValue({ id: 'w1', path: 'w1' });
    createAutomationRun.mockResolvedValue({ id: 'r1' });
    createSessionWithAgent.mockResolvedValue({ session: { id: 's1' } });
  });

  it('broadcasts success with a null error', async () => {
    dispatchPromptAndWait.mockResolvedValue({ messages: [] });
    await runAutomation('a1');
    expect(broadcastAutomationRunFinished).toHaveBeenCalledTimes(1);
    expect(broadcastAutomationRunFinished).toHaveBeenCalledWith('w1', {
      automationId: 'a1',
      workspaceId: 'w1',
      automationName: 'Nightly check',
      status: 'success',
      error: null,
      finishedAt: storedFinishedAt()
    });
  });

  it('broadcasts failure with the stored error', async () => {
    dispatchPromptAndWait.mockResolvedValue({ messages: [], error: 'Agent crashed' });
    await runAutomation('a1');
    expect(updateAutomation).toHaveBeenLastCalledWith('a1', {
      lastRunStatus: 'failed',
      lastRunError: 'Agent crashed'
    });
    expect(broadcastAutomationRunFinished).toHaveBeenCalledWith('w1', {
      automationId: 'a1',
      workspaceId: 'w1',
      automationName: 'Nightly check',
      status: 'failed',
      error: 'Agent crashed',
      finishedAt: storedFinishedAt()
    });
  });

  it('broadcasts failure when the session cannot be created', async () => {
    createSessionWithAgent.mockResolvedValue({ error: 'No agent' });
    await runAutomation('a1');
    expect(broadcastAutomationRunFinished).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ status: 'failed', error: 'No agent', finishedAt: storedFinishedAt() })
    );
  });

  it('broadcasts failure when the run throws', async () => {
    dispatchPromptAndWait.mockRejectedValue(new Error('Timed out'));
    await runAutomation('a1');
    expect(broadcastAutomationRunFinished).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ status: 'failed', error: 'Timed out', finishedAt: storedFinishedAt() })
    );
  });
});
