// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    getSession: vi.fn(),
    getOrchestrator: vi.fn(),
    listSessionMessages: vi.fn()
  },
  busyHandlers: [] as Array<(sessionId: string, workspaceId: string, busy: boolean) => void>,
  isOrchestratorRunActive: vi.fn(),
  updateOrchestratorAndBroadcast: vi.fn()
}));

vi.mock('./database', () => ({ db: mocks.db }));
vi.mock('./chatEngine', () => ({
  subscribeBusy: (handler: (sessionId: string, workspaceId: string, busy: boolean) => void) => mocks.busyHandlers.push(handler)
}));
vi.mock('./orchestratorRunner', () => ({ isOrchestratorRunActive: mocks.isOrchestratorRunActive }));
vi.mock('./orchestratorEvents', () => ({ updateOrchestratorAndBroadcast: mocks.updateOrchestratorAndBroadcast }));

// classes
import { followUpTurnError, installStepFollowUpTracking, waitForStepFollowUps } from './orchestratorFollowUps';

// types
import type { ChatMessage, SubTask } from '../@types/index';

const ORCHESTRATOR_ID = 'orch-1';
const SESSION_ID = 'step-session';

/** The stored plan; every update replaces it like the database would. */
let stored: { runStatus: string | null; subtasksJson: string };

function setPlan(subtasks: SubTask[], runStatus: string | null): void {
  stored = { runStatus, subtasksJson: JSON.stringify({ sharedContext: '', handoffLog: '', subtasks }) };
}

function storedPayload(): { handoffLog: string; subtasks: SubTask[] } {
  return JSON.parse(stored.subtasksJson) as { handoffLog: string; subtasks: SubTask[] };
}

async function turn(messages: ChatMessage[]): Promise<void> {
  mocks.db.listSessionMessages.mockResolvedValue(messages);
  for (const handler of mocks.busyHandlers) handler(SESSION_ID, 'ws-1', true);
  await waitForStepFollowUps();
  for (const handler of mocks.busyHandlers) handler(SESSION_ID, 'ws-1', false);
  await waitForStepFollowUps();
}

const reply = (text: string): ChatMessage => ({
  role: 'assistant',
  events: [JSON.stringify({ type: 'stderr', text })],
  createdAt: '2026-11-03T17:00:00.000Z'
});

const answer: ChatMessage = {
  role: 'assistant',
  events: [JSON.stringify({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All fixed.' } } })],
  createdAt: '2026-11-03T17:00:00.000Z'
};

beforeEach(() => {
  mocks.busyHandlers.length = 0;
  installStepFollowUpTracking();
  mocks.isOrchestratorRunActive.mockReturnValue(false);
  mocks.db.getSession.mockResolvedValue({ id: SESSION_ID, orchestratorId: ORCHESTRATOR_ID });
  mocks.db.getOrchestrator.mockImplementation(async () => ({ id: ORCHESTRATOR_ID, workspaceId: 'ws-1', ...stored }));
  mocks.updateOrchestratorAndBroadcast.mockImplementation(async (_ws: string, _id: string, patch: Partial<typeof stored>) => {
    stored = { ...stored, ...patch };
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('orchestrator step follow-up turns', () => {
  it('marks a failed step running during the turn and done after it, completing the plan', async () => {
    setPlan(
      [
        { name: 'Build', prompt: 'b', runResult: 'done', sessionId: 'other' },
        { name: 'Verify', prompt: 'v', kind: 'verify', runResult: 'failed', runNote: 'API Error: 500', sessionId: SESSION_ID }
      ],
      'failed'
    );
    mocks.db.listSessionMessages.mockResolvedValue([answer]);
    for (const handler of mocks.busyHandlers) handler(SESSION_ID, 'ws-1', true);
    await waitForStepFollowUps();
    expect(storedPayload().subtasks[1].runResult).toBe('running');

    for (const handler of mocks.busyHandlers) handler(SESSION_ID, 'ws-1', false);
    await waitForStepFollowUps();
    const verify = storedPayload().subtasks[1];
    expect(verify.runResult).toBe('done');
    expect(verify.runNote).toBeNull();
    expect(stored.runStatus).toBe('completed');
    expect(storedPayload().handoffLog).toContain('### Step 2: Verify');
  });

  it('fails the step again when the follow-up turn ends with an error', async () => {
    setPlan([{ name: 'Verify', prompt: 'v', runResult: 'done', sessionId: SESSION_ID }], 'completed');
    await turn([reply('Something broke')]);
    expect(storedPayload().subtasks[0].runResult).toBe('failed');
    expect(storedPayload().subtasks[0].runNote).toBeTruthy();
    expect(stored.runStatus).toBe('failed');
  });

  it('keeps the plan status while skipped steps are left', async () => {
    setPlan(
      [
        { name: 'Build', prompt: 'b', runResult: 'failed', sessionId: SESSION_ID },
        { name: 'Verify', prompt: 'v', runResult: 'skipped', dependsOn: [0] }
      ],
      'failed'
    );
    await turn([answer]);
    expect(storedPayload().subtasks[0].runResult).toBe('done');
    expect(stored.runStatus).toBe('failed');
  });

  it('leaves steps alone while a run is in flight', async () => {
    setPlan([{ name: 'Verify', prompt: 'v', runResult: 'failed', sessionId: SESSION_ID }], 'failed');
    mocks.isOrchestratorRunActive.mockReturnValue(true);
    await turn([answer]);
    expect(mocks.updateOrchestratorAndBroadcast).not.toHaveBeenCalled();
  });

  it('leaves steps whose work is kept on a branch alone', async () => {
    setPlan(
      [{ name: 'Build', prompt: 'b', runResult: 'failed', sessionId: SESSION_ID, keptBranch: { base: 'abc', branch: 'nova/x/step-1' } }],
      'failed'
    );
    await turn([answer]);
    expect(mocks.updateOrchestratorAndBroadcast).not.toHaveBeenCalled();
  });
});

describe('followUpTurnError', () => {
  it('is null unless the last assistant message carries a stderr event', () => {
    expect(followUpTurnError([answer])).toBeNull();
    expect(followUpTurnError([reply('boom'), { role: 'user', content: 'again', createdAt: '' } as ChatMessage])).toBeNull();
    expect(followUpTurnError([reply('boom')])).toBeTruthy();
  });
});
