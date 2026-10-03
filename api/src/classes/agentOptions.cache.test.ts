import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAgentOptions, resetAgentOptionsCache } from './agentOptions';
import { config } from './config';
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
