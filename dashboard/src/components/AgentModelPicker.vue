<script setup lang="ts">
// node_modules
import { computed, ref } from 'vue';

// components
import UiSelectMenu, { type SelectMenuOption } from '@/components/ui/UiSelectMenu.vue';

// types
import type { AgentModelOption, AgentThinkingOptionGroup, AgentType } from '@/@types/index';

const props = withDefaults(defineProps<{
  modelValue?: string | null;
  agentType?: AgentType | null;
  modelOptions: AgentModelOption[];
  thinkingOptions?: AgentThinkingOptionGroup | null;
  thinkingValue?: string | null;
  disabled?: boolean;
  variant?: 'compact' | 'modal';
}>(), {
  modelValue: 'auto',
  agentType: null,
  thinkingOptions: null,
  thinkingValue: null,
  disabled: false,
  variant: 'compact'
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:thinkingValue': [value: string];
}>();

const THINKING_ORDER = ['auto', 'default', 'none', 'minimal', 'low', 'medium', 'high', 'max'];
const MORE_MODEL_OPTION_VALUE = '__more_models__';
const CURSOR_MODEL_VALUE_PREFIX = 'model:';
const CURSOR_PRESET_VALUE_PREFIX = 'preset:';
const CURSOR_CURRENT_VALUE_PREFIX = 'current:';
const BASIC_CURSOR_MODEL_PRESETS = [
  { label: 'Auto', thinking: 'Auto', modelNames: ['Auto'] },
  { label: 'Composer 2.5', thinking: 'Fast', modelNames: ['Composer 2.5'] },
  { label: 'Opus 4.8', thinking: 'High', modelNames: ['Claude Opus 4 8'] },
  { label: 'GPT 5.5', thinking: 'Medium', modelNames: ['GPT 5.5'] },
  { label: 'Fable 5', thinking: 'High', modelNames: ['Claude Fable 5'] },
  { label: 'Sonnet 5', thinking: 'High', modelNames: ['Claude Sonnet 5'] },
  { label: 'Sonnet 4.6', thinking: 'Medium', modelNames: ['Claude 4.6 Sonnet'] },
  { label: 'Codex 5.3', thinking: 'Medium', modelNames: ['GPT 5.3 Codex'] }
];
type CursorModelPreset = (typeof BASIC_CURSOR_MODEL_PRESETS)[number];
type ModelSelectOption = { value: string; label: string };

const bShowAllCursorModels = ref(false);

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sortLabelValues(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function thinkingRank(value: string): number {
  const lower = value.toLowerCase();
  const direct = THINKING_ORDER.indexOf(lower);
  if (direct >= 0) return direct;
  if (lower.includes('minimal')) return THINKING_ORDER.indexOf('minimal');
  if (lower.includes('low')) return THINKING_ORDER.indexOf('low');
  if (lower.includes('medium')) return THINKING_ORDER.indexOf('medium');
  if (lower.includes('high')) return THINKING_ORDER.indexOf('high');
  if (lower.includes('max')) return THINKING_ORDER.indexOf('max');
  return THINKING_ORDER.length;
}

function sortThinkingValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const rankDiff = thinkingRank(a) - thinkingRank(b);
    return rankDiff || a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase();
}

function cursorPresetValue(label: string): string {
  return `${CURSOR_PRESET_VALUE_PREFIX}${label}`;
}

function cursorModelValue(model: string): string {
  return `${CURSOR_MODEL_VALUE_PREFIX}${model}`;
}

function optionMatchesCursorPreset(option: AgentModelOption, preset: CursorModelPreset): boolean {
  return preset.modelNames.includes(option.model);
}

function findCursorPresetForOption(option: AgentModelOption): CursorModelPreset | null {
  return BASIC_CURSOR_MODEL_PRESETS.find((preset) => optionMatchesCursorPreset(option, preset)) ?? null;
}

function findCursorPresetByLabel(label: string): CursorModelPreset | null {
  return BASIC_CURSOR_MODEL_PRESETS.find((preset) => preset.label === label) ?? null;
}

function pickPreferredValue(values: string[], preferred: string[]): string {
  for (const want of preferred) {
    const found = values.find((value) => normalizeModelName(value) === normalizeModelName(want));
    if (found) return found;
  }
  return values[0] ?? preferred[0] ?? 'Default';
}

function parseContextSize(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'default') return 0;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return amount * 1_000_000;
  if (unit === 'k') return amount * 1_000;
  return amount;
}

function sortContextValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const sizeDiff = parseContextSize(a) - parseContextSize(b);
    return sizeDiff || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const FALLBACK_THINKING_VALUES = ['minimal', 'low', 'medium', 'high', 'max', 'fast', 'none'];
const FALLBACK_CONTEXT_VALUES = ['32k', '64k', '128k', '200k', '256k', '1m', '2m'];

function titleModelToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'gpt') return 'GPT';
  if (/^\d/.test(token)) return token.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function prettifyModelId(id: string): string {
  return id
    .split(/[/:_\-\s]+/)
    .filter(Boolean)
    .map(titleModelToken)
    .join(' ');
}

function parseConfiguredModelId(id: string): { baseId: string; config: Record<string, string> } | null {
  const match = id.match(/^([^\[]+)\[([^\]]+)\]$/);
  if (!match) return null;

  const config: Record<string, string> = {};
  for (const part of match[2].split(',')) {
    const [keyRaw, ...valueParts] = part.split('=');
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join('=').trim();
    if (key && value) config[key] = value;
  }

  return { baseId: match[1].trim(), config };
}

function normalizeFallbackContext(value: string | undefined): string {
  if (!value) return 'Default';
  const lower = value.toLowerCase();
  if (lower.endsWith('m')) return `${lower.slice(0, -1)}M`;
  if (lower.endsWith('k')) return `${lower.slice(0, -1)}K`;
  return titleModelToken(value);
}

function normalizeFallbackFast(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return null;
}

function fallbackModelOption(id: string): AgentModelOption {
  if (!id || id === 'auto') {
    return { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null };
  }

  const configured = parseConfiguredModelId(id);
  if (configured) {
    return {
      id,
      label: id,
      model: prettifyModelId(configured.baseId),
      thinking: configured.config['reasoning'] || configured.config['thinking']
        ? titleModelToken(configured.config['reasoning'] ?? configured.config['thinking'])
        : 'Default',
      context: normalizeFallbackContext(configured.config['context']),
      fast: normalizeFallbackFast(configured.config['fast'])
    };
  }

  const source = id.toLowerCase();
  const thinking = FALLBACK_THINKING_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/])(?:thinking[\\s_\\-/]?)?${value}(?:$|[\\s_\\-/])`, 'i').test(source)
  );
  const context = FALLBACK_CONTEXT_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/()])${value}(?:$|[\\s_\\-/()])`, 'i').test(source)
  );
  const modelTokens = id.split(/[/:_\-\s]+/).filter((token) => {
    const lower = token.toLowerCase();
    return (
      lower !== 'thinking' &&
      lower !== 'context' &&
      !FALLBACK_THINKING_VALUES.includes(lower) &&
      !FALLBACK_CONTEXT_VALUES.includes(lower)
    );
  });
  const model = modelTokens.length > 0 ? modelTokens.map(titleModelToken).join(' ') : id;
  return {
    id,
    label: `${id} (not found)`,
    model,
    thinking: thinking ? titleModelToken(thinking) : 'Default',
    context: normalizeFallbackContext(context),
    fast: null
  };
}

const effectiveModelSelection = computed(() => props.modelValue || 'auto');
const selectedModelOption = computed(
  () =>
    props.modelOptions.find((option) => option.id === effectiveModelSelection.value) ??
    fallbackModelOption(effectiveModelSelection.value)
);
const effectiveModelOptions = computed(() => {
  const selected = selectedModelOption.value;
  if (props.modelOptions.some((option) => option.id === selected.id)) {
    return props.modelOptions;
  }
  return [selected, ...props.modelOptions];
});
const bCursorAgentSession = computed(() => props.agentType === 'cursor-agent');
const bConfigBackedThinking = computed(() => (props.thinkingOptions?.options.length ?? 0) > 0);

const modelPickerState = computed(() => {
  const options = effectiveModelOptions.value;
  const current = selectedModelOption.value;

  const modelList = sortLabelValues(uniqueValues(options.map((option) => option.model)));
  const selectedModelName = current.model;
  const thinkingList = sortThinkingValues(
    uniqueValues(
      options
        .filter((option) => option.model === selectedModelName)
        .map((option) => option.thinking)
    )
  );
  const selectedThinkingName =
    current.model === selectedModelName ? current.thinking : thinkingList[0] ?? 'Default';
  const contextList = sortContextValues(
    uniqueValues(
      options
        .filter(
          (option) => option.model === selectedModelName && option.thinking === selectedThinkingName
        )
        .map((option) => option.context)
    )
  );
  const selectedContextName =
    current.model === selectedModelName && current.thinking === selectedThinkingName
      ? current.context
      : contextList[0] ?? 'Default';
  const bFastAvailable = options.some(
    (option) =>
      option.model === selectedModelName &&
      option.thinking === selectedThinkingName &&
      option.context === selectedContextName &&
      option.fast !== null
  );
  const selectedFastValue =
    current.model === selectedModelName &&
    current.thinking === selectedThinkingName &&
    current.context === selectedContextName &&
    current.fast !== null
      ? current.fast
      : false;

  return {
    modelList,
    selectedModelName,
    thinkingList,
    selectedThinkingName,
    contextList,
    selectedContextName,
    bFastAvailable,
    selectedFastValue
  };
});

const modelList = computed(() => modelPickerState.value.modelList);
const selectedModelName = computed(() => modelPickerState.value.selectedModelName);
const thinkingList = computed(() => modelPickerState.value.thinkingList);
const selectedThinkingName = computed(() => modelPickerState.value.selectedThinkingName);
const thinkingSelectOptions = computed<ModelSelectOption[]>(() => {
  if (bConfigBackedThinking.value && props.thinkingOptions) {
    return props.thinkingOptions.options.map((option) => ({
      value: option.value,
      label: option.label
    }));
  }
  return thinkingList.value.map((thinking) => ({ value: thinking, label: thinking }));
});
const selectedThinkingValue = computed(() => {
  if (bConfigBackedThinking.value && props.thinkingOptions) {
    return (
      props.thinkingValue ||
      props.thinkingOptions.currentValue ||
      props.thinkingOptions.options[0]?.value ||
      ''
    );
  }
  return selectedThinkingName.value;
});
const thinkingLabel = computed(() =>
  props.thinkingOptions?.label?.toLowerCase() === 'effort' ? 'Thinking' : (props.thinkingOptions?.label ?? 'Thinking')
);
const contextList = computed(() => modelPickerState.value.contextList);
const selectedContextName = computed(() => modelPickerState.value.selectedContextName);
const bFastAvailable = computed(() => modelPickerState.value.bFastAvailable);
const selectedFastValue = computed(() => modelPickerState.value.selectedFastValue);
const cursorPresetOptions = computed<ModelSelectOption[]>(() =>
  BASIC_CURSOR_MODEL_PRESETS.filter((preset) =>
    effectiveModelOptions.value.some((option) => optionMatchesCursorPreset(option, preset))
  ).map((preset) => ({ value: cursorPresetValue(preset.label), label: preset.label }))
);
const selectedCursorPreset = computed(() => findCursorPresetForOption(selectedModelOption.value));
const modelSelectValue = computed(() => {
  if (!bCursorAgentSession.value) return selectedModelName.value;

  const preset = selectedCursorPreset.value;
  if (preset) {
    return cursorPresetValue(preset.label);
  }
  return cursorModelValue(selectedModelName.value);
});
const visibleModelOptions = computed<ModelSelectOption[]>(() => {
  if (!bCursorAgentSession.value) {
    return modelList.value.map((model) => ({ value: model, label: model }));
  }

  const options = [...cursorPresetOptions.value];
  const selectedValue = modelSelectValue.value;
  if (
    selectedValue.startsWith(CURSOR_CURRENT_VALUE_PREFIX) &&
    !options.some((option) => option.value === selectedValue)
  ) {
    const current = selectedModelOption.value;
    const context = current.context === 'Default' ? '' : `, ${current.context}`;
    options.push({
      value: selectedValue,
      label: `${current.model} (${current.thinking}${context})`
    });
  } else if (
    selectedValue.startsWith(CURSOR_MODEL_VALUE_PREFIX) &&
    !options.some((option) => option.value === selectedValue)
  ) {
    options.push({ value: selectedValue, label: selectedModelName.value });
  }

  if (bShowAllCursorModels.value) {
    const presetModelNames = new Set(
      BASIC_CURSOR_MODEL_PRESETS.flatMap((preset) => preset.modelNames)
    );
    for (const model of modelList.value) {
      if (presetModelNames.has(model)) continue;
      const value = cursorModelValue(model);
      if (!options.some((option) => option.value === value)) {
        options.push({ value, label: model });
      }
    }
  }

  return options;
});
const bHasHiddenModelOptions = computed(
  () =>
    bCursorAgentSession.value &&
    !bShowAllCursorModels.value &&
    (modelList.value.length > cursorPresetOptions.value.length ||
      effectiveModelOptions.value.some((option) => !findCursorPresetForOption(option)))
);

function resolveModelOption(model: string, thinking: string, context: string, fast?: boolean | null): AgentModelOption | null {
  const wantsFast = fast !== undefined && fast !== null;
  return (
    effectiveModelOptions.value.find(
      (option) =>
        option.model === model &&
        option.thinking === thinking &&
        option.context === context &&
        (!wantsFast || option.fast === fast)
    ) ??
    effectiveModelOptions.value.find((option) => option.model === model && option.thinking === thinking) ??
    effectiveModelOptions.value.find((option) => option.model === model) ??
    effectiveModelOptions.value[0] ??
    null
  );
}

function resolveBestModelOption(options: AgentModelOption[], preferredThinking: string[]): AgentModelOption | null {
  const scored = options
    .map((option) => {
      const thinkingIndex = preferredThinking.findIndex(
        (thinking) => normalizeModelName(thinking) === normalizeModelName(option.thinking)
      );
      const bThinkingMatched = thinkingIndex >= 0;
      const bDefaultContext = normalizeModelName(option.context) === 'default';
      const bAutoContext = normalizeModelName(option.context) === 'auto';
      const bSlowFast = option.fast === false;
      return {
        option,
        score:
          (bThinkingMatched ? 10_000 - thinkingIndex * 100 : 0) +
          (bDefaultContext || bAutoContext ? 1_000 : 0) +
          (bSlowFast ? 5 : 0) -
          parseContextSize(option.context) / 1_000_000_000_000
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.option ?? null;
}

function resolveDefaultCursorModelOption(preset: CursorModelPreset): AgentModelOption | null {
  const options = effectiveModelOptions.value.filter((option) => optionMatchesCursorPreset(option, preset));
  if (!options.length) return null;

  const preferredThinking = [
    preset.thinking,
    preset.label === 'Auto' ? 'Auto' : 'Default',
    'Medium',
    'High'
  ].filter((value): value is string => Boolean(value));

  return resolveBestModelOption(options, preferredThinking);
}

function resolveDefaultModelOption(model: string): AgentModelOption | null {
  const options = effectiveModelOptions.value.filter((option) => option.model === model);
  if (!options.length) return null;

  const modelKey = normalizeModelName(model);
  const sortedThinking = sortThinkingValues(uniqueValues(options.map((option) => option.thinking)));
  const preset = findCursorPresetByLabel(model);
  const preferredThinking = [
    preset?.thinking,
    modelKey === 'auto' ? 'Auto' : 'Default',
    'Medium',
    'High'
  ].filter((value): value is string => Boolean(value));
  const thinking = pickPreferredValue(sortedThinking, preferredThinking);
  const contextValues = sortContextValues(
    uniqueValues(
      options
        .filter((option) => option.thinking === thinking)
        .map((option) => option.context)
    )
  );
  const context = pickPreferredValue(contextValues, [
    modelKey === 'auto' ? 'Auto' : 'Default',
    '128K',
    '1M'
  ]);
  const bHasSlowFastVariant = options.some(
    (option) => option.thinking === thinking && option.context === context && option.fast === false
  );
  const bHasFastVariants = options.some(
    (option) => option.thinking === thinking && option.context === context && option.fast !== null
  );

  return resolveModelOption(model, thinking, context, bHasFastVariants && bHasSlowFastVariant ? false : null);
}

function emitSelection(option: AgentModelOption | null): void {
  if (option) {
    emit('update:modelValue', option.id);
  }
}

function onModelSelectChange(value: string): void {
  if (value === MORE_MODEL_OPTION_VALUE) {
    bShowAllCursorModels.value = true;
    return;
  }

  if (bCursorAgentSession.value && value.startsWith(CURSOR_PRESET_VALUE_PREFIX)) {
    const preset = findCursorPresetByLabel(value.slice(CURSOR_PRESET_VALUE_PREFIX.length));
    const next = preset ? resolveDefaultCursorModelOption(preset) : null;
    if (next) bShowAllCursorModels.value = false;
    emitSelection(next);
    return;
  }

  if (bCursorAgentSession.value && value.startsWith(CURSOR_CURRENT_VALUE_PREFIX)) {
    return;
  }

  const model = bCursorAgentSession.value && value.startsWith(CURSOR_MODEL_VALUE_PREFIX)
    ? value.slice(CURSOR_MODEL_VALUE_PREFIX.length)
    : value;
  const next = bCursorAgentSession.value ? resolveDefaultModelOption(model) : resolveModelOption(
    model,
    selectedThinkingName.value,
    selectedContextName.value,
    bFastAvailable.value ? selectedFastValue.value : null
  );
  if (next) bShowAllCursorModels.value = false;
  emitSelection(next);
}

function onModelDimensionChange(kind: 'thinking' | 'context', value: string): void {
  if (kind === 'thinking' && bConfigBackedThinking.value) {
    emit('update:thinkingValue', value);
    return;
  }
  const nextModel = selectedModelName.value;
  const next = resolveModelOption(
    nextModel,
    kind === 'thinking' ? value : selectedThinkingName.value,
    kind === 'context' ? value : selectedContextName.value,
    bFastAvailable.value ? selectedFastValue.value : null
  );
  emitSelection(next);
}

function onModelFastChange(checked: boolean): void {
  const next = resolveModelOption(
    selectedModelName.value,
    selectedThinkingName.value,
    selectedContextName.value,
    checked
  );
  emitSelection(next);
}

const modelMenuOptions = computed<SelectMenuOption[]>(() => {
  const options: SelectMenuOption[] = visibleModelOptions.value.map((option) => ({
    value: option.value,
    label: option.label
  }));
  if (bHasHiddenModelOptions.value) {
    options.push({ value: MORE_MODEL_OPTION_VALUE, label: 'More…', hint: 'special' });
  }
  return options;
});

const thinkingMenuOptions = computed<SelectMenuOption[]>(() =>
  thinkingSelectOptions.value.map((option) => ({ value: option.value, label: option.label }))
);

const contextMenuOptions = computed<SelectMenuOption[]>(() =>
  contextList.value.map((context) => ({ value: context, label: context }))
);

const wrapperClass = computed(() =>
  props.variant === 'compact'
    ? 'flex min-w-0 flex-wrap items-center gap-1 text-xs'
    : 'flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-fg/[0.12] bg-fg/[0.04] px-2 py-2 text-xs'
);
const labelClass = computed(() =>
  props.variant === 'compact'
    ? 'hidden shrink-0 text-[9px] font-medium uppercase tracking-wide text-text-muted sm:inline'
    : 'shrink-0 text-[9px] font-medium uppercase tracking-wide text-text-muted'
);
const selectButtonClass = computed(() =>
  props.variant === 'compact' ? 'w-[5.5rem] sm:w-32' : 'w-36 h-[26px]!'
);
const smallSelectButtonClass = computed(() =>
  props.variant === 'compact' ? 'w-[4.5rem] sm:w-24' : 'w-24 h-[26px]!'
);
</script>

<template>
  <div :class="wrapperClass">
    <label class="flex min-w-0 items-center gap-1">
      <span :class="labelClass">Model</span>
      <UiSelectMenu
        :model-value="modelSelectValue"
        :options="modelMenuOptions"
        :disabled="disabled"
        aria-label="Model"
        :button-class="selectButtonClass"
        @update:model-value="onModelSelectChange"
        @special="onModelSelectChange"
      />
    </label>
    <label class="flex min-w-0 items-center gap-1">
      <span :class="labelClass">{{ thinkingLabel }}</span>
      <UiSelectMenu
        :model-value="selectedThinkingValue"
        :options="thinkingMenuOptions"
        :disabled="disabled"
        :aria-label="thinkingLabel"
        :button-class="smallSelectButtonClass"
        @update:model-value="(v) => onModelDimensionChange('thinking', v)"
      />
    </label>
    <label class="flex min-w-0 items-center gap-1">
      <span :class="labelClass">Context</span>
      <UiSelectMenu
        :model-value="selectedContextName"
        :options="contextMenuOptions"
        :disabled="disabled"
        aria-label="Context"
        :button-class="smallSelectButtonClass"
        @update:model-value="(v) => onModelDimensionChange('context', v)"
      />
    </label>
    <label
      v-if="bFastAvailable"
      class="flex min-w-0 shrink-0 cursor-pointer items-center gap-1"
    >
      <span :class="labelClass">Fast</span>
      <input
        type="checkbox"
        class="h-3 w-3 shrink-0 rounded border-fg/[0.2] text-primary focus:ring-primary/40 disabled:opacity-50"
        :checked="selectedFastValue"
        :disabled="disabled"
        @change="onModelFastChange(($event.target as HTMLInputElement).checked)"
      />
    </label>
  </div>
</template>
