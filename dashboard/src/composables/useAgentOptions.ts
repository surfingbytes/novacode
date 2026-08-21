/**
 * Agent model/mode/config machinery — load options, persist session model/mode/
 * config, and inbound ACP updates. UI selection lives in AgentModelPicker.
 */

// node_modules
import { computed, ref, type Ref } from 'vue';

// classes
import { sessionsApi, settingsApi } from '@/classes/api';

// utils
import { parseConfiguredModelId } from '@/utils/agentModelPicker';

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
  let modelSelectionSaveSeq = 0;
  let sessionModeSaveSeq = 0;

  // -------------------------------------------------- Computed --------------------------------------------------
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

  // Don't warn while options are still loading — opening a chat restores the
  // saved model id immediately, but modelOptions stays empty until the agent
  // options request finishes (can take several seconds for cursor-agent).
  const bSelectedModelMissing = computed(
    () =>
      !bModelsLoading.value &&
      !!modelSelection.value &&
      modelSelection.value !== 'auto' &&
      !parseConfiguredModelId(modelSelection.value) &&
      !modelOptions.value.some((option) => option.id === modelSelection.value)
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
    modelSelection.value = 'auto';
    sessionMode.value = MODE_SENTINEL;
    acpReportedModeId.value = null;
    acpReportedModelId.value = null;
    sessionConfig.value = {};
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
    displaySessionMode,
    selectedModeOption,
    selectedModeIconName,
    modeIconName,
    bSelectedModelMissing,
    // methods
    loadAgentOptions,
    agentConfigDisplayValue,
    persistSessionConfig,
    onAgentConfigChange,
    applyInboundModeUpdate,
    applyInboundModelUpdate,
    applyInboundConfigUpdate,
    onSharedModelPickerUpdate,
    onSharedThinkingPickerUpdate,
    persistSessionMode,
    onSessionModeChange,
    applyFetchedSession,
    resetAgentOptions
  };
}

export type UseAgentOptions = ReturnType<typeof useAgentOptions>;
