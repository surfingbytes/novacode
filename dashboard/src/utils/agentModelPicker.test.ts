import { describe, expect, it } from 'vitest';

import {
  buildModelPickerState,
  buildOpenCodeQuickOptions,
  buildVisibleOpenCodeModelOptions,
  hasHiddenOpenCodeModelOptions,
  openCodeCurrentValue,
  openCodeQuickValue,
  resolveDefaultCursorModelOption,
  resolveDefaultModelOption,
  resolveSavedModelOption,
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

function openCodeOption(id: string, model?: string, thinking = 'Default'): AgentModelOption {
  return {
    id,
    label: id,
    model: model ?? id,
    thinking,
    context: 'Default',
    fast: null,
  };
}

const OPENCODE_CATALOG: AgentModelOption[] = [
  openCodeOption('moonshot/kimi-k3', 'Moonshot Kimi K3'),
  openCodeOption('openai/gpt-6-sol', 'Openai GPT 6 Sol'),
  openCodeOption('openai/gpt-6-sol-fast', 'Openai GPT 6 Sol', 'Fast'),
  openCodeOption('openai/gpt-6-astra', 'Openai GPT 6 Astra'),
  openCodeOption('openai/gpt-5.5', 'Openai GPT 5 5'),
];

describe('buildOpenCodeQuickOptions', () => {
  it('lists custom provider models with configured names, then GPT 6', () => {
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, [
      { id: 'moonshot/kimi-k3', label: 'Kimi K3' },
    ]);
    expect(quick.map((entry) => entry.label)).toEqual(['Kimi K3', 'GPT 6']);
    expect(quick.map((entry) => entry.optionId)).toEqual([
      'moonshot/kimi-k3',
      'openai/gpt-6-sol',
    ]);
  });

  it('puts Auto first when the catalog has it', () => {
    const quick = buildOpenCodeQuickOptions(
      [openCodeOption('auto', 'Auto', 'Auto'), ...OPENCODE_CATALOG],
      [{ id: 'moonshot/kimi-k3', label: 'Kimi K3' }]
    );
    expect(quick[0]).toMatchObject({ optionId: 'auto', label: 'Auto' });
  });

  it('skips entries whose id is not in the catalog', () => {
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, [
      { id: 'moonshot/kimi-k2', label: 'Kimi K2' },
    ]);
    expect(quick.map((entry) => entry.label)).toEqual(['GPT 6']);
  });

  it('returns an empty list when nothing matches', () => {
    const options = [openCodeOption('openai/gpt-5.5', 'Openai GPT 5 5')];
    expect(buildOpenCodeQuickOptions(options, [])).toEqual([]);
  });
});

describe('buildVisibleOpenCodeModelOptions', () => {
  const customModels = [{ id: 'moonshot/kimi-k3', label: 'Kimi K3' }];

  it('shows quick entries plus the current selection when it is not quick-covered', () => {
    const selected = OPENCODE_CATALOG[4]!;
    const picker = buildModelPickerState(OPENCODE_CATALOG, selected);
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, customModels);
    const visible = buildVisibleOpenCodeModelOptions({
      picker,
      selected,
      quickOptions: quick,
      bShowAll: false,
    });
    expect(visible.map((option) => option.label)).toEqual([
      'Kimi K3',
      'GPT 6',
      'Openai GPT 5 5 (Default)',
    ]);
    expect(visible[2]!.value).toBe(openCodeCurrentValue('openai/gpt-5.5'));
  });

  it('adds all remaining model names when expanded', () => {
    const selected = OPENCODE_CATALOG[0]!;
    const picker = buildModelPickerState(OPENCODE_CATALOG, selected);
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, customModels);
    const visible = buildVisibleOpenCodeModelOptions({
      picker,
      selected,
      quickOptions: quick,
      bShowAll: true,
    });
    expect(visible.map((option) => option.label)).toEqual([
      'Kimi K3',
      'GPT 6',
      'Openai GPT 5 5',
      'Openai GPT 6 Astra',
    ]);
  });

  it('shows a variant selection with its thinking dimension', () => {
    const selected = OPENCODE_CATALOG[2]!; // gpt-6-sol-fast
    const picker = buildModelPickerState(OPENCODE_CATALOG, selected);
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, customModels);
    const visible = buildVisibleOpenCodeModelOptions({
      picker,
      selected,
      quickOptions: quick,
      bShowAll: false,
    });
    expect(visible.map((option) => option.label)).toEqual([
      'Kimi K3',
      'GPT 6',
      'Openai GPT 6 Sol (Fast)',
    ]);
  });
});

describe('hasHiddenOpenCodeModelOptions', () => {
  it('is true when models exist beyond the quick set', () => {
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, [
      { id: 'moonshot/kimi-k3', label: 'Kimi K3' },
    ]);
    expect(
      hasHiddenOpenCodeModelOptions({
        bShowAll: false,
        modelList: ['Moonshot Kimi K3', 'Openai GPT 6 Sol', 'Openai GPT 5 5'],
        quickOptions: quick,
      })
    ).toBe(true);
  });

  it('is false when expanded or when quick entries cover every model', () => {
    const quick = buildOpenCodeQuickOptions(OPENCODE_CATALOG, [
      { id: 'moonshot/kimi-k3', label: 'Kimi K3' },
    ]);
    expect(
      hasHiddenOpenCodeModelOptions({
        bShowAll: true,
        modelList: ['Openai GPT 5 5'],
        quickOptions: quick,
      })
    ).toBe(false);
    expect(
      hasHiddenOpenCodeModelOptions({
        bShowAll: false,
        modelList: ['Moonshot Kimi K3', 'Openai GPT 6 Sol'],
        quickOptions: quick,
      })
    ).toBe(false);
  });
});

describe('openCodeQuickValue', () => {
  it('prefixes option ids so they cannot collide with flat model names', () => {
    expect(openCodeQuickValue('moonshot/kimi-k3')).toBe('ocquick:moonshot/kimi-k3');
  });
});

describe('resolveSavedModelOption', () => {
  it('maps legacy gpt-5.6-sol-medium onto 272k medium parameterized id', () => {
    const options = [
      solOption('1M'),
      solOption('272K'),
      solOption('1M', 'High'),
      solOption('272K', 'High'),
      solOption('272K', 'Medium', true),
    ];
    const selected = resolveSavedModelOption(options, 'gpt-5.6-sol-medium');
    expect(selected?.id).toBe(
      'gpt-5.6-sol[context=272k,reasoning=medium,fast=false]'
    );
    expect(selected?.context).toBe('272K');
  });

  it('keeps fast when migrating legacy -fast variants', () => {
    const options = [solOption('272K'), solOption('272K', 'Medium', true)];
    const selected = resolveSavedModelOption(options, 'gpt-5.6-sol-medium-fast');
    expect(selected?.fast).toBe(true);
    expect(selected?.context).toBe('272K');
  });
});
