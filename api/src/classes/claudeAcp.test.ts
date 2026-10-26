import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./mcpServersForAcp', () => ({
  getConfiguredAcpMcpServers: vi.fn(async () => [])
}));
vi.mock('./novaMcp', () => ({
  novaMcpServerIfSession: vi.fn(async () => null)
}));

type ClaudeAcpModule = typeof import('./claudeAcp');

interface PendingPrompt {
  resolve: (value: { stopReason: string }) => void;
  reject: (err: Error) => void;
}

interface ForegroundEvents {
  running: () => void;
  awaitingUser: () => void;
  ended: (outcome: { stopReason?: string }) => void;
  failed: (error: unknown) => void;
}

class FakeClaudeAgent {
  static instances: FakeClaudeAgent[] = [];
  static nextSessionNumber = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: any;
  readonly options: { foreground?: (sessionId: string) => ForegroundEvents };
  disposed = false;
  sessions: Record<string, object> = {};
  pendingPrompt: PendingPrompt | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionParams: any[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(client: any, _logger?: unknown, options: { foreground?: (sessionId: string) => ForegroundEvents } = {}) {
    this.client = client;
    this.options = options;
    FakeClaudeAgent.instances.push(this);
  }

  /** The adapter's foreground reporter for an ACP session (a fresh one per work start). */
  foreground(sessionId: string): ForegroundEvents {
    return this.options.foreground!(sessionId);
  }

  /** Raw SDK message the adapter forwards via `_claude/sdkMessage`. */
  async sdkMessage(sessionId: string, message: Record<string, unknown>): Promise<void> {
    await this.client.extNotification('_claude/sdkMessage', { sessionId, message });
  }

  async backgroundTasks(sessionId: string, taskIds: string[]): Promise<void> {
    await this.sdkMessage(sessionId, {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: taskIds.map((id) => ({ task_id: id, task_type: 'local_bash', description: id }))
    });
  }

  async initialize(): Promise<object> {
    return {};
  }

  async newSession(params: object): Promise<{ sessionId: string }> {
    this.sessionParams.push(params);
    const sessionId = `acp-${++FakeClaudeAgent.nextSessionNumber}`;
    this.sessions[sessionId] = {};
    return { sessionId };
  }

  async resumeSession(params: { sessionId: string }): Promise<object> {
    this.sessionParams.push(params);
    this.sessions[params.sessionId] = {};
    return {};
  }

  prompt(): Promise<{ stopReason: string }> {
    return new Promise((resolve, reject) => {
      this.pendingPrompt = { resolve, reject };
    });
  }

  async cancel(): Promise<void> {}

  async dispose(): Promise<void> {
    this.disposed = true;
    this.pendingPrompt?.reject(new Error('session ended'));
    this.pendingPrompt = null;
  }

  finishPrompt(): void {
    this.pendingPrompt?.resolve({ stopReason: 'end_turn' });
    this.pendingPrompt = null;
  }
}

let claudeAcp: ClaudeAcpModule;

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Start a turn and wait until the fake agent's prompt() is pending. */
async function startTurn(novaSessionId: string, onEvent: (line: string) => void = () => {}) {
  const result = claudeAcp.runClaudeAcp(
    { novaSessionId, acpSessionId: null, cwd: '/tmp', promptText: 'hi' },
    onEvent
  );
  await flush();
  const agent = FakeClaudeAgent.instances[FakeClaudeAgent.instances.length - 1]!;
  return { result, agent };
}

/** Grace the runner gives follow-up work after a prompt result before ending the turn. */
const FOLLOWUP_GRACE_MS = 2_000;

/** Finish the fake prompt and let the follow-up grace period pass. */
async function finishTurn(agent: FakeClaudeAgent): Promise<void> {
  agent.finishPrompt();
  await vi.advanceTimersByTimeAsync(FOLLOWUP_GRACE_MS + 1);
}

async function runIdleTurn(novaSessionId: string): Promise<FakeClaudeAgent> {
  const { result, agent } = await startTurn(novaSessionId);
  await finishTurn(agent);
  await result;
  return agent;
}

/** Whether a promise has settled (checked without awaiting it). */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  await flush();
  return settled;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  process.env['CLAUDE_AGENT_IDLE_TIMEOUT_MS'] = '900000';
  process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'] = '0';
  FakeClaudeAgent.instances = [];
  FakeClaudeAgent.nextSessionNumber = 0;
  claudeAcp = await import('./claudeAcp');
  claudeAcp.setClaudeAcpAgentCtorForTests(FakeClaudeAgent);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env['CLAUDE_AGENT_IDLE_TIMEOUT_MS'];
  delete process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'];
});

describe('embedded Claude agent idle sweep', () => {
  it('disposes an agent that sat unused past the idle timeout', async () => {
    const agent = await runIdleTurn('nova-1');

    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(agent.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(agent.disposed).toBe(true);
  });

  it('never disposes an agent while its turn is in flight', async () => {
    const { result, agent } = await startTurn('nova-1');

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(agent.disposed).toBe(false);

    await finishTurn(agent);
    await result;
  });

  it('uses a fresh agent for the next turn after eviction', async () => {
    const first = await runIdleTurn('nova-1');
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(first.disposed).toBe(true);

    const second = await runIdleTurn('nova-1');
    expect(second).not.toBe(first);
    expect(second.disposed).toBe(false);
  });

  it('keeps agents alive when the idle timeout is disabled', async () => {
    process.env['CLAUDE_AGENT_IDLE_TIMEOUT_MS'] = '0';
    const agent = await runIdleTurn('nova-1');

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(agent.disposed).toBe(false);
  });
});

describe('embedded Claude agent cap', () => {
  it('disposes the least recently used idle agents beyond the cap', async () => {
    const agents: FakeClaudeAgent[] = [];
    for (let i = 0; i < 12; i++) {
      agents.push(await runIdleTurn(`nova-${i}`));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await flush();

    expect(agents.filter((agent) => agent.disposed)).toEqual([agents[0], agents[1]]);
  });

  it('does not dispose in-flight agents to satisfy the cap', async () => {
    const turns: Array<Awaited<ReturnType<typeof startTurn>>> = [];
    for (let i = 0; i < 11; i++) turns.push(await startTurn(`nova-${i}`));
    await flush();

    expect(turns.some(({ agent }) => agent.disposed)).toBe(false);

    for (const { agent, result } of turns) {
      await finishTurn(agent);
      await result;
    }
  });
});

describe('embedded Claude prompt idle timeout', () => {
  it('stops a turn that produces no output and disposes its agent', async () => {
    process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'] = '300000';
    const { result, agent } = await startTurn('nova-1');

    await vi.advanceTimersByTimeAsync(300_000);

    expect(agent.disposed).toBe(true);
    await expect(result).resolves.toMatchObject({
      acpSessionId: 'acp-1',
      error: 'Agent produced no output for 300s and was stopped.'
    });
  });

  it('re-arms the timeout on every streamed event', async () => {
    process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'] = '300000';
    const events: string[] = [];
    const { result, agent } = await startTurn('nova-1', (line) => events.push(line));

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(200_000);
      await agent.client.sessionUpdate({
        sessionId: 'acp-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } }
      });
    }
    expect(agent.disposed).toBe(false);
    expect(events).toHaveLength(3);

    await finishTurn(agent);
    await expect(result).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('pauses the timeout while a permission prompt is open', async () => {
    process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'] = '300000';
    let answerPermission: (() => void) | null = null;
    const result = claudeAcp.runClaudeAcp(
      { novaSessionId: 'nova-1', acpSessionId: null, cwd: '/tmp', promptText: 'hi' },
      () => {},
      undefined,
      () =>
        new Promise((resolve) => {
          answerPermission = () => resolve({ outcome: { outcome: 'selected', optionId: 'allow' } });
        })
    );
    await flush();
    const agent = FakeClaudeAgent.instances[0]!;

    const permission = agent.client.requestPermission({
      sessionId: 'acp-1',
      toolCall: { toolCallId: 't1' },
      options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }]
    });
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(agent.disposed).toBe(false);

    answerPermission!();
    await permission;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(agent.disposed).toBe(true);
    await expect(result).resolves.toMatchObject({ error: expect.stringContaining('no output') });
  });
});

describe('embedded Claude follow-up work', () => {
  it('requests the raw SDK messages that describe background work', async () => {
    const agent = await runIdleTurn('nova-1');
    expect(agent.sessionParams[0]).toMatchObject({
      _meta: { claudeCode: { emitRawSDKMessages: expect.arrayContaining([{ type: 'system', subtype: 'background_tasks_changed' }]) } }
    });
  });

  it('ends the turn at once when it had no background work', async () => {
    const { result, agent } = await startTurn('nova-1');
    agent.finishPrompt();
    await flush();
    expect(await isSettled(result)).toBe(true);
    await expect(result).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('ends the turn after the grace period when a finished task has no follow-up', async () => {
    const { result, agent } = await startTurn('nova-1');
    await agent.backgroundTasks('acp-1', ['build']);
    await agent.backgroundTasks('acp-1', []);
    agent.finishPrompt();
    await vi.advanceTimersByTimeAsync(FOLLOWUP_GRACE_MS - 500);
    expect(await isSettled(result)).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('keeps the turn open while background tasks run and streams the follow-up cycle', async () => {
    const events: string[] = [];
    const { result, agent } = await startTurn('nova-1', (line) => events.push(line));
    const turn = agent.foreground('acp-1');
    turn.running();
    await agent.backgroundTasks('acp-1', ['build']);
    turn.ended({ stopReason: 'end_turn' });
    agent.finishPrompt();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await isSettled(result)).toBe(false);
    expect(events).toContain(JSON.stringify({ type: 'background_tasks', running: 1, total: 1 }));

    // The build ends; Claude Code queues its task-notification follow-up.
    await agent.backgroundTasks('acp-1', []);
    await agent.sdkMessage('acp-1', { type: 'user', origin: { kind: 'task-notification' } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await isSettled(result)).toBe(false);

    const cycle = agent.foreground('acp-1');
    cycle.running();
    await agent.client.sessionUpdate({
      sessionId: 'acp-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Build is green.' } }
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await isSettled(result)).toBe(false);

    cycle.ended({ stopReason: 'end_turn' });
    await agent.sdkMessage('acp-1', { type: 'result' });
    await vi.advanceTimersByTimeAsync(FOLLOWUP_GRACE_MS + 1);
    await expect(result).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(events.some((line) => line.includes('Build is green.'))).toBe(true);
    expect(events).toContain(JSON.stringify({ type: 'background_tasks', running: 0, total: 1 }));
  });

  it('keeps the turn open for a follow-up cycle that starts right after the result', async () => {
    const events: string[] = [];
    const { result, agent } = await startTurn('nova-1', (line) => events.push(line));
    // A task that ended just before the result: its notification follows the result.
    await agent.backgroundTasks('acp-1', ['tests']);
    await agent.backgroundTasks('acp-1', []);
    agent.finishPrompt();
    await vi.advanceTimersByTimeAsync(500);

    const cycle = agent.foreground('acp-1');
    cycle.running();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await isSettled(result)).toBe(false);

    await agent.client.sessionUpdate({
      sessionId: 'acp-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } }
    });
    cycle.ended({ stopReason: 'max_tokens' });
    await vi.advanceTimersByTimeAsync(FOLLOWUP_GRACE_MS + 1);
    await expect(result).resolves.toMatchObject({ stopReason: 'max_tokens' });
    expect(events.some((line) => line.includes('Done.'))).toBe(true);
  });

  it('gives up on a follow-up that never starts', async () => {
    const { result, agent } = await startTurn('nova-1');
    agent.finishPrompt();
    await agent.sdkMessage('acp-1', { type: 'user', origin: { kind: 'task-notification' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await isSettled(result)).toBe(false);

    await vi.advanceTimersByTimeAsync(70_000);
    await expect(result).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('ends a held turn at once on cancel', async () => {
    const { result, agent } = await startTurn('nova-1');
    await agent.backgroundTasks('acp-1', ['tests']);
    agent.finishPrompt();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await isSettled(result)).toBe(false);

    claudeAcp.cancelClaudeAcp('acp-1');
    await flush();
    await expect(result).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('does not let the idle watchdog stop a turn waiting on background tasks', async () => {
    process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'] = '300000';
    const { result, agent } = await startTurn('nova-1');
    await agent.backgroundTasks('acp-1', ['build']);
    agent.finishPrompt();

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(agent.disposed).toBe(false);

    // Once the follow-up cycle streams, silence is again a hang.
    await agent.backgroundTasks('acp-1', []);
    const cycle = agent.foreground('acp-1');
    cycle.running();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(agent.disposed).toBe(true);
    await expect(result).resolves.toMatchObject({ error: expect.stringContaining('no output') });
  });
});
