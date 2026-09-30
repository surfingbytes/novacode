import { describe, expect, it } from 'vitest';

import {
  resolveDefaultCursorModelOption,
  resolveDefaultModelOption,
  type CursorModelPreset,
} from './agentModelPicker';
import type { AgentModelOption } from '@/@types/index';

function solOption(context: string, thinking = 'Medium', fast = false): AgentModelOption {
  return {
    id: `gpt-5.6-sol[context=${context.toLowerCase()},reasoning=${thinking.toLowerCase()},fast=${fast}]`,
    label: 'GPT-5.6 Sol',
    model: 'GPT 5.6 Sol',
    thinking,
    context,
    fast,
  };
}

describe('resolveDefaultCursorModelOption', () => {
  it('defaults GPT 5.6 Sol to 272k medium (not 1M)', () => {
    const options = [
      solOption('1M'),
      solOption('272K'),
      solOption('1M', 'High'),
      solOption('272K', 'High'),
    ];
    const preset = {
      label: 'GPT 5.6',
      thinking: 'Medium',
      modelNames: ['GPT 5.6 Sol'],
    } as CursorModelPreset;

    const selected = resolveDefaultCursorModelOption(options, preset);
    expect(selected?.context).toBe('272K');
    expect(selected?.thinking).toBe('Medium');
    expect(selected?.fast).toBe(false);
  });
});

describe('resolveDefaultModelOption', () => {
  it('prefers the smallest concrete context when Default is absent', () => {
    const options = [solOption('1M'), solOption('272K')];
    const selected = resolveDefaultModelOption(options, 'GPT 5.6 Sol');
    expect(selected?.context).toBe('272K');
  });
});
