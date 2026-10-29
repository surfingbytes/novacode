import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => {
  process.env['JWT_SECRET'] = 'test-secret-'.padEnd(48, 'x');
  return {
    getUserById: vi.fn(),
    getUserByUsername: vi.fn(),
    getWorkspace: vi.fn(),
    getSession: vi.fn(),
    getOrchestrator: vi.fn(),
    getLatestOrchestratorBySourceSession: vi.fn(),
    createOrchestrator: vi.fn(),
    updateOrchestrator: vi.fn(),
    createSessionWithAgent: vi.fn(),
    checkRunPreconditions: vi.fn(),
    inFlightRunSteps: vi.fn(),
    claimRunResume: vi.fn(),
    finishRunResume: vi.fn(),
    runOrchestrator: vi.fn(),
    resolveRepo: vi.fn(),
    branchExists: vi.fn(),
    deleteBranch: vi.fn(),
    applyCommitRangeToWorkingTree: vi.fn(),
    broadcastOrchestratorUpsert: vi.fn()
  };
});

vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    getUserById: (...args: unknown[]) => mocks.getUserById(...args),
    getUserByUsername: (...args: unknown[]) => mocks.getUserByUsername(...args),
    getWorkspace: (...args: unknown[]) => mocks.getWorkspace(...args),
    getSession: (...args: unknown[]) => mocks.getSession(...args),
    getOrchestrator: (...args: unknown[]) => mocks.getOrchestrator(...args),
    getLatestOrchestratorBySourceSession: (...args: unknown[]) => mocks.getLatestOrchestratorBySourceSession(...args),
    createOrchestrator: (...args: unknown[]) => mocks.createOrchestrator(...args),
    updateOrchestrator: (...args: unknown[]) => mocks.updateOrchestrator(...args)
  }
}));

// No agent processes: the planning chat and the run loop are stubbed.
vi.mock('../classes/sessionService', () => ({
  createSessionWithAgent: (...args: unknown[]) => mocks.createSessionWithAgent(...args)
}));

vi.mock('../classes/orchestratorRunner', () => ({
  checkRunPreconditions: (...args: unknown[]) => mocks.checkRunPreconditions(...args),
  inFlightRunSteps: (...args: unknown[]) => mocks.inFlightRunSteps(...args),
  claimRunResume: (...args: unknown[]) => mocks.claimRunResume(...args),
  finishRunResume: (...args: unknown[]) => mocks.finishRunResume(...args),
  runOrchestrator: (...args: unknown[]) => mocks.runOrchestrator(...args),
  markStepNeedsInput: () => false
}));

// No git: the preconditions route's repo lookup and the kept-branch routes' git calls are stubbed.
vi.mock('../classes/gitWorktrees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/gitWorktrees')>()),
  resolveRepo: (...args: unknown[]) => mocks.resolveRepo(...args),
  branchExists: (...args: unknown[]) => mocks.branchExists(...args),
  deleteBranch: (...args: unknown[]) => mocks.deleteBranch(...args),
  applyCommitRangeToWorkingTree: (...args: unknown[]) => mocks.applyCommitRangeToWorkingTree(...args)
}));

vi.mock('../classes/wsBroadcast', () => ({
  broadcastOrchestratorUpsert: (...args: unknown[]) => mocks.broadcastOrchestratorUpsert(...args),
  broadcastWorkspaceSessionsRefresh: vi.fn()
}));

vi.mock('../classes/sessionListBroadcast', () => ({ broadcastSessionListUpsert: vi.fn() }));
vi.mock('../classes/sessionImages', () => ({ deleteSessionImages: vi.fn() }));
vi.mock('../classes/sessionSpecStatus', () => ({ publishSpecStatus: async (): Promise<void> => {} }));
vi.mock('../classes/sessionSpec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/sessionSpec')>()),
  readSessionSpec: async () => ({ path: '/spec.md', content: '# Spec\n\nDone.' })
}));

// The real switch lives under /config; agents get the endpoint in these tests.
vi.mock('../classes/novaMcp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/novaMcp')>()),
  isNovaMcpEnabled: () => true
}));

import { orchestratorRoutes } from './orchestrator';
import { novaMcpRoutes } from './novaMcp';
import { registerAuth, signToken } from '../classes/auth';
import { registerErrorHandler } from '../classes/errorHandler';
import { createNovaMcpToken, NOVA_MCP_PATH } from '../classes/novaMcp';

type Orchestrator = Record<string, unknown> & { id: string; workspaceId: string; subtasksJson: string | null };

let app: FastifyInstance;
let authorization: string;
let orchestrators: Map<string, Orchestrator>;

const RUN_URL = '/api/workspaces/w1/orchestrators/o1/run';
const PRECONDITIONS_URL = '/api/workspaces/w1/orchestrators/o1/run-preconditions';

function plan(subtasks: Array<Record<string, unknown>>, handoffLog = 'old log'): string {
  return JSON.stringify({ sharedContext: '', handoffLog, subtasks });
}

function storedHandoffLog(id = 'o1'): string {
  return JSON.parse(orchestrators.get(id)!.subtasksJson!).handoffLog;
}

function storeOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  const row: Orchestrator = {
    id: 'o1',
    workspaceId: 'w1',
    name: 'Plan',
    agentType: 'claude',
    runStatus: null,
    subtasksJson: null,
    ...overrides
  };
  orchestrators.set(row.id, row);
  return row;
}

function storedSubtasks(id = 'o1'): Array<Record<string, unknown>> {
  return JSON.parse(orchestrators.get(id)!.subtasksJson!).subtasks;
}

function run(payload: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: RUN_URL, headers: { authorization }, payload });
}

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  registerAuth(app);
  await app.register(orchestratorRoutes);
  await app.register(novaMcpRoutes);
  await app.ready();
  authorization = `Bearer ${await signToken('admin', 'u1', 0)}`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.resetAllMocks();
  orchestrators = new Map();
  mocks.getUserById.mockImplementation(async (id: string) => (id === 'u1' ? { id: 'u1', username: 'admin', tokenVersion: 0 } : null));
  mocks.getUserByUsername.mockResolvedValue(null);
  mocks.getWorkspace.mockImplementation(async (id: string) =>
    id === 'w1' ? { id: 'w1', path: '/tmp/w1', defaultAgentType: 'codex' } : null
  );
  mocks.getOrchestrator.mockImplementation(async (id: string) => {
    const row = orchestrators.get(id);
    return row ? { ...row } : null;
  });
  mocks.createOrchestrator.mockImplementation(async (data: Record<string, unknown> & { workspaceId: string }) => {
    const row: Orchestrator = { id: `o${orchestrators.size + 1}`, runStatus: null, subtasksJson: null, ...data };
    orchestrators.set(row.id, row);
    return { ...row };
  });
  mocks.updateOrchestrator.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const row = orchestrators.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    return { ...row };
  });
  mocks.checkRunPreconditions.mockResolvedValue(null);
  mocks.inFlightRunSteps.mockReturnValue(null);
  mocks.runOrchestrator.mockResolvedValue(undefined);
});

describe('POST /api/workspaces/:workspaceId/orchestrators', () => {
  it('creates a plan with a linked planning chat', async () => {
    mocks.createSessionWithAgent.mockResolvedValue({ session: { id: 'planner1', agentType: 'claude' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/orchestrators',
      headers: { authorization },
      payload: { name: ' Big refactor ', maxParallel: 20, planner: { agentType: 'claude', approvalPolicy: 'ask' } }
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.createSessionWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', agentType: 'claude', approvalPolicy: 'ask', name: 'Big refactor' })
    );
    expect(mocks.createOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        name: 'Big refactor',
        agentType: 'claude',
        sourceSessionId: 'planner1',
        maxParallel: 8,
        verifyAgentType: null
      })
    );
    expect(res.json()).toMatchObject({ id: 'o1', sourceSessionId: 'planner1' });
    expect(mocks.broadcastOrchestratorUpsert).toHaveBeenCalledWith('w1', expect.objectContaining({ id: 'o1' }));
  });

  it("falls back to the workspace's default agent without a planner", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/orchestrators',
      headers: { authorization },
      payload: { agentType: 'not-an-agent' }
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.createSessionWithAgent).not.toHaveBeenCalled();
    expect(mocks.createOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'codex', sourceSessionId: null, name: expect.stringMatching(/^Task plan /) })
    );
  });

  it('answers 502 when the planning chat cannot start', async () => {
    mocks.createSessionWithAgent.mockResolvedValue({ error: 'agent not logged in' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/orchestrators',
      headers: { authorization },
      payload: { planner: {} }
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'agent not logged in' });
    expect(mocks.createOrchestrator).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown workspace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/nope/orchestrators',
      headers: { authorization },
      payload: {}
    });

    expect(res.statusCode).toBe(404);
  });

  it('answers 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/w1/orchestrators', payload: {} });

    expect(res.statusCode).toBe(401);
    expect(mocks.createOrchestrator).not.toHaveBeenCalled();
  });
});

describe('POST .../orchestrators/:orchestratorId/run', () => {
  const twoSteps = [
    { name: 'A', prompt: 'do a', runResult: 'done', sessionId: 'sa' },
    { name: 'B', prompt: 'do b', runResult: 'failed', sessionId: 'sb' }
  ];

  const twoStepLog = '### Step 1: A\n\nnotes a\n\n### Step 2: B\n\nnotes b';

  it('keeps done steps and their handoff notes in a plain sequential run', async () => {
    storeOrchestrator({
      subtasksJson: plan(
        [twoSteps[0]!, { ...twoSteps[1], startedAt: 't1', finishedAt: 't2', keptBranch: { base: 'c1', branch: 'nova/b' } }],
        twoStepLog
      )
    });

    const res = await run();

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: 'o1', runStatus: 'running', runMode: 'sequential', runTotalSteps: 2, runCurrentStep: 1 });
    expect(storedSubtasks()).toEqual([twoSteps[0], { name: 'B', prompt: 'do b' }]);
    expect(storedHandoffLog()).toBe('### Step 1: A\n\nnotes a');
    expect(mocks.updateOrchestrator).toHaveBeenCalledWith('o1', expect.objectContaining({ runChangedFiles: null }));
    expect(mocks.checkRunPreconditions).toHaveBeenCalledWith(expect.any(String), { mode: 'sequential', startIndex: 0 });
    expect(mocks.runOrchestrator).toHaveBeenCalledWith(
      'w1',
      'o1',
      expect.objectContaining({ subtasks: expect.any(Array) }),
      { mode: 'sequential', startIndex: 0 }
    );
  });

  it('re-runs the merge and verify steps when a regular step runs again sequentially', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'done' },
        { name: 'B', prompt: 'b', runResult: 'failed' },
        { name: 'Merge', prompt: 'm', kind: 'merge', runResult: 'done' },
        { name: 'Verify', prompt: 'v', kind: 'verify', runResult: 'done' }
      ])
    });

    const res = await run({ mode: 'sequential' });

    expect(res.statusCode).toBe(202);
    expect(storedSubtasks().map((task) => task.runResult ?? null)).toEqual(['done', null, null, null]);
  });

  it('answers 409 for a sequential run while the last parallel result is not merged', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'done' },
        { name: 'Merge', prompt: 'm', kind: 'merge', runResult: 'failed', mergeRef: 'abc' }
      ])
    });

    const res = await run({ mode: 'sequential' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Run the "Merge into workspace" step first');
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('starts a sequential run from scratch with fresh', async () => {
    storeOrchestrator({ subtasksJson: plan(twoSteps, twoStepLog) });

    const res = await run({ mode: 'sequential', fresh: true });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ runMode: 'sequential', runCurrentStep: 0 });
    expect(storedSubtasks()).toEqual([
      { name: 'A', prompt: 'do a' },
      { name: 'B', prompt: 'do b' }
    ]);
    expect(storedHandoffLog()).toBe('');
    expect(mocks.runOrchestrator.mock.calls[0]![3]).toEqual({ mode: 'sequential', startIndex: 0 });
  });

  it('answers 400 for a sequential run when every step is done', async () => {
    storeOrchestrator({ subtasksJson: plan([{ name: 'A', prompt: 'a', runResult: 'done' }]) });

    const res = await run();

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Every step is done. Use "Run all again" to start over.' });
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('keeps earlier results when starting later in a sequential run', async () => {
    storeOrchestrator({ subtasksJson: plan(twoSteps, twoStepLog) });

    const res = await run({ startIndex: 1 });

    expect(res.statusCode).toBe(202);
    expect(storedSubtasks()).toEqual([twoSteps[0], { name: 'B', prompt: 'do b' }]);
    expect(storedHandoffLog()).toBe('### Step 1: A\n\nnotes a');
    expect(res.json()).toMatchObject({ runCurrentStep: 1 });
  });

  it('drops only the re-run step\'s handoff note for a single-step run', async () => {
    const log = '### Step 1: A\n\nnotes a\n\n### Step 2: B\n\nnotes b';
    storeOrchestrator({
      subtasksJson: plan(
        [
          { name: 'A', prompt: 'do a', runResult: 'done' },
          { name: 'B', prompt: 'do b', runResult: 'done' }
        ],
        log
      )
    });

    const res = await run({ onlyIndex: 0 });

    expect(res.statusCode).toBe(202);
    expect(storedSubtasks()).toEqual([{ name: 'A', prompt: 'do a' }, { name: 'B', prompt: 'do b', runResult: 'done' }]);
    expect(storedHandoffLog()).toBe('### Step 2: B\n\nnotes b');
  });

  it('adds the merge step and keeps finished steps in a parallel run', async () => {
    storeOrchestrator({ subtasksJson: plan(twoSteps) });

    const res = await run({ mode: 'parallel' });

    expect(res.statusCode).toBe(202);
    const subtasks = storedSubtasks();
    expect(subtasks.map((task) => [task.name, task.kind ?? null, task.runResult ?? null])).toEqual([
      ['A', null, 'done'],
      ['B', null, null],
      [expect.any(String), 'merge', null]
    ]);
    expect(mocks.runOrchestrator.mock.calls[0]![3]).toEqual({ mode: 'parallel', startIndex: 0 });
  });

  it('answers 400 when the plan has no steps or is invalid', async () => {
    storeOrchestrator({ subtasksJson: null });
    let res = await run();
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^No steps yet/);

    storeOrchestrator({ subtasksJson: '{not json' });
    res = await run();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid subtasksJson' });

    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('answers 400 for out-of-range step indexes', async () => {
    storeOrchestrator({ subtasksJson: plan(twoSteps) });

    for (const payload of [{ onlyIndex: 2 }, { onlyIndex: -1 }]) {
      const res = await run(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Invalid step index.' });
    }
    const res = await run({ startIndex: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No steps to run from startIndex.' });
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('answers 400 for a parallel run when every step is done', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'done' },
        { name: 'Merge', prompt: 'm', kind: 'merge', runResult: 'done' }
      ])
    });

    const res = await run({ mode: 'parallel' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Every step is done/);
  });

  it('answers 409 while a run is in progress or still finishing', async () => {
    storeOrchestrator({ runStatus: 'running', subtasksJson: plan(twoSteps) });
    let res = await run();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Run already in progress' });

    storeOrchestrator({ runStatus: 'stopped', subtasksJson: plan(twoSteps) });
    mocks.inFlightRunSteps.mockReturnValue(['B']);
    res = await run({ next: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('still finishing "B"');

    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('resumes a stopped run that is still finishing a step', async () => {
    storeOrchestrator({ runStatus: 'stopped', subtasksJson: plan(twoSteps) });
    mocks.inFlightRunSteps.mockReturnValue(['B']);
    mocks.claimRunResume.mockReturnValue(true);

    const res = await run({ mode: 'parallel' });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ runStatus: 'running' });
    expect(mocks.claimRunResume).toHaveBeenCalledWith('o1', 'parallel');
    expect(mocks.finishRunResume).toHaveBeenCalledWith('o1');
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('answers 409 when the workspace blocks the run', async () => {
    storeOrchestrator({ subtasksJson: plan(twoSteps) });
    mocks.checkRunPreconditions.mockResolvedValue('Workspace has uncommitted changes');

    const res = await run({ mode: 'parallel' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Workspace has uncommitted changes' });
    expect(orchestrators.get('o1')!.runStatus).toBeNull();
  });

  it('answers 404 for an orchestrator of another workspace', async () => {
    storeOrchestrator({ workspaceId: 'w2', subtasksJson: plan(twoSteps) });

    const res = await run();

    expect(res.statusCode).toBe(404);
  });
});

describe('GET .../orchestrators/:orchestratorId/run-preconditions', () => {
  function preconditions(headers: Record<string, string> = { authorization }) {
    return app.inject({ method: 'GET', url: PRECONDITIONS_URL, headers });
  }

  it('names why a parallel run cannot start in a non-repo workspace', async () => {
    storeOrchestrator();
    mocks.resolveRepo.mockResolvedValue({ error: 'Parallel runs need the workspace to be a git repository.' });

    const res = await preconditions();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ parallelBlockedReason: 'Parallel runs need the workspace to be a git repository.' });
    expect(mocks.resolveRepo).toHaveBeenCalledWith(expect.stringContaining('w1'));
  });

  it('answers null when the workspace is a repository', async () => {
    storeOrchestrator();
    mocks.resolveRepo.mockResolvedValue({ root: '/tmp/w1', subdir: '' });

    const res = await preconditions();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ parallelBlockedReason: null });
  });

  it('answers 404 for an unknown orchestrator and 401 without auth', async () => {
    expect((await preconditions()).statusCode).toBe(404);
    storeOrchestrator();
    expect((await preconditions({})).statusCode).toBe(401);
    expect(mocks.resolveRepo).not.toHaveBeenCalled();
  });
});

describe('POST .../steps/:index/branch/apply and /discard', () => {
  const keptBranch = { base: 'abc123', branch: 'nova/o1/step-2' };
  const stepsWithKeptBranch = [
    { name: 'A', description: '', runResult: 'done' },
    { name: 'B', description: '', runResult: 'failed', runNote: 'Merge conflict', keptBranch }
  ];

  function branchAction(action: 'apply' | 'discard', index = 1) {
    return app.inject({
      method: 'POST',
      url: `/api/workspaces/w1/orchestrators/o1/steps/${index}/branch/${action}`,
      headers: { authorization }
    });
  }

  beforeEach(() => {
    mocks.resolveRepo.mockResolvedValue({ root: '/tmp/w1', subdir: '' });
    mocks.branchExists.mockResolvedValue(true);
    mocks.deleteBranch.mockResolvedValue(undefined);
  });

  it('applies the kept branch to the workspace, deletes it and notes it on the step', async () => {
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });
    mocks.applyCommitRangeToWorkingTree.mockResolvedValue({ ok: true, bChanged: true });

    const res = await branchAction('apply');

    expect(res.statusCode).toBe(200);
    expect(mocks.applyCommitRangeToWorkingTree).toHaveBeenCalledWith('/tmp/w1', 'abc123', 'nova/o1/step-2');
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/w1', 'nova/o1/step-2');
    const step = storedSubtasks()[1];
    expect(step.keptBranch).toBeUndefined();
    expect(step.runResult).toBe('failed');
    expect(step.runNote).toBe(
      'Changes of branch nova/o1/step-2 were applied to the workspace as uncommitted changes.'
    );
    expect(res.json().subtasksJson).toBe(orchestrators.get('o1')!.subtasksJson);
    expect(mocks.broadcastOrchestratorUpsert).toHaveBeenCalledWith('w1', expect.objectContaining({ id: 'o1' }));
  });

  it('answers 409 and leaves the step untouched when the apply fails', async () => {
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });
    mocks.applyCommitRangeToWorkingTree.mockResolvedValue({ ok: false, error: 'patch does not apply: src/a.ts' });

    const res = await branchAction('apply');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'patch does not apply: src/a.ts' });
    expect(mocks.deleteBranch).not.toHaveBeenCalled();
    expect(mocks.updateOrchestrator).not.toHaveBeenCalled();
    expect(storedSubtasks()[1]).toMatchObject({ runNote: 'Merge conflict', keptBranch });
  });

  it('forgets a kept branch that no longer exists without applying anything', async () => {
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });
    mocks.branchExists.mockResolvedValue(false);

    const res = await branchAction('apply');

    expect(res.statusCode).toBe(200);
    expect(mocks.applyCommitRangeToWorkingTree).not.toHaveBeenCalled();
    expect(mocks.deleteBranch).not.toHaveBeenCalled();
    expect(storedSubtasks()[1]).toMatchObject({ runNote: 'Merge conflict' });
    expect(storedSubtasks()[1].keptBranch).toBeUndefined();
  });

  it('discards the kept branch and notes it on the step', async () => {
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });

    const res = await branchAction('discard');

    expect(res.statusCode).toBe(200);
    expect(mocks.applyCommitRangeToWorkingTree).not.toHaveBeenCalled();
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/w1', 'nova/o1/step-2');
    const step = storedSubtasks()[1];
    expect(step.keptBranch).toBeUndefined();
    expect(step.runNote).toBe('Branch nova/o1/step-2 was discarded.');
    expect(res.json().subtasksJson).toBe(orchestrators.get('o1')!.subtasksJson);

    // Already gone: nothing to delete, still cleared.
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });
    mocks.branchExists.mockResolvedValue(false);
    mocks.deleteBranch.mockClear();
    expect((await branchAction('discard')).statusCode).toBe(200);
    expect(mocks.deleteBranch).not.toHaveBeenCalled();
    expect(storedSubtasks()[1].keptBranch).toBeUndefined();
  });

  it('answers 409 while a run is in progress', async () => {
    storeOrchestrator({ runStatus: 'running', subtasksJson: plan(stepsWithKeptBranch) });

    for (const action of ['apply', 'discard'] as const) {
      const res = await branchAction(action);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'Run already in progress' });
    }
    expect(mocks.resolveRepo).not.toHaveBeenCalled();
    expect(mocks.updateOrchestrator).not.toHaveBeenCalled();
  });

  it('answers 404 for steps without a kept branch or out of range', async () => {
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });

    expect((await branchAction('apply', 0)).statusCode).toBe(404);
    expect((await branchAction('discard', 5)).statusCode).toBe(404);
    expect(mocks.resolveRepo).not.toHaveBeenCalled();
  });

  it('answers 409 when the workspace is not a repository', async () => {
    storeOrchestrator({ subtasksJson: plan(stepsWithKeptBranch) });
    mocks.resolveRepo.mockResolvedValue({ error: 'Parallel runs need the workspace to be a git repository.' });

    const res = await branchAction('apply');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Parallel runs need the workspace to be a git repository.' });
    expect(storedSubtasks()[1]).toMatchObject({ keptBranch });
  });
});

describe('run next: dependsOn', () => {
  it('skips steps whose dependencies are not done', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'failed' },
        { name: 'B', prompt: 'b', dependsOn: [0] },
        { name: 'C', prompt: 'c' }
      ])
    });

    const res = await run({ next: true });

    expect(res.statusCode).toBe(202);
    expect(mocks.runOrchestrator.mock.calls[0]![3]).toEqual({ mode: 'sequential', onlyIndex: 2 });
    // Other results stay as they were.
    expect(storedSubtasks()[0]).toMatchObject({ runResult: 'failed' });
  });

  it('picks a step once its dependencies are done', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'done' },
        { name: 'B', prompt: 'b', dependsOn: [0] },
        { name: 'C', prompt: 'c', dependsOn: [1] }
      ])
    });

    const res = await run({ next: true });

    expect(res.statusCode).toBe(202);
    expect(mocks.runOrchestrator.mock.calls[0]![3]).toEqual({ mode: 'sequential', onlyIndex: 1 });
  });

  it('treats interrupted steps as not run', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'running', sessionId: 'stale' },
        { name: 'B', prompt: 'b', dependsOn: [0] }
      ])
    });

    const res = await run({ next: true });

    expect(res.statusCode).toBe(202);
    expect(mocks.runOrchestrator.mock.calls[0]![3]).toEqual({ mode: 'sequential', onlyIndex: 0 });
    expect(storedSubtasks()[0]).toEqual({ name: 'A', prompt: 'a' });
  });

  it('answers 400 when every remaining step waits for a failed one', async () => {
    storeOrchestrator({
      subtasksJson: plan([
        { name: 'A', prompt: 'a', runResult: 'failed' },
        { name: 'B', prompt: 'b', dependsOn: [0] },
        { name: 'C', prompt: 'c', dependsOn: [1] }
      ])
    });

    const res = await run({ next: true });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^No step is ready/);
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });
});

describe('agents cannot start runs', () => {
  const agentAuthorization = `Bearer ${createNovaMcpToken('planner1')}`;

  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ id: 'planner1', workspaceId: 'w1', name: 'Planning', agentType: 'claude' });
  });

  it("rejects the agent's nova MCP token on the run route", async () => {
    storeOrchestrator({ subtasksJson: plan([{ name: 'A', prompt: 'a' }]) });

    const res = await app.inject({ method: 'POST', url: RUN_URL, headers: { authorization: agentAuthorization }, payload: {} });

    expect(res.statusCode).toBe(401);
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
    expect(orchestrators.get('o1')!.runStatus).toBeNull();
  });

  it('offers agents no MCP tool that runs a plan', async () => {
    const res = await app.inject({
      method: 'POST',
      url: NOVA_MCP_PATH,
      headers: { authorization: agentAuthorization },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    });

    expect(res.statusCode).toBe(200);
    const names = (res.json().result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual(['spec_read', 'spec_write', 'orchestrator_get', 'orchestrator_save_plan', 'step_needs_input']);
  });

  it('saves a plan through MCP without starting it', async () => {
    mocks.getLatestOrchestratorBySourceSession.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: NOVA_MCP_PATH,
      headers: { authorization: agentAuthorization },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'orchestrator_save_plan',
          arguments: { name: 'Plan', steps: [{ name: 'A', prompt: 'a' }, { name: 'B', prompt: 'b', dependsOn: [0] }] }
        }
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.isError).toBe(false);
    const saved = [...orchestrators.values()][0]!;
    expect(saved).toMatchObject({ sourceSessionId: 'planner1', runStatus: null });
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
    expect(mocks.checkRunPreconditions).not.toHaveBeenCalled();
  });

  it('refuses to replace a plan while it runs', async () => {
    mocks.getLatestOrchestratorBySourceSession.mockResolvedValue(
      storeOrchestrator({ runStatus: 'running', subtasksJson: plan([{ name: 'A', prompt: 'a', runResult: 'running' }]) })
    );

    const res = await app.inject({
      method: 'POST',
      url: NOVA_MCP_PATH,
      headers: { authorization: agentAuthorization },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'orchestrator_save_plan', arguments: { steps: [{ name: 'X', prompt: 'x' }] } }
      }
    });

    expect(res.json().result.isError).toBe(true);
    expect(orchestrators.get('o1')!.runStatus).toBe('running');
    expect(mocks.updateOrchestrator).not.toHaveBeenCalled();
  });

  it('rejects a forged MCP token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: NOVA_MCP_PATH,
      headers: { authorization: 'Bearer planner1.deadbeef' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    });

    expect(res.statusCode).toBe(401);
  });
});
