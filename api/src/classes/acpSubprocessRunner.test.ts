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
import { cancelAcpSubprocess, runAcpSubprocessPrompt } from './acpSubprocessRunner';

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
  onEvent: (line: string) => void = () => {}
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
    },
    onEvent
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
});
