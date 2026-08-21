<script setup lang="ts">
// node_modules
import { computed, ref } from 'vue';

// components
import UiSelectMenu, { type SelectMenuOption } from '@/components/ui/UiSelectMenu.vue';

// utils
import {
  MORE_MODEL_OPTION_VALUE,
  CURSOR_MODEL_VALUE_PREFIX,
  CURSOR_PRESET_VALUE_PREFIX,
  CURSOR_CURRENT_VALUE_PREFIX,
  buildCursorPresetOptions,
  buildModelPickerState,
  buildVisibleModelOptions,
  cursorModelValue,
  cursorPresetValue,
  fallbackModelOption,
  findCursorPresetByLabel,
  findCursorPresetForOption,
  hasHiddenModelOptions,
  resolveDefaultCursorModelOption,
  resolveDefaultModelOption,
  resolveModelOption
} from '@/utils/agentModelPicker';

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

const bShowAllCursorModels = ref(false);

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

const modelPickerState = computed(() =>
  buildModelPickerState(effectiveModelOptions.value, selectedModelOption.value)
);

const modelList = computed(() => modelPickerState.value.modelList);
const selectedModelName = computed(() => modelPickerState.value.selectedModelName);
const thinkingList = computed(() => modelPickerState.value.thinkingList);
const selectedThinkingName = computed(() => modelPickerState.value.selectedThinkingName);
const thinkingSelectOptions = computed<SelectMenuOption[]>(() => {
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
  props.thinkingOptions?.label?.toLowerCase() === 'effort'
    ? 'Thinking'
    : (props.thinkingOptions?.label ?? 'Thinking')
);
const contextList = computed(() => modelPickerState.value.contextList);
const selectedContextName = computed(() => modelPickerState.value.selectedContextName);
const bFastAvailable = computed(() => modelPickerState.value.bFastAvailable);
const selectedFastValue = computed(() => modelPickerState.value.selectedFastValue);
const cursorPresetOptions = computed(() => buildCursorPresetOptions(effectiveModelOptions.value));
const selectedCursorPreset = computed(() => findCursorPresetForOption(selectedModelOption.value));
const modelSelectValue = computed(() => {
  if (!bCursorAgentSession.value) return selectedModelName.value;

  const preset = selectedCursorPreset.value;
  if (preset) {
    return cursorPresetValue(preset.label);
  }
  return cursorModelValue(selectedModelName.value);
});
const visibleModelOptions = computed(() =>
  buildVisibleModelOptions({
    bCursorAgent: bCursorAgentSession.value,
    bShowAllCursorModels: bShowAllCursorModels.value,
    picker: modelPickerState.value,
    selected: selectedModelOption.value,
    modelSelectValue: modelSelectValue.value,
    presetOptions: cursorPresetOptions.value
  })
);
const bHasHiddenModelOptions = computed(() =>
  hasHiddenModelOptions({
    bCursorAgent: bCursorAgentSession.value,
    bShowAllCursorModels: bShowAllCursorModels.value,
    modelListLength: modelList.value.length,
    presetOptionsLength: cursorPresetOptions.value.length,
    options: effectiveModelOptions.value
  })
);

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
    const next = preset
      ? resolveDefaultCursorModelOption(effectiveModelOptions.value, preset)
      : null;
    if (next) bShowAllCursorModels.value = false;
    emitSelection(next);
    return;
  }

  if (bCursorAgentSession.value && value.startsWith(CURSOR_CURRENT_VALUE_PREFIX)) {
    return;
  }

  const model =
    bCursorAgentSession.value && value.startsWith(CURSOR_MODEL_VALUE_PREFIX)
      ? value.slice(CURSOR_MODEL_VALUE_PREFIX.length)
      : value;
  const next = bCursorAgentSession.value
    ? resolveDefaultModelOption(effectiveModelOptions.value, model)
    : resolveModelOption(
        effectiveModelOptions.value,
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
  const next = resolveModelOption(
    effectiveModelOptions.value,
    selectedModelName.value,
    kind === 'thinking' ? value : selectedThinkingName.value,
    kind === 'context' ? value : selectedContextName.value,
    bFastAvailable.value ? selectedFastValue.value : null
  );
  emitSelection(next);
}

function onModelFastChange(checked: boolean): void {
  const next = resolveModelOption(
    effectiveModelOptions.value,
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

const thinkingMenuOptions = computed<SelectMenuOption[]>(() => thinkingSelectOptions.value);

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
