import { describe, expect, it } from 'vitest';

import {
  buildParameterizedModelId,
  expandParameterizedModelVariants,
} from './cursorParameterizedModels';

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
