// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  updateOrchestratorAndBroadcast: vi.fn(),
  git: {
    resolveRepo: vi.fn(),
    createSnapshotCommit: vi.fn(),
    changedFiles: vi.fn(),
    headCommit: vi.fn(),
    addWorktree: vi.fn(),
    linkIgnoredEntries: vi.fn(),
    commitAll: vi.fn(),
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
    branchExists: vi.fn(),
    applyCommitRangeToWorkingTree: vi.fn(),
    mergeBranch: vi.fn(),
    unmergedFiles: vi.fn(),
    filesWithConflictMarkers: vi.fn(),
    abortMerge: vi.fn(),
    concludeMerge: vi.fn()
  }
}));

vi.mock('./database', () => ({ db: mocks.db, normalizeTagStringList: (tags: string[]) => tags.join(',') }));
vi.mock('./gitWorktrees', () => ({ ...mocks.git, worktreesRootDir: () => '/worktrees' }));
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

beforeEach(() => {
  // Workspaces are no git repositories unless a test says otherwise.
  mocks.git.resolveRepo.mockResolvedValue({ error: 'Parallel runs need the workspace to be a git repository.' });
});

afterEach(() => {
  vi.resetAllMocks();
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

describe('merge step', () => {
  it('is done with nothing to merge in a one-by-one run, without a session', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/ws' });
    let sessionCount = 0;
    mocks.createSessionWithAgent.mockImplementation(async () => ({
      session: { id: `step-s${++sessionCount}`, modelSelection: 'auto', sessionMode: 'default' }
    }));
    mocks.dispatchPromptAndWait.mockResolvedValue({ messages: [] });
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [
        { name: 'Step 1', prompt: 'do it' },
        { name: 'Merge into workspace', prompt: 'merge', kind: 'merge', mergeRef: { base: 'abc', branch: 'nova/o1/integration' } },
        { name: 'Verify against spec', prompt: 'check', kind: 'verify', dependsOn: [0, 1] }
      ]
    };

    await runOrchestrator('w1', 'o1', payload, { mode: 'sequential' });

    expect(payload.subtasks[0]).toMatchObject({ runResult: 'done', sessionId: 'step-s1' });
    expect(payload.subtasks[1]).toMatchObject({ runResult: 'done', runNote: 'Nothing to merge: the steps worked in the workspace.', mergeRef: null });
    expect(payload.subtasks[1].sessionId).toBeUndefined();
    expect(payload.subtasks[2]).toMatchObject({ runResult: 'done', sessionId: 'step-s2' });
    expect(mocks.createSessionWithAgent).toHaveBeenCalledTimes(2);
    expect(mocks.updateOrchestratorAndBroadcast).toHaveBeenLastCalledWith('w1', 'o1', expect.objectContaining({ runStatus: 'completed', runTotalSteps: 3 }));
  });
});

describe('sequential run', () => {
  it('leaves finished steps alone and runs the rest', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/ws' });
    mocks.createSessionWithAgent.mockResolvedValue({ session: { id: 'step-s9', modelSelection: 'auto', sessionMode: 'default' } });
    mocks.dispatchPromptAndWait.mockResolvedValue({ messages: [] });
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    const kept = { name: 'Step 1', prompt: 'done already', runResult: 'done' as const, sessionId: 'step-s1', startedAt: 'a', finishedAt: 'b' };
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [{ ...kept }, { name: 'Step 2', prompt: 'then this' }]
    };

    await runOrchestrator('w1', 'o1', payload, { mode: 'sequential' });

    expect(payload.subtasks[0]).toEqual(kept);
    expect(payload.subtasks[1]).toMatchObject({ runResult: 'done', sessionId: 'step-s9' });
    expect(mocks.createSessionWithAgent).toHaveBeenCalledTimes(1);
  });
});

describe('step timing', () => {
  it('stamps worker, merge and verify steps when they start and end; skipped steps get no timing', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/ws' });
    let sessionCount = 0;
    mocks.createSessionWithAgent.mockImplementation(async () => ({
      session: { id: `step-s${++sessionCount}`, modelSelection: 'auto', sessionMode: 'default' }
    }));
    // The first step fails, the second succeeds.
    mocks.dispatchPromptAndWait.mockResolvedValueOnce({ error: 'boom' }).mockResolvedValue({ messages: [] });
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [
        { name: 'Step 1', prompt: 'do it' },
        { name: 'Step 2', prompt: 'then this' },
        { name: 'Merge into workspace', prompt: 'merge', kind: 'merge' },
        { name: 'Verify against spec', prompt: 'check', kind: 'verify', dependsOn: [0, 1] }
      ]
    };

    const before = Date.now();
    await runOrchestrator('w1', 'o1', payload, { mode: 'sequential' });

    for (const index of [0, 1, 2]) {
      const task = payload.subtasks[index];
      expect(task.startedAt).toMatch(ISO_DATE);
      expect(task.finishedAt).toMatch(ISO_DATE);
      expect(Date.parse(task.startedAt!)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(task.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(task.startedAt!));
    }
    expect(payload.subtasks[0].runResult).toBe('failed');
    expect(payload.subtasks[1].runResult).toBe('done');
    expect(payload.subtasks[2].runResult).toBe('done');
    expect(payload.subtasks[3]).toMatchObject({ runResult: 'skipped' });
    expect(payload.subtasks[3].startedAt).toBeUndefined();
    expect(payload.subtasks[3].finishedAt).toBeUndefined();
    // Not a git workspace: the changed-file count stays untouched.
    expect(mocks.updateOrchestratorAndBroadcast).toHaveBeenLastCalledWith('w1', 'o1', expect.not.objectContaining({ runChangedFiles: expect.anything() }));
  });

  it('clears finishedAt while a step runs and sets it when the step is failed by the run ending', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/ws' });
    mocks.createSessionWithAgent.mockResolvedValue({ session: { id: 'step-s1', modelSelection: 'auto', sessionMode: 'default' } });
    mocks.dispatchPromptAndWait.mockReturnValue(new Promise(() => {}));
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [{ name: 'Step 1', prompt: 'do it', finishedAt: '2026-01-01T00:00:00.000Z' }]
    };

    const done = runOrchestrator('w1', 'o1', payload, { mode: 'sequential', onlyIndex: 0 });
    await vi.waitFor(() => expect(mocks.dispatchPromptAndWait).toHaveBeenCalled());
    expect(payload.subtasks[0]).toMatchObject({ runResult: 'running', finishedAt: null });
    expect(payload.subtasks[0].startedAt).toMatch(ISO_DATE);

    cancelOrchestratorStep('step-s1', 'Step session deleted');
    await done;

    expect(payload.subtasks[0].runResult).toBe('failed');
    expect(payload.subtasks[0].finishedAt).toMatch(ISO_DATE);
  });
});

describe('parallel run in a git workspace', () => {
  it('keeps the branch of a failed step and counts the files the run changed', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null, maxParallel: 2 });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/repo' });
    let sessionCount = 0;
    mocks.createSessionWithAgent.mockImplementation(async () => ({
      session: { id: `step-s${++sessionCount}`, modelSelection: 'auto', sessionMode: 'default' }
    }));
    mocks.dispatchPromptAndWait.mockResolvedValue({ error: 'boom' });
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    mocks.git.resolveRepo.mockResolvedValue({ root: '/repo', subdir: '' });
    let snapshotCount = 0;
    mocks.git.createSnapshotCommit.mockImplementation(async () => `snap-${++snapshotCount}`);
    mocks.git.headCommit.mockResolvedValue('integration-head');
    mocks.git.linkIgnoredEntries.mockResolvedValue([]);
    mocks.git.branchExists.mockResolvedValue(true);
    mocks.git.applyCommitRangeToWorkingTree.mockResolvedValue({ ok: true, bChanged: true });
    mocks.git.changedFiles.mockResolvedValue(['a.ts', 'b.ts', 'c.ts']);
    const payload: OrchestratorSubtasksPayload = {
      sharedContext: '',
      handoffLog: '',
      subtasks: [
        { name: 'Step 1', prompt: 'do it' },
        { name: 'Merge into workspace', prompt: 'merge', kind: 'merge' },
        { name: 'Verify against spec', prompt: 'check', kind: 'verify', dependsOn: [0, 1] }
      ]
    };

    await runOrchestrator('w1', 'o1', payload, { mode: 'parallel' });

    expect(payload.subtasks[0]).toMatchObject({
      runResult: 'failed',
      runNote: 'boom — its changes are kept on branch nova/o1/step-1.',
      keptBranch: { base: 'integration-head', branch: 'nova/o1/step-1' }
    });
    expect(payload.subtasks[1]).toMatchObject({ runResult: 'done', mergeRef: null });
    expect(payload.subtasks[1].keptBranch).toBeUndefined();
    expect(payload.subtasks[2].runResult).toBe('skipped');
    // Snapshots: run start, integration base, run end.
    expect(mocks.git.createSnapshotCommit).toHaveBeenCalledTimes(3);
    expect(mocks.git.changedFiles).toHaveBeenCalledWith('/repo', 'snap-1', 'snap-3');
    expect(mocks.updateOrchestratorAndBroadcast).toHaveBeenLastCalledWith('w1', 'o1', expect.objectContaining({ runStatus: 'failed', runChangedFiles: 3 }));
  });

  it('never counts changed files for a single-step run', async () => {
    mocks.db.getOrchestrator.mockResolvedValue({ id: 'o1', name: 'Plan', agentType: 'claude', runStatus: 'running', sourceSessionId: null });
    mocks.db.getWorkspace.mockResolvedValue({ id: 'w1', path: '/repo' });
    mocks.createSessionWithAgent.mockResolvedValue({ session: { id: 'step-s1', modelSelection: 'auto', sessionMode: 'default' } });
    mocks.dispatchPromptAndWait.mockResolvedValue({ messages: [] });
    mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
    mocks.git.resolveRepo.mockResolvedValue({ root: '/repo', subdir: '' });
    const payload: OrchestratorSubtasksPayload = { sharedContext: '', handoffLog: '', subtasks: [{ name: 'Step 1', prompt: 'do it' }] };

    await runOrchestrator('w1', 'o1', payload, { mode: 'sequential', onlyIndex: 0 });

    expect(mocks.git.createSnapshotCommit).not.toHaveBeenCalled();
    expect(mocks.updateOrchestratorAndBroadcast).toHaveBeenLastCalledWith('w1', 'o1', expect.not.objectContaining({ runChangedFiles: expect.anything() }));
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
