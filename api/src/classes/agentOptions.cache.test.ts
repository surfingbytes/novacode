import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAgentOptions, resetAgentOptionsCache } from './agentOptions';
import { config } from './config';
import * as agents from './agents';
import { writeSwrDiskCache } from './swrCache';

describe('getAgentOptions disk cache', () => {
  let tmp: string;
  let savedConfigDir: string;

  afterEach(() => {
    resetAgentOptionsCache();
    config.configDir = savedConfigDir;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('returns persisted cursor options without probing ACP', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-options-cache-'));
    savedConfigDir = config.configDir;
    config.configDir = tmp;
    const options = {
      models: [
        { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null },
        {
          id: 'composer-1.5',
          label: 'Composer 1.5',
          model: 'Composer 1.5',
          thinking: 'Default',
          context: 'Default',
          fast: null,
        },
      ],
      modes: [{ id: 'agent', label: 'Agent' }],
      configOptions: [],
      thinking: null,
      source: 'acp' as const,
    };
    writeSwrDiskCache(join(tmp, 'cache', 'agent-options', 'cursor-agent.json'), {
      value: options,
      fetchedAt: Date.now(),
    });

    const result = await getAgentOptions('cursor-agent');
    expect(result.fromCache).toBe(true);
    expect(result.models.map((m) => m.id)).toEqual(['auto', 'composer-1.5']);
    expect(result.source).toBe('acp');
  });
});

describe('getAgentOptions claude disk cache versioning', () => {
  let tmp: string;
  let savedConfigDir: string;

  afterEach(() => {
    resetAgentOptionsCache();
    config.configDir = savedConfigDir;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('ignores a persisted claude list written without the current package versions', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-options-cache-'));
    savedConfigDir = config.configDir;
    config.configDir = tmp;
    const filePath = join(tmp, 'cache', 'agent-options', 'claude_auth.json');
    writeSwrDiskCache(filePath, {
      value: {
        models: [{ id: 'fable', label: 'Fable 5.1', model: 'Fable 5.1', thinking: 'Default', context: 'Default', fast: null }],
        modes: [],
        configOptions: [],
        thinking: null,
        source: 'acp' as const,
      },
      fetchedAt: Date.now(),
    });

    const probe = vi.spyOn(agents, 'getAgentAdapter').mockReturnValue({
      probeOptions: async () => ({
        models: [{ id: 'fable', label: 'Fable 5.2', model: 'Fable 5.2', thinking: 'Default', context: 'Default', fast: null }],
        modes: [],
        configOptions: [],
        thinking: null,
        source: 'acp' as const,
      }),
    } as unknown as ReturnType<typeof agents.getAgentAdapter>);

    const result = await getAgentOptions('claude', { claudeToken: 'token' });
    expect(result.fromCache).toBe(false);
    expect(result.models[0]?.label).toBe('Fable 5.2');

    // The fresh entry is stamped with the versions, so a restart reuses it.
    resetAgentOptionsCache();
    probe.mockClear();
    const again = await getAgentOptions('claude', { claudeToken: 'token' });
    expect(again.fromCache).toBe(true);
    expect(again.models[0]?.label).toBe('Fable 5.2');
    expect(probe).not.toHaveBeenCalled();
    probe.mockRestore();
  });
});
