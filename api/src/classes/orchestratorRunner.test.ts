// node_modules
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    getOrchestrator: vi.fn(),
    getWorkspace: vi.fn(),
    getSession: vi.fn(),
    setSessionWorktreePath: vi.fn(),
    failStaleRunningOrchestrators: vi.fn()
  },
  createSessionWithAgent: vi.fn(),
  dispatchPromptAndWait: vi.fn(),
  updateOrchestratorAndBroadcast: vi.fn()
}));

vi.mock('./database', () => ({ db: mocks.db, normalizeTagStringList: (tags: string[]) => tags.join(',') }));
vi.mock('./sessionService', () => ({ createSessionWithAgent: mocks.createSessionWithAgent }));
vi.mock('./chatEngine', () => ({
  dispatchPromptAndWait: mocks.dispatchPromptAndWait,
  isSessionBusy: () => false,
  subscribeBusy: vi.fn(),
  unsubscribeBusy: vi.fn()
}));
vi.mock('./novaMcp', () => ({ isNovaMcpEnabled: () => false }));
vi.mock('./push', () => ({ sendPushToAll: vi.fn(async () => {}) }));
vi.mock('./orchestratorEvents', () => ({ updateOrchestratorAndBroadcast: mocks.updateOrchestratorAndBroadcast }));

// classes
import { cancelAllOrchestratorRuns, cancelOrchestratorStep, runOrchestrator } from './orchestratorRunner';

// types
import type { OrchestratorSubtasksPayload } from '../@types/index';

afterEach(() => {
  vi.resetAllMocks();
});

describe('cancelOrchestratorStep', () => {
  it('returns false when no step runs in the session', () => {
    expect(cancelOrchestratorStep('nobody', 'x')).toBe(false);
  });

  it('fails the running step with the reason instead of marking it done', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/ws' });
    mocks.createSessionWithAgent.mockResolvedValue({ session: { id: 'step-s1', modelSelection: 'auto', sessionMode: 'default' } });
    // The step's turn never ends on its own.
    mocks.dispatchPromptAndWait.mockReturnValue(new Promise(() => {}));
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [{ name: 'Step 1', prompt: 'do it' }]
    };

    const done = runOrchestrator('w1', 'o1', payload, { mode: 'sequential', onlyIndex: 0 });
    await vi.waitFor(() => expect(mocks.dispatchPromptAndWait).toHaveBeenCalled());

    expect(cancelOrchestratorStep('step-s1', 'Step session deleted')).toBe(true);
    await done;

    expect(payload.subtasks[0]).toMatchObject({ runResult: 'failed', runNote: 'Step session deleted' });
    expect(cancelOrchestratorStep('step-s1', 'again')).toBe(false);
  });
});

describe('cancelAllOrchestratorRuns', () => {
  it('returns at once when nothing runs', async () => {
    mocks.db.failStaleRunningOrchestrators.mockResolvedValue(0);
    await cancelAllOrchestratorRuns('server shutdown');
    expect(mocks.db.failStaleRunningOrchestrators).toHaveBeenCalledOnce();
  });

  it('marks runs failed, fails the running step with the reason and waits for the run to end', async () => {
    const orchestrator = { id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null };
    mocks.db.getOrchestrator.mockImplementation(async () => ({ ...orchestrator }));
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/ws' });
    mocks.db.failStaleRunningOrchestrators.mockImplementation(async () => {
      orchestrator.runStatus = 'failed';
      return 1;
    });
    mocks.createSessionWithAgent.mockResolvedValue({ session: { id: 'step-s1', modelSelection: 'auto', sessionMode: 'default' } });
    mocks.dispatchPromptAndWait.mockReturnValue(new Promise(() => {}));
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [
        { name: 'Step 1', prompt: 'do it' },
        { name: 'Step 2', prompt: 'then this' }
      ]
    };

    let bRunEnded = false;
    void runOrchestrator('w1', 'o1', payload, { mode: 'sequential' }).then(() => {
      bRunEnded = true;
    });
    await vi.waitFor(() => expect(mocks.dispatchPromptAndWait).toHaveBeenCalled());

    await cancelAllOrchestratorRuns('server shutdown');

    expect(bRunEnded).toBe(true);
    expect(payload.subtasks[0]).toMatchObject({ runResult: 'failed', runNote: 'server shutdown' });
    expect(payload.subtasks[1].runResult).toBeUndefined();
    expect(mocks.dispatchPromptAndWait).toHaveBeenCalledOnce();
  });
});
