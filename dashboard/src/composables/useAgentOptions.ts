/**
 * Agent model/mode/config machinery — model selection with Cursor preset
 * synthesis, session mode, agent config options, thinking levels.
 * Extracted from SessionChat.vue (previously ~750 lines inline).
 */

// node_modules
import { computed, ref, type Ref } from 'vue';

// classes
import { sessionsApi, settingsApi } from '@/classes/api';

// types
import type {
  AgentConfigOption,
  AgentModeOption,
  AgentModelOption,
  AgentThinkingOptionGroup,
  Session
} from '@/@types/index';

// -------------------------------------------------- Constants --------------------------------------------------

const MODE_SENTINEL = 'default';
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
export type ModelSelectOption = { value: string; label: string };

const FALLBACK_THINKING_VALUES = ['minimal', 'low', 'medium', 'high', 'max', 'fast', 'none'];
const FALLBACK_CONTEXT_VALUES = ['32k', '64k', '128k', '200k', '256k', '1m', '2m'];

// -------------------------------------------------- Pure helpers --------------------------------------------------

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

function cursorCurrentValue(id: string): string {
  return `${CURSOR_CURRENT_VALUE_PREFIX}${id}`;
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

export function normalizeStoredMode(mode: string | undefined): string {
  // `auto` is the legacy mode sentinel (renamed to `default`); map it so old sessions don't
  // treat it as a non-existent concrete mode.
  if (!mode || mode === 'auto') return MODE_SENTINEL;
  return mode;
}

// -------------------------------------------------- Composable --------------------------------------------------

export interface UseAgentOptionsContext {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
}

export function useAgentOptions(ctx: UseAgentOptionsContext) {
  // -------------------------------------------------- Refs --------------------------------------------------
  const modelSelection = ref<string>('auto');
  const sessionMode = ref<string>(MODE_SENTINEL);
  const acpReportedModeId = ref<string | null>(null);
  const acpReportedModelId = ref<string | null>(null);
  const modelOptions = ref<AgentModelOption[]>([]);
  const modeOptions = ref<AgentModeOption[]>([]);
  const agentConfigOptions = ref<AgentConfigOption[]>([]);
  const thinkingOptions = ref<AgentThinkingOptionGroup | null>(null);
  const sessionConfig = ref<Record<string, string>>({});
  const bModelsLoading = ref(false);
  const bModesLoading = ref(false);
  const bConfigLoading = ref(false);
  const bSavingModelSelection = ref(false);
  const bSavingSessionMode = ref(false);
  const bSavingSessionConfig = ref(false);
  const bShowAllCursorModels = ref(false);
  let modelSelectionSaveSeq = 0;
  let sessionModeSaveSeq = 0;

  // -------------------------------------------------- Computed --------------------------------------------------
  const bCursorAgentSession = computed(() => ctx.session.value?.agentType === 'cursor-agent');

  const displaySessionMode = computed(() => {
    if (acpReportedModeId.value) return acpReportedModeId.value;
    const stored = normalizeStoredMode(sessionMode.value);
    if (stored !== MODE_SENTINEL) return stored;
    return modeOptions.value.find((m) => m.current)?.id ?? modeOptions.value[0]?.id ?? MODE_SENTINEL;
  });

  const selectedModeOption = computed(
    () =>
      modeOptions.value.find((option) => option.id === displaySessionMode.value) ??
      modeOptions.value[0] ?? {
        id: MODE_SENTINEL,
        label: 'Default'
      }
  );

  function modeIconName(modeId: string): 'plan' | 'debug' | 'multi' | 'ask' | 'agent' {
    const id = modeId.toLowerCase();
    if (id.includes('plan')) return 'plan';
    if (id.includes('debug')) return 'debug';
    if (id.includes('multi')) return 'multi';
    if (id.includes('ask')) return 'ask';
    return 'agent';
  }
  const selectedModeIconName = computed(() => modeIconName(selectedModeOption.value.id));

  // The user's selection is authoritative for the model (Cursor can't change it at runtime, so any
  // echoed value reflects a startup default, not a real switch). Always show what the user picked.
  const effectiveModelSelection = computed(() => modelSelection.value || 'auto');

  const selectedModelOption = computed(
    () =>
      modelOptions.value.find((option) => option.id === effectiveModelSelection.value) ??
      fallbackModelOption(effectiveModelSelection.value)
  );

  const bSelectedModelMissing = computed(
    () =>
      !!modelSelection.value &&
      modelSelection.value !== 'auto' &&
      !parseConfiguredModelId(modelSelection.value) &&
      !modelOptions.value.some((option) => option.id === modelSelection.value)
  );

  const effectiveModelOptions = computed(() => {
    const selected = selectedModelOption.value;
    if (modelOptions.value.some((option) => option.id === selected.id)) {
      return modelOptions.value;
    }
    return [selected, ...modelOptions.value];
  });

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
            (option) =>
              option.model === selectedModelName && option.thinking === selectedThinkingName
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

  const cursorPresetOptions = computed<ModelSelectOption[]>(() =>
    BASIC_CURSOR_MODEL_PRESETS.filter((preset) =>
      effectiveModelOptions.value.some((option) => optionMatchesCursorPreset(option, preset))
    ).map((preset) => ({ value: cursorPresetValue(preset.label), label: preset.label }))
  );

  const selectedCursorPreset = computed(() => findCursorPresetForOption(selectedModelOption.value));

  const modelSelectValue = computed(() => {
    if (!bCursorAgentSession.value) return modelPickerState.value.selectedModelName;

    const preset = selectedCursorPreset.value;
    const defaultOption = preset ? resolveDefaultCursorModelOption(preset) : null;
    if (preset && defaultOption?.id === selectedModelOption.value.id) {
      return cursorPresetValue(preset.label);
    }
    if (preset) {
      return cursorCurrentValue(selectedModelOption.value.id);
    }
    return cursorModelValue(modelPickerState.value.selectedModelName);
  });

  const visibleModelOptions = computed<ModelSelectOption[]>(() => {
    if (!bCursorAgentSession.value) {
      return modelPickerState.value.modelList.map((model) => ({ value: model, label: model }));
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
      options.push({ value: selectedValue, label: modelPickerState.value.selectedModelName });
    }

    if (bShowAllCursorModels.value) {
      const presetModelNames = new Set(
        BASIC_CURSOR_MODEL_PRESETS.flatMap((preset) => preset.modelNames)
      );
      for (const model of modelPickerState.value.modelList) {
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
      (modelPickerState.value.modelList.length > cursorPresetOptions.value.length ||
        effectiveModelOptions.value.some((option) => !findCursorPresetForOption(option)))
  );

  // -------------------------------------------------- Methods --------------------------------------------------

  function syncAcpReportedFromOptions(): void {
    if (acpReportedModeId.value && !modeOptions.value.some((m) => m.id === acpReportedModeId.value)) {
      acpReportedModeId.value = null;
    }
    if (
      acpReportedModelId.value &&
      !modelOptions.value.some((m) => m.id === acpReportedModelId.value)
    ) {
      acpReportedModelId.value = null;
    }
  }

  async function loadAgentOptions(): Promise<void> {
    const agentType = ctx.session.value?.agentType;
    if (!agentType) return;
    bModelsLoading.value = true;
    bModesLoading.value = true;
    bConfigLoading.value = true;
    try {
      const { data } = await settingsApi.getAgentOptions(agentType);
      modelOptions.value =
        data.models.length > 0
          ? data.models
          : [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }];
      modeOptions.value = data.modes.length > 0 ? data.modes : [{ id: MODE_SENTINEL, label: 'Default' }];
      agentConfigOptions.value = data.configOptions;
      thinkingOptions.value = data.thinking;
      for (const opt of data.configOptions) {
        if (!sessionConfig.value[opt.id] && opt.currentValue) {
          sessionConfig.value = { ...sessionConfig.value, [opt.id]: opt.currentValue };
        }
      }
      if (
        data.thinking &&
        !sessionConfig.value[data.thinking.configId] &&
        data.thinking.currentValue
      ) {
        sessionConfig.value = {
          ...sessionConfig.value,
          [data.thinking.configId]: data.thinking.currentValue
        };
      }
      syncAcpReportedFromOptions();
    } catch {
      modelOptions.value = [
        { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }
      ];
      modeOptions.value = [{ id: MODE_SENTINEL, label: 'Default' }];
      agentConfigOptions.value = [];
      thinkingOptions.value = null;
    } finally {
      bModelsLoading.value = false;
      bModesLoading.value = false;
      bConfigLoading.value = false;
    }
  }

  function agentConfigDisplayValue(option: AgentConfigOption): string {
    return sessionConfig.value[option.id] ?? option.currentValue ?? option.options[0]?.value ?? '';
  }

  async function persistSessionConfig(next: Record<string, string>): Promise<void> {
    const prev = { ...sessionConfig.value };
    const prevSession = ctx.session.value;
    sessionConfig.value = next;
    if (ctx.session.value) {
      ctx.session.value = { ...ctx.session.value, sessionConfigJson: next };
    }
    bSavingSessionConfig.value = true;
    try {
      const { data: updated } = await sessionsApi.update(ctx.workspaceId(), ctx.sessionId(), {
        sessionConfigJson: next
      });
      ctx.session.value = updated;
      sessionConfig.value = updated.sessionConfigJson ?? next;
    } catch {
      sessionConfig.value = prev;
      ctx.session.value = prevSession;
    } finally {
      bSavingSessionConfig.value = false;
    }
  }

  function onAgentConfigChange(configId: string, value: string): void {
    if (!value) return;
    const next = { ...sessionConfig.value, [configId]: value };
    if (next[configId] === sessionConfig.value[configId]) return;
    void persistSessionConfig(next);
  }

  // The agent's reported mode/model is the source of truth: always reflect and persist it so the
  // UI can never show a different mode/model than the one the agent is actually running.
  function applyInboundModeUpdate(modeId: string): void {
    acpReportedModeId.value = modeId;
    modeOptions.value = modeOptions.value.map((m) => ({ ...m, current: m.id === modeId }));
    if (normalizeStoredMode(sessionMode.value) !== modeId) {
      void syncSessionModeFromAgent(modeId);
    }
  }

  // The user's model selection is authoritative — Cursor never changes the model on its own, and it
  // echoes its own default when our pick isn't applied. Record what the agent reports (for a mismatch
  // indicator) but never overwrite/persist the user's chosen model.
  function applyInboundModelUpdate(modelId: string): void {
    acpReportedModelId.value = modelId;
    modelOptions.value = modelOptions.value.map((m) => ({ ...m, current: m.id === modelId }));
  }

  async function syncSessionModeFromAgent(modeId: string): Promise<void> {
    const seq = ++sessionModeSaveSeq;
    const prev = sessionMode.value;
    const prevSession = ctx.session.value;
    sessionMode.value = modeId;
    if (ctx.session.value) {
      ctx.session.value = { ...ctx.session.value, sessionMode: modeId };
    }
    try {
      const { data: updated } = await sessionsApi.update(ctx.workspaceId(), ctx.sessionId(), {
        sessionMode: modeId
      });
      if (seq !== sessionModeSaveSeq) return;
      ctx.session.value = updated;
      sessionMode.value = normalizeStoredMode(updated.sessionMode);
      acpReportedModeId.value = null;
    } catch {
      if (seq !== sessionModeSaveSeq) return;
      sessionMode.value = prev;
      ctx.session.value = prevSession;
    }
  }

  function applyInboundConfigUpdate(config: Record<string, string>): void {
    for (const [id, value] of Object.entries(config)) {
      const opt = agentConfigOptions.value.find((o) => o.id === id);
      if (opt) {
        opt.currentValue = value;
      }
      if (!sessionConfig.value[id]) {
        sessionConfig.value = { ...sessionConfig.value, [id]: value };
      }
    }
  }

  function resolveModelOption(
    model: string,
    thinking: string,
    context: string,
    fast?: boolean | null
  ): AgentModelOption | null {
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

  function resolveBestModelOption(
    options: AgentModelOption[],
    preferredThinking: string[]
  ): AgentModelOption | null {
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
    const options = effectiveModelOptions.value.filter((option) =>
      optionMatchesCursorPreset(option, preset)
    );
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
        options.filter((option) => option.thinking === thinking).map((option) => option.context)
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

    return resolveModelOption(
      model,
      thinking,
      context,
      bHasFastVariants && bHasSlowFastVariant ? false : null
    );
  }

  async function persistModelSelection(newModelSelection: string): Promise<void> {
    const seq = ++modelSelectionSaveSeq;
    const prev = modelSelection.value;
    const prevSession = ctx.session.value;
    acpReportedModelId.value = null;
    modelSelection.value = newModelSelection;
    if (ctx.session.value) {
      ctx.session.value = { ...ctx.session.value, modelSelection: newModelSelection };
    }
    bSavingModelSelection.value = true;
    try {
      const { data: updated } = await sessionsApi.update(ctx.workspaceId(), ctx.sessionId(), {
        modelSelection: newModelSelection
      });
      if (seq !== modelSelectionSaveSeq) return;
      ctx.session.value = updated;
      modelSelection.value = updated.modelSelection ?? newModelSelection;
    } catch {
      if (seq !== modelSelectionSaveSeq) return;
      modelSelection.value = prev;
      ctx.session.value = prevSession;
    } finally {
      if (seq === modelSelectionSaveSeq) bSavingModelSelection.value = false;
    }
  }

  function reopenModelSelect(selectEl: HTMLSelectElement): void {
    selectEl.focus();
    try {
      selectEl.showPicker?.();
    } catch {
      // Some browsers only allow showPicker during the original user gesture.
    }
  }

  function onModelSelectChange(value: string, selectEl: HTMLSelectElement): void {
    if (value === MORE_MODEL_OPTION_VALUE) {
      bShowAllCursorModels.value = true;
      void nextTickish(() => reopenModelSelect(selectEl));
      return;
    }

    if (bCursorAgentSession.value && value.startsWith(CURSOR_PRESET_VALUE_PREFIX)) {
      const preset = findCursorPresetByLabel(value.slice(CURSOR_PRESET_VALUE_PREFIX.length));
      const next = preset ? resolveDefaultCursorModelOption(preset) : null;
      if (next && next.id !== modelSelection.value) {
        bShowAllCursorModels.value = false;
        void persistModelSelection(next.id);
      }
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
      ? resolveDefaultModelOption(model)
      : resolveModelOption(
          model,
          modelPickerState.value.selectedThinkingName,
          modelPickerState.value.selectedContextName,
          modelPickerState.value.bFastAvailable ? modelPickerState.value.selectedFastValue : null
        );
    if (next && next.id !== modelSelection.value) {
      bShowAllCursorModels.value = false;
      void persistModelSelection(next.id);
    }
  }

  function onModelDimensionChange(kind: 'thinking' | 'context', value: string): void {
    const nextModel = modelPickerState.value.selectedModelName;
    const next = resolveModelOption(
      nextModel,
      kind === 'thinking' ? value : modelPickerState.value.selectedThinkingName,
      kind === 'context' ? value : modelPickerState.value.selectedContextName,
      modelPickerState.value.bFastAvailable ? modelPickerState.value.selectedFastValue : null
    );
    if (next && next.id !== modelSelection.value) {
      void persistModelSelection(next.id);
    }
  }

  function onModelFastChange(checked: boolean): void {
    const next = resolveModelOption(
      modelPickerState.value.selectedModelName,
      modelPickerState.value.selectedThinkingName,
      modelPickerState.value.selectedContextName,
      checked
    );
    if (next && next.id !== modelSelection.value) {
      void persistModelSelection(next.id);
    }
  }

  function onSharedModelPickerUpdate(nextModelSelection: string): void {
    if (nextModelSelection && nextModelSelection !== modelSelection.value) {
      void persistModelSelection(nextModelSelection);
    }
  }

  function onSharedThinkingPickerUpdate(nextThinkingValue: string): void {
    const configId = thinkingOptions.value?.configId;
    if (!configId || !nextThinkingValue || sessionConfig.value[configId] === nextThinkingValue) {
      return;
    }
    void persistSessionConfig({ ...sessionConfig.value, [configId]: nextThinkingValue });
  }

  async function persistSessionMode(newSessionMode: string): Promise<void> {
    const seq = ++sessionModeSaveSeq;
    const prev = sessionMode.value;
    const prevSession = ctx.session.value;
    sessionMode.value = newSessionMode;
    if (ctx.session.value) {
      ctx.session.value = { ...ctx.session.value, sessionMode: newSessionMode };
    }
    bSavingSessionMode.value = true;
    try {
      const { data: updated } = await sessionsApi.update(ctx.workspaceId(), ctx.sessionId(), {
        sessionMode: newSessionMode
      });
      if (seq !== sessionModeSaveSeq) return;
      ctx.session.value = updated;
      sessionMode.value = updated.sessionMode ?? newSessionMode;
    } catch {
      if (seq !== sessionModeSaveSeq) return;
      sessionMode.value = prev;
      ctx.session.value = prevSession;
    } finally {
      if (seq === sessionModeSaveSeq) bSavingSessionMode.value = false;
    }
  }

  function onSessionModeChange(value: string): void {
    const normalized = value || MODE_SENTINEL;
    acpReportedModeId.value = null;
    if (normalized !== normalizeStoredMode(sessionMode.value)) {
      void persistSessionMode(normalized);
    }
  }

  /** Apply session fields fetched from the API (initial load / session switch). */
  function applyFetchedSession(data: Session): void {
    modelSelection.value = data.modelSelection ?? 'auto';
    sessionMode.value = normalizeStoredMode(data.sessionMode);
    sessionConfig.value = data.sessionConfigJson ?? {};
    acpReportedModeId.value = null;
    acpReportedModelId.value = null;
  }

  /** Reset everything (session switch). */
  function resetAgentOptions(): void {
    modelOptions.value = [];
    modeOptions.value = [];
    agentConfigOptions.value = [];
    thinkingOptions.value = null;
    bShowAllCursorModels.value = false;
    modelSelection.value = 'auto';
    sessionMode.value = MODE_SENTINEL;
    acpReportedModeId.value = null;
    acpReportedModelId.value = null;
    sessionConfig.value = {};
  }

  // Small indirection so the composable doesn't import nextTick from vue in a confusing way.
  function nextTickish(cb: () => void): void {
    void Promise.resolve().then(cb);
  }

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    modelSelection,
    sessionMode,
    acpReportedModeId,
    acpReportedModelId,
    modelOptions,
    modeOptions,
    agentConfigOptions,
    thinkingOptions,
    sessionConfig,
    bModelsLoading,
    bModesLoading,
    bConfigLoading,
    bSavingModelSelection,
    bSavingSessionMode,
    bSavingSessionConfig,
    bShowAllCursorModels,
    bCursorAgentSession,
    displaySessionMode,
    selectedModeOption,
    selectedModeIconName,
    modeIconName,
    effectiveModelSelection,
    selectedModelOption,
    bSelectedModelMissing,
    effectiveModelOptions,
    modelPickerState,
    cursorPresetOptions,
    modelSelectValue,
    visibleModelOptions,
    bHasHiddenModelOptions,
    // methods
    loadAgentOptions,
    agentConfigDisplayValue,
    persistSessionConfig,
    onAgentConfigChange,
    applyInboundModeUpdate,
    applyInboundModelUpdate,
    applyInboundConfigUpdate,
    onModelSelectChange,
    onModelDimensionChange,
    onModelFastChange,
    onSharedModelPickerUpdate,
    onSharedThinkingPickerUpdate,
    persistSessionMode,
    onSessionModeChange,
    applyFetchedSession,
    resetAgentOptions
  };
}

export type UseAgentOptions = ReturnType<typeof useAgentOptions>;
