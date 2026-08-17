import { describe, expect, it } from 'vitest';

import {
  isOneShotAgentType,
  pickInexpensiveModel,
  resolveOneShotAgentType
} from './oneShotAgent.js';

describe('isOneShotAgentType', () => {
  it('accepts known agents', () => {
    expect(isOneShotAgentType('cursor-agent')).toBe(true);
    expect(isOneShotAgentType('claude')).toBe(true);
  });

  it('rejects empty or unknown values', () => {
    expect(isOneShotAgentType(null)).toBe(false);
    expect(isOneShotAgentType('')).toBe(false);
    expect(isOneShotAgentType('unknown')).toBe(false);
  });
});

describe('resolveOneShotAgentType', () => {
  it('uses the first valid candidate', () => {
    expect(resolveOneShotAgentType(null, 'claude', 'cursor-agent')).toBe('claude');
  });

  it('falls back to cursor-agent', () => {
    expect(resolveOneShotAgentType(undefined, 'nope')).toBe('cursor-agent');
  });
});

describe('pickInexpensiveModel', () => {
  it('prefers an explicit fast composer over other models', () => {
    expect(
      pickInexpensiveModel([
        { id: 'auto', label: 'Auto', fast: null },
        { id: 'opus', label: 'Opus', fast: false },
        { id: 'composer-fast', label: 'Composer', fast: true }
      ])
    ).toBe('composer-fast');
  });

  it('picks composer when none are marked fast', () => {
    expect(
      pickInexpensiveModel([
        { id: 'auto', label: 'Auto' },
        { id: 'claude-opus', label: 'Opus' },
        { id: 'composer-2.5', label: 'Composer 2.5' }
      ])
    ).toBe('composer-2.5');
  });

  it('does not treat paid *-fast / mini / flash ids as cheap', () => {
    expect(
      pickInexpensiveModel([
        { id: 'auto', label: 'Auto' },
        { id: 'gpt-5.3-codex-low-fast', label: 'Codex 5.3 Low Fast' },
        { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
        { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash' },
        { id: 'composer-2.5', label: 'Composer 2.5' },
        { id: 'composer-2.5-fast', label: 'Composer 2.5 Fast' }
      ])
    ).toBe('composer-2.5-fast');
  });

  it('falls back to auto instead of a paid flagship model', () => {
    expect(
      pickInexpensiveModel([
        { id: 'auto', label: 'Auto' },
        { id: 'gpt-5.3-codex-low-fast', label: 'Codex 5.3 Low Fast' },
        { id: 'claude-opus-5-thinking-high', label: 'Claude Opus 5' }
      ])
    ).toBe('auto');
  });

  it('uses auto when that is the only option', () => {
    expect(pickInexpensiveModel([{ id: 'auto', label: 'Auto' }])).toBe('auto');
  });
});
