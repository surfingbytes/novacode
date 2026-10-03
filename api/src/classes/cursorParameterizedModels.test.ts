import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { config } from './config';
import {
  buildParameterizedModelId,
  expandParameterizedModelVariants,
  getParameterizedCursorModels,
  resetParameterizedCursorModelsCache,
} from './cursorParameterizedModels';
import { writeSwrDiskCache } from './swrCache';

describe('buildParameterizedModelId', () => {
  it('returns the base id when params are empty', () => {
    expect(buildParameterizedModelId('gpt-5.6-sol', {})).toBe('gpt-5.6-sol');
  });

  it('orders context, thinking-like, then fast params', () => {
    expect(
      buildParameterizedModelId('gpt-5.6-sol', {
        fast: 'false',
        reasoning: 'medium',
        context: '272k',
      })
    ).toBe('gpt-5.6-sol[context=272k,reasoning=medium,fast=false]');
  });
});

describe('expandParameterizedModelVariants', () => {
  it('expands context/reasoning/fast into selectable ids', () => {
    const expanded = expandParameterizedModelVariants(
      'gpt-5.6-sol',
      'GPT-5.6 Sol',
      [
        { id: 'context', values: ['272k', '1m'], currentValue: '272k' },
        { id: 'reasoning', values: ['medium', 'high'], currentValue: 'medium' },
        { id: 'fast', values: ['false', 'true'], currentValue: 'false' },
      ],
      true
    );

    expect(expanded).toHaveLength(8);
    expect(expanded.some((m) => m.id.includes('context=272k'))).toBe(true);
    expect(expanded.some((m) => m.id.includes('context=1m'))).toBe(true);

    const current = expanded.find((m) => m.current);
    expect(current?.id).toBe('gpt-5.6-sol[context=272k,reasoning=medium,fast=false]');
  });

  it('returns a single base option when a model has no params', () => {
    expect(expandParameterizedModelVariants('default', 'Default', [])).toEqual([
      { id: 'default', label: 'Default' },
    ]);
  });
});

describe('getParameterizedCursorModels disk cache', () => {
  let tmp: string;
  let savedConfigDir: string;

  afterEach(() => {
    resetParameterizedCursorModelsCache();
    config.configDir = savedConfigDir;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('returns persisted models without probing ACP', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'cursor-models-cache-'));
    savedConfigDir = config.configDir;
    config.configDir = tmp;
    const models = [
      { id: 'auto', label: 'Auto' },
      { id: 'gpt-5.6-sol[context=272k]', label: 'GPT-5.6 Sol' },
    ];
    writeSwrDiskCache(join(tmp, 'cache', 'cursor-parameterized-models.json'), {
      value: models,
      fetchedAt: Date.now(),
    });

    const result = await getParameterizedCursorModels();
    expect(result).toEqual({ models, fromCache: true });
  });
});
