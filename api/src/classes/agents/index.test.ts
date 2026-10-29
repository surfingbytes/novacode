// node_modules
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAcpSubprocessPrompt: vi.fn(),
  cancelAcpSubprocess: vi.fn(),
  runClaudeAcp: vi.fn(),
  cancelClaudeAcp: vi.fn()
}));

vi.mock('../acpSubprocessRunner', () => ({
  runAcpSubprocessPrompt: mocks.runAcpSubprocessPrompt,
  cancelAcpSubprocess: mocks.cancelAcpSubprocess,
  closeAcpSubprocessSession: vi.fn()
}));
vi.mock('../claudeAcp', () => ({
  runClaudeAcp: mocks.runClaudeAcp,
  cancelClaudeAcp: mocks.cancelClaudeAcp,
  closeClaudeAcpForNovaSession: vi.fn()
}));

// classes
import { AGENT_TYPES, getAgentAdapter } from './index';

// types
import type { AgentType } from '@novacode/shared';
import type { AgentRunParams } from './types';

const ENV_OVERRIDES: Record<string, string> = {
  CURSOR_COMMAND: 'cursor-agent',
  VIBE_ACP_COMMAND: 'vibe-acp',
  OPENCODE_ACP_COMMAND: 'opencode',
  CODEX_ACP_COMMAND: 'codex-acp'
};
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV_OVERRIDES)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runAcpSubprocessPrompt.mockResolvedValue({ acpSessionId: 'acp-1' });
});

function runParams(overrides: Partial<AgentRunParams> = {}): AgentRunParams {
  return {
    novaSessionId: 'nova-1',
    acpSessionId: null,
    cwd: '/ws',
    promptText: 'hi',
    model: 'gpt-5',
    mode: 'plan',
    configJson: { effort: 'high' },
    onEvent: () => {},
    onAskQuestion: async () => ({ outcome: 'cancelled' }) as never,
    ...overrides
  };
}

describe('getAgentAdapter', () => {
  it('returns an adapter for every agent type', () => {
    const all: Record<AgentType, true> = {
      'cursor-agent': true,
      claude: true,
      'mistral-vibe': true,
      'open-code': true,
      codex: true
    };
    expect([...AGENT_TYPES].sort()).toEqual(Object.keys(all).sort());
    for (const type of AGENT_TYPES) {
      expect(getAgentAdapter(type).type).toBe(type);
    }
  });

  it('throws for an unknown agent type', () => {
    expect(() => getAgentAdapter('gemini' as AgentType)).toThrow('Unknown agent type: gemini');
  });

  it('spawnCommand per agent', () => {
    const commands = Object.fromEntries(AGENT_TYPES.map((type) => [type, getAgentAdapter(type).spawnCommand()]));
    expect(commands).toMatchInlineSnapshot(`
      {
        "claude": null,
        "codex": {
          "args": [
            "acp",
          ],
          "command": "codex-acp",
        },
        "cursor-agent": {
          "args": [
            "acp",
          ],
          "command": "cursor-agent",
        },
        "mistral-vibe": {
          "args": [],
          "command": "vibe-acp",
        },
        "open-code": {
          "args": [
            "acp",
          ],
          "command": "opencode",
        },
      }
    `);
  });
});

describe('subprocess adapter quirks', () => {
  it('cursor pins the model as a startup arg and forwards ask-question', async () => {
    await getAgentAdapter('cursor-agent').run(runParams());
    const [spec, , , , onAskQuestion] = mocks.runAcpSubprocessPrompt.mock.calls[0]!;
    expect(spec).toMatchObject({
      command: 'cursor-agent',
      args: ['--model', 'gpt-5', 'acp'],
      cursorExtensions: true,
      skipModelConfigOption: true,
      logTag: 'cursorAcp'
    });
    expect(onAskQuestion).toBeTypeOf('function');
  });

  it('codex passes model and config, no ask-question', async () => {
    await getAgentAdapter('codex').run(runParams());
    const [spec, , , , onAskQuestion] = mocks.runAcpSubprocessPrompt.mock.calls[0]!;
    expect(spec).toMatchObject({ command: 'codex-acp', args: ['acp'], model: 'gpt-5', configJson: { effort: 'high' } });
    expect(spec.transformPrompt).toBeUndefined();
    expect(onAskQuestion).toBeUndefined();
  });

  it('mistral vibe never sends model or config', async () => {
    await getAgentAdapter('mistral-vibe').run(runParams());
    const [spec] = mocks.runAcpSubprocessPrompt.mock.calls[0]!;
    expect(spec.model).toBeUndefined();
    expect(spec.configJson).toBeUndefined();
    expect(spec.additionalDirectoriesUnadvertised).toBe(true);
  });

  it('open code adds plan instructions only in plan mode', async () => {
    const adapter = getAgentAdapter('open-code');
    await adapter.run(runParams({ mode: 'plan' }));
    await adapter.run(runParams({ mode: 'build' }));
    const planSpec = mocks.runAcpSubprocessPrompt.mock.calls[0]![0];
    const buildSpec = mocks.runAcpSubprocessPrompt.mock.calls[1]![0];
    expect(planSpec.transformPrompt('hi', 'ses_1')).toContain('ses_1');
    expect(buildSpec.transformPrompt).toBeUndefined();
  });

  it('cancel targets the Nova session id', async () => {
    await getAgentAdapter('codex').cancel('nova-1');
    expect(mocks.cancelAcpSubprocess).toHaveBeenCalledWith('nova-1');
  });
});

describe('claude adapter cancel', () => {
  it('cancels the ACP session the running Nova session uses', async () => {
    let finish: (() => void) | undefined;
    mocks.runClaudeAcp.mockImplementation(
      (opts: { onSessionId: (id: string) => void }) =>
        new Promise((resolve) => {
          opts.onSessionId('acp-9');
          finish = () => resolve({ acpSessionId: 'acp-9' });
        })
    );
    const adapter = getAgentAdapter('claude');
    const onSessionId = vi.fn();
    const running = adapter.run(runParams({ onSessionId }));
    await vi.waitFor(() => expect(finish).toBeDefined());

    await adapter.cancel('nova-1');
    expect(mocks.cancelClaudeAcp).toHaveBeenCalledWith('acp-9');
    expect(onSessionId).toHaveBeenCalledWith('acp-9');

    finish!();
    await running;
    mocks.cancelClaudeAcp.mockClear();
    await adapter.cancel('nova-1');
    expect(mocks.cancelClaudeAcp).not.toHaveBeenCalled();
  });
});
