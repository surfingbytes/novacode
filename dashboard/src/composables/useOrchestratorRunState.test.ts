// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

// classes
import { orchestratorApi } from '@/classes/api';

// composables
import { useOrchestratorRunState, type RunChoice } from './useOrchestratorRunState';

// types
import type { Orchestrator, SubTask } from '@/@types/index';

vi.mock('@/classes/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/classes/api')>()),
  orchestratorApi: {
    run: vi.fn(() => Promise.resolve({ data: null })),
    stop: vi.fn(() => Promise.resolve({ data: null })),
    runPreconditions: vi.fn(() => Promise.resolve({ data: { parallelBlockedReason: null } }))
  }
}));

function stepFixture(overrides: Partial<SubTask> = {}): SubTask {
  return { title: 'Step', prompt: 'Do it', ...overrides } as SubTask;
}

function orchestratorFixture(overrides: Partial<Orchestrator> = {}, steps: SubTask[] = [stepFixture()]): Orchestrator {
  return {
    id: 'o1',
    workspaceId: 'w1',
    name: 'Plan',
    tags: null,
    messageJson: '',
    subtasksJson: JSON.stringify({ subtasks: steps }),
    archived: false,
    isFavorite: false,
    unread: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as Orchestrator;
}

function setup(orchestrator: Orchestrator | null, orchestratorId = 'o1') {
  const orchestratorRef = ref<Orchestrator | null>(orchestrator);
  const orchestratorIdRef = ref(orchestratorId);
  const onUpdate = vi.fn();
  const state = useOrchestratorRunState({
    workspaceId: 'w1',
    orchestratorId: orchestratorIdRef,
    orchestrator: orchestratorRef,
    onUpdate
  });
  return { state, orchestratorRef, orchestratorIdRef, onUpdate };
}

describe('useOrchestratorRunState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('runSummary', () => {
    it('is empty without a run', () => {
      const { state } = setup(orchestratorFixture({ runStatus: null, runChangedFiles: 4 }));
      expect(state.runSummary.value).toEqual({ short: '', full: '' });
    });

    it('does not mention files while running', () => {
      const steps = [stepFixture({ runResult: 'done' }), stepFixture({ runResult: 'running' })];
      const { state } = setup(orchestratorFixture({ runStatus: 'running', runChangedFiles: 2 }, steps));
      expect(state.runSummary.value.short).toBe('1/2 · 1 running');
      expect(state.runSummary.value.full).toBe('Running: 1/2 finished, 1 running');
    });

    it('appends the changed file count after a completed run', () => {
      const steps = [stepFixture({ runResult: 'done' }), stepFixture({ runResult: 'done' })];
      const { state } = setup(orchestratorFixture({ runStatus: 'completed', runChangedFiles: 3 }, steps));
      expect(state.runSummary.value.short).toBe('2/2 · 3 files changed');
      expect(state.runSummary.value.full).toBe('Completed: 2/2 finished, 3 files changed');
    });

    it('uses singular and zero wording', () => {
      const steps = [stepFixture({ runResult: 'done' })];
      const one = setup(orchestratorFixture({ runStatus: 'completed', runChangedFiles: 1 }, steps));
      expect(one.state.runSummary.value.short).toBe('1/1 · 1 file changed');
      const none = setup(orchestratorFixture({ runStatus: 'stopped', runChangedFiles: 0 }, steps));
      expect(none.state.runSummary.value.short).toBe('1/1 · stopped · no file changes');
      expect(none.state.runSummary.value.full).toBe('Stopped: 1/1 finished, stopped, no file changes');
    });

    it('omits the file count when unknown', () => {
      const steps = [stepFixture({ runResult: 'failed' })];
      const nullCount = setup(orchestratorFixture({ runStatus: 'failed', runChangedFiles: null }, steps));
      expect(nullCount.state.runSummary.value.short).toBe('1/1 · 1 failed');
      const missing = setup(orchestratorFixture({ runStatus: 'failed' }, steps));
      expect(missing.state.runSummary.value.full).toBe('Finished with failures: 1/1 finished, 1 failed');
    });
  });

  describe('startRun request bodies', () => {
    it.each<[RunChoice, Record<string, unknown>]>([
      ['sequential', { mode: 'sequential' }],
      ['parallel', { mode: 'parallel' }],
      ['sequential-fresh', { mode: 'sequential', fresh: true }],
      ['parallel-fresh', { mode: 'parallel', fresh: true }],
      ['next', { next: true }]
    ])('%s posts %j', async (choice, body) => {
      const { state } = setup(orchestratorFixture());
      await state.startRun(choice);
      expect(orchestratorApi.run).toHaveBeenCalledWith('w1', 'o1', body);
    });

    it.each<[RunChoice, string]>([
      ['sequential', 'sequential'],
      ['sequential-fresh', 'sequential'],
      ['parallel', 'parallel'],
      ['parallel-fresh', 'parallel']
    ])('%s stores %s as the preferred mode', async (choice, mode) => {
      const { state } = setup(orchestratorFixture());
      await state.startRun(choice);
      expect(state.preferredRunMode.value).toBe(mode);
      expect(localStorage.getItem('nova:orchestrator:runMode')).toBe(mode);
    });

    it('next keeps the preferred mode', async () => {
      localStorage.setItem('nova:orchestrator:runMode', 'parallel');
      const { state } = setup(orchestratorFixture());
      await state.startRun('next');
      expect(state.preferredRunMode.value).toBe('parallel');
    });

    it('passes onlyIndex and startIndex without touching the preferred mode', async () => {
      const { state } = setup(orchestratorFixture());
      await state.startRun('parallel', { onlyIndex: 2 });
      expect(orchestratorApi.run).toHaveBeenLastCalledWith('w1', 'o1', { mode: 'parallel', onlyIndex: 2 });
      await state.startRun('sequential-fresh', { startIndex: 1 });
      expect(orchestratorApi.run).toHaveBeenLastCalledWith('w1', 'o1', { mode: 'sequential', fresh: true, startIndex: 1 });
      expect(state.preferredRunMode.value).toBe('sequential');
      expect(localStorage.getItem('nova:orchestrator:runMode')).toBeNull();
    });

    it('hands the server copy to onUpdate and records errors', async () => {
      const { state, onUpdate } = setup(orchestratorFixture());
      const updated = orchestratorFixture({ runStatus: 'running' });
      vi.mocked(orchestratorApi.run).mockResolvedValueOnce({ data: updated } as never);
      await state.startRun('sequential');
      expect(onUpdate).toHaveBeenCalledWith(updated);

      vi.mocked(orchestratorApi.run).mockRejectedValueOnce(new Error('boom'));
      await state.startRun('sequential');
      expect(state.runError.value).toBe('Run failed');
      expect(state.bStartingRun.value).toBe(false);
    });

    it('does nothing without steps or while running', async () => {
      const empty = setup(orchestratorFixture({}, []));
      await empty.state.startRun('sequential');
      const running = setup(orchestratorFixture({ runStatus: 'running' }));
      await running.state.startRun('sequential');
      expect(orchestratorApi.run).not.toHaveBeenCalled();
    });
  });

  describe('run preconditions', () => {
    it('fetches once up front and exposes the reason', async () => {
      vi.mocked(orchestratorApi.runPreconditions).mockResolvedValueOnce({
        data: { parallelBlockedReason: 'Uncommitted changes' }
      } as never);
      const { state } = setup(orchestratorFixture());
      expect(orchestratorApi.runPreconditions).toHaveBeenCalledWith('w1', 'o1');
      await nextTick();
      expect(state.parallelBlockedReason.value).toBe('Uncommitted changes');
    });

    it('fetches again when the run ends', async () => {
      const { state, orchestratorRef } = setup(orchestratorFixture({ runStatus: 'running' }));
      expect(orchestratorApi.runPreconditions).toHaveBeenCalledTimes(1);
      vi.mocked(orchestratorApi.runPreconditions).mockResolvedValueOnce({
        data: { parallelBlockedReason: 'Not a git repo' }
      } as never);
      orchestratorRef.value = orchestratorFixture({ runStatus: 'completed' });
      await nextTick();
      expect(orchestratorApi.runPreconditions).toHaveBeenCalledTimes(2);
      await nextTick();
      expect(state.parallelBlockedReason.value).toBe('Not a git repo');
    });

    it('treats errors as not blocked', async () => {
      vi.mocked(orchestratorApi.runPreconditions).mockRejectedValueOnce(new Error('offline'));
      const { state } = setup(orchestratorFixture());
      await nextTick();
      await nextTick();
      expect(state.parallelBlockedReason.value).toBeNull();
    });
  });
});
