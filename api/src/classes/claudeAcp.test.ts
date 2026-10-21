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

class FakeClaudeAgent {
  static instances: FakeClaudeAgent[] = [];
  static nextSessionNumber = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: any;
  disposed = false;
  sessions: Record<string, object> = {};
  pendingPrompt: PendingPrompt | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(client: any) {
    this.client = client;
    FakeClaudeAgent.instances.push(this);
  }

  async initialize(): Promise<object> {
    return {};
  }

  async newSession(): Promise<{ sessionId: string }> {
    const sessionId = `acp-${++FakeClaudeAgent.nextSessionNumber}`;
    this.sessions[sessionId] = {};
    return { sessionId };
  }

  async resumeSession(params: { sessionId: string }): Promise<object> {
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

async function runIdleTurn(novaSessionId: string): Promise<FakeClaudeAgent> {
  const { result, agent } = await startTurn(novaSessionId);
  agent.finishPrompt();
  await result;
  return agent;
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

    agent.finishPrompt();
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
      agent.finishPrompt();
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

    agent.finishPrompt();
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
