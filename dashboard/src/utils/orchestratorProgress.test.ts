import { describe, expect, it } from 'vitest';

import { orchestratorProgress } from '@/utils/orchestratorProgress';

import type { Orchestrator, Session } from '@/@types/index';

function orchestratorWith(subtasks: object[], runStatus: string | null = null): Orchestrator {
  return {
    id: 'o1',
    name: 'Plan',
    tags: null,
    agentType: 'claude',
    messageJson: '',
    subtasksJson: JSON.stringify({ sharedContext: '', handoffLog: '', subtasks }),
    workspaceId: 'w1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    runStatus
  };
}

describe('orchestratorProgress', () => {
  it('counts finished, failed and running steps, verify included', () => {
    const progress = orchestratorProgress(
      orchestratorWith([
        { name: 'a', prompt: '', runResult: 'done' },
        { name: 'b', prompt: '', runResult: 'skipped' },
        { name: 'c', prompt: '', runResult: 'failed' },
        { name: 'd', prompt: '', runResult: 'running' },
        { name: 'e', prompt: '', runResult: 'running', waitingQuestion: 'Apply the migration?' },
        { name: 'verify', prompt: '', kind: 'verify' }
      ], 'running'),
      new Map()
    );
    expect(progress).toEqual({ total: 6, done: 2, failed: 1, running: 1, waiting: 1, bRunning: true });
  });

  it('is running while any step session is busy, even after the run stopped', () => {
    const sessions = new Map([['s1', { id: 's1', busy: true } as Session]]);
    const progress = orchestratorProgress(
      orchestratorWith([{ name: 'a', prompt: '', sessionId: 's1' }], 'stopped'),
      sessions
    );
    expect(progress.bRunning).toBe(true);
  });

  it('is idle when nothing runs', () => {
    const progress = orchestratorProgress(
      orchestratorWith([{ name: 'a', prompt: '', runResult: 'done' }], 'completed'),
      new Map()
    );
    expect(progress.bRunning).toBe(false);
  });
});
