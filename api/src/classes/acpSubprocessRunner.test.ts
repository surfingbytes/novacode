/**
 * Integration tests for runAcpSubprocessPrompt against a real (mock) ACP agent
 * subprocess speaking ndjson JSON-RPC (src/classes/__fixtures__/mockAcpAgent.mjs).
 *
 * Regression coverage for the cancel/resume wiring: previously, stopping the
 * first turn mid-prompt discarded the freshly created ACP session id (the outer
 * catch returned `acpSessionId ?? ''`), so the next prompt started a fresh agent
 * conversation that could not see the earlier messages.
 */

// node_modules
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

// classes
import {
  cancelAcpSubprocess,
  mergeCursorTodos,
  runAcpSubprocessPrompt,
} from './acpSubprocessRunner';
import type { AcpAskQuestionHandler, AcpPermissionHandler } from './acpSubprocessRunner';

const MOCK_AGENT_PATH = join(process.cwd(), 'src', 'classes', '__fixtures__', 'mockAcpAgent.mjs');
const MOCK_SESSION_ID = 'mock-acp-session-1';

interface MockLogMessage {
  id?: unknown;
  method?: string;
  params?: { sessionId?: string };
}

const tempDirs: string[] = [];

function setupMock(mode: string): { workDir: string; logPath: string } {
  const workDir = mkdtempSync(join(tmpdir(), 'acp-runner-test-'));
  tempDirs.push(workDir);
  const logPath = join(workDir, 'mock-log.ndjson');
  // The runner forwards process.env to the agent subprocess.
  process.env.MOCK_MODE = mode;
  process.env.MOCK_LOG = logPath;
  return { workDir, logPath };
}

afterEach(() => {
  delete process.env.MOCK_MODE;
  delete process.env.MOCK_LOG;
  delete process.env.ACP_PROMPT_IDLE_TIMEOUT_MS;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function readMockLog(logPath: string): MockLogMessage[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MockLogMessage);
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function runMock(
  novaSessionId: string,
  acpSessionId: string | null,
  workDir: string,
  onEvent: (line: string) => void = () => {},
  onRequestPermission?: AcpPermissionHandler,
  onAskQuestion?: AcpAskQuestionHandler,
  cursorExtensions = false
): ReturnType<typeof runAcpSubprocessPrompt> {
  return runAcpSubprocessPrompt(
    {
      command: process.execPath,
      args: [MOCK_AGENT_PATH],
      cwd: workDir,
      novaSessionId,
      acpSessionId,
      promptText: 'hello',
      logTag: 'testAcp',
      cursorExtensions,
    },
    onEvent,
    undefined,
    onRequestPermission,
    onAskQuestion
  );
}

describe('runAcpSubprocessPrompt', () => {
  it('creates a new ACP session on the first turn and returns its id', async () => {
    const { workDir, logPath } = setupMock('prompt-ok');

    const result = await runMock('nova-first-turn', null, workDir);

    expect(result.error).toBeUndefined();
    expect(result.acpSessionId).toBe(MOCK_SESSION_ID);
    const methods = readMockLog(logPath).map((m) => m.method);
    expect(methods).toContain('session/new');
    expect(methods).not.toContain('session/load');
  });

  it('resumes an existing ACP session via session/load on follow-up turns', async () => {
    const { workDir, logPath } = setupMock('prompt-ok');

    const result = await runMock('nova-follow-up', 'existing-session-42', workDir);

    expect(result.error).toBeUndefined();
    expect(result.acpSessionId).toBe('existing-session-42');
    const log = readMockLog(logPath);
    expect(
      log.some((m) => m.method === 'session/load' && m.params?.sessionId === 'existing-session-42')
    ).toBe(true);
    expect(log.some((m) => m.method === 'session/new')).toBe(false);
  });

  it('keeps the new ACP session id when the first turn is cancelled mid-prompt', async () => {
    const { workDir, logPath } = setupMock('hang-until-cancel');

    const runPromise = runMock('nova-cancel-graceful', null, workDir);
    await waitFor(() => readMockLog(logPath).some((m) => m.method === 'session/prompt'));
    cancelAcpSubprocess('nova-cancel-graceful');
    const result = await runPromise;

    expect(result.error).toBeUndefined();
    expect(result.acpSessionId).toBe(MOCK_SESSION_ID);
    expect(result.stopReason).toBe('cancelled');
    expect(readMockLog(logPath).some((m) => m.method === 'session/cancel')).toBe(true);
  });

  it('keeps the ACP session id even when the agent ignores cancel and is killed', async () => {
    const { workDir, logPath } = setupMock('ignore-cancel');

    const runPromise = runMock('nova-cancel-kill', null, workDir);
    await waitFor(() => readMockLog(logPath).some((m) => m.method === 'session/prompt'));
    cancelAcpSubprocess('nova-cancel-kill');
    const result = await runPromise;

    // The resolved id must survive the hard kill (previously lost as ''), so the
    // next prompt can resume this conversation via session/load.
    expect(result.acpSessionId).toBe(MOCK_SESSION_ID);
    expect(result.error).toBeDefined();
  }, 15_000);

  it('emits a reset notice and starts a fresh session when session/load fails', async () => {
    const { workDir, logPath } = setupMock('fail-load');
    const events: string[] = [];

    const result = await runMock('nova-load-fails', 'stale-session-id', workDir, (line) =>
      events.push(line)
    );

    expect(result.error).toBeUndefined();
    expect(result.acpSessionId).toBe(MOCK_SESSION_ID);
    const notices = events
      .map((line) => {
        try {
          return JSON.parse(line) as { type?: string };
        } catch {
          return {};
        }
      })
      .filter((event) => event.type === 'session_reset_notice');
    expect(notices).toHaveLength(1);
    const methods = readMockLog(logPath).map((m) => m.method);
    expect(methods).toContain('session/load');
    expect(methods).toContain('session/new');
  });

  it('routes ACP permission requests through the injected handler', async () => {
    const { workDir, logPath } = setupMock('prompt-permission');
    const requests: string[] = [];

    const result = await runMock(
      'nova-permission',
      null,
      workDir,
      () => {},
      async (params) => {
        requests.push(params.toolCall.toolCallId);
        expect(params.toolCall.kind).toBe('execute');
        expect(params.options.map((option) => option.optionId)).toContain('allow-once');
        return { outcome: { outcome: 'selected', optionId: 'allow-once' } };
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBe('end_turn');
    expect(requests).toEqual(['mock-tool-1']);
    const permissionResponse = readMockLog(logPath).find((m) => m.id === 'mock-permission-request-1');
    expect(permissionResponse).toBeTruthy();
  });

  it('routes cursor/ask_question through the injected handler when answered', async () => {
    const { workDir, logPath } = setupMock('prompt-ask-question');
    const prompts: string[] = [];

    const result = await runMock(
      'nova-ask-question',
      null,
      workDir,
      () => {},
      undefined,
      async (params) => {
        prompts.push(params.questions[0]?.prompt ?? '');
        expect(params.toolCallId).toBe('mock-ask-1');
        return {
          outcome: {
            outcome: 'answered',
            answers: [{ questionId: 'q1', selectedOptionIds: ['plan'] }],
          },
        };
      },
      true
    );

    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBe('end_turn');
    expect(prompts).toEqual(['Which mode should I use?']);
    const askResponse = readMockLog(logPath).find((m) => m.id === 'mock-ask-question-request-1');
    expect(askResponse).toMatchObject({
      result: {
        outcome: {
          outcome: 'answered',
          answers: [{ questionId: 'q1', selectedOptionIds: ['plan'] }],
        },
      },
    });
  });

  it('skips cursor/ask_question when no handler is provided', async () => {
    const { workDir, logPath } = setupMock('prompt-ask-question');

    const result = await runMock(
      'nova-ask-question-skip',
      null,
      workDir,
      () => {},
      undefined,
      undefined,
      true
    );

    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBe('end_turn');
    const askResponse = readMockLog(logPath).find((m) => m.id === 'mock-ask-question-request-1');
    expect(askResponse).toMatchObject({
      result: {
        outcome: {
          outcome: 'skipped',
        },
      },
    });
  });

  it('accepts cursor/update_todos and emits synthetic tool_call events for the Tasks panel', async () => {
    const { workDir, logPath } = setupMock('prompt-update-todos');
    const events: Array<Record<string, unknown>> = [];

    const result = await runMock(
      'nova-update-todos',
      null,
      workDir,
      (line) => {
        try {
          events.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // ignore non-json
        }
      },
      undefined,
      undefined,
      true
    );

    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBe('end_turn');

    const todosResponse = readMockLog(logPath).find((m) => m.id === 'mock-update-todos-request-1') as {
      result?: { outcome?: { outcome?: string; todos?: unknown[] } };
    };
    expect(todosResponse?.result?.outcome?.outcome).toBe('accepted');
    expect(todosResponse?.result?.outcome?.todos).toHaveLength(3);

    const toolCalls = events.filter((event) => {
      const update = event.update as { sessionUpdate?: string; toolCallId?: string } | undefined;
      return update?.sessionUpdate === 'tool_call' && update.toolCallId === 'mock-todos-1';
    });
    const toolUpdates = events.filter((event) => {
      const update = event.update as { sessionUpdate?: string; status?: string } | undefined;
      return update?.sessionUpdate === 'tool_call_update' && update.status === 'completed';
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolUpdates.length).toBeGreaterThanOrEqual(1);
    const rawInput = (toolCalls[0].update as { rawInput?: { todos?: unknown[] } }).rawInput;
    expect(rawInput?.todos).toEqual([
      { id: '1', content: 'Set up project structure', status: 'completed' },
      { id: '2', content: 'Add authentication', status: 'in_progress' },
      { id: '3', content: 'Write unit tests', status: 'pending' },
    ]);
  });

  it('times out a silent in-flight prompt', async () => {
    process.env.ACP_PROMPT_IDLE_TIMEOUT_MS = '250';
    const { workDir } = setupMock('prompt-silent-hang');

    const result = await runMock('nova-idle-silent', null, workDir);

    expect(result.error).toMatch(/no output for \d+s and was stopped/);
  }, 10_000);

  it('keeps the prompt alive when a subagent emits session/update on a different session id', async () => {
    process.env.ACP_PROMPT_IDLE_TIMEOUT_MS = '250';
    const { workDir } = setupMock('prompt-subagent-session-updates');
    const events: Array<Record<string, unknown>> = [];

    const result = await runMock('nova-subagent-updates', null, workDir, (line) => {
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // ignore non-json
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBe('end_turn');
    const thoughts = events.filter((event) => {
      const update = event.update as { sessionUpdate?: string; content?: { text?: string } } | undefined;
      return (
        event.sessionId === 'mock-subagent-session' &&
        update?.sessionUpdate === 'agent_thought_chunk' &&
        typeof update.content?.text === 'string'
      );
    });
    expect(thoughts.length).toBeGreaterThanOrEqual(8);
  }, 10_000);

  it('keeps the prompt alive when Cursor sends cursor/task notifications', async () => {
    process.env.ACP_PROMPT_IDLE_TIMEOUT_MS = '250';
    const { workDir } = setupMock('prompt-cursor-task');
    const events: Array<Record<string, unknown>> = [];

    const result = await runMock(
      'nova-cursor-task',
      null,
      workDir,
      (line) => {
        try {
          events.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // ignore non-json
        }
      },
      undefined,
      undefined,
      true
    );

    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBe('end_turn');
    expect(events.filter((event) => event.type === 'cursor_task').length).toBeGreaterThanOrEqual(8);
  }, 10_000);
});

describe('mergeCursorTodos', () => {
  it('replaces the full list when merge is false', () => {
    const merged = mergeCursorTodos(
      [{ id: 'a', content: 'old', status: 'pending' }],
      [{ id: 'b', content: 'new', status: 'in_progress' }],
      false
    );
    expect(merged).toEqual([{ id: 'b', content: 'new', status: 'in_progress' }]);
  });

  it('upserts by id and appends new items when merge is true', () => {
    const merged = mergeCursorTodos(
      [
        { id: 'a', content: 'first', status: 'pending' },
        { id: 'b', content: 'second', status: 'pending' },
      ],
      [
        { id: 'b', content: 'second updated', status: 'completed' },
        { id: 'c', content: 'third', status: 'in_progress' },
      ],
      true
    );
    expect(merged).toEqual([
      { id: 'a', content: 'first', status: 'pending' },
      { id: 'b', content: 'second updated', status: 'completed' },
      { id: 'c', content: 'third', status: 'in_progress' },
    ]);
  });
});
