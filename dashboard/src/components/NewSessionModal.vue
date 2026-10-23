<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';
import { ChevronDown, ChevronRight } from 'lucide-vue-next';

// components
import BaseModal from '@/components/BaseModal.vue';
import TagChipsInput from '@/components/input/TagChipsInput.vue';
import AgentModelPicker from '@/components/AgentModelPicker.vue';
import ModalHeader from '@/components/ModalHeader.vue';
import UiToggle from '@/components/ui/UiToggle.vue';

// classes
import { settingsApi } from '@/classes/api';

// types
import type { AgentModelOption, AgentType, ApprovalPolicy, LinkedPlanContext } from '@/@types/index';
import type { NewOrchestratorOptions } from '@/lib/createPlanningSession';

// utils
import { agentSelectedStyle, agentTypeLabel } from '@/utils/agentTypeMeta';

type NewSessionMode = 'session' | 'orchestrator';

const AUTO_MODEL_OPTION: AgentModelOption = { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null };
const MAX_PARALLEL_CHOICES = [1, 2, 3, 4, 5, 6, 8];

const AGENT_FALLBACK_ORDER: AgentType[] = [
  'cursor-agent',
  'mistral-vibe',
  'claude',
  'open-code',
  'codex'
];

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  title?: string;
  submitLabel?: string;
  helperText?: string;
  defaultSessionName?: string;
  defaultAgentType?: AgentType | null;
  defaultModelSelection?: string | null;
  showModelSelection?: boolean;
  /** Whether Claude can be used for new sessions (CLI available and token configured). */
  claudeAvailable?: boolean;
  /** Whether Cursor can be used for new sessions (authenticated). */
  cursorAvailable?: boolean;
  /** Whether Mistral Vibe can be used (CLI on PATH and API key in `~/.vibe/.env`). */
  mistralVibeAvailable?: boolean;
  /** Whether OpenCode can be used (CLI on PATH and ACP server available). */
  codexAvailable?: boolean;
  openCodeAvailable?: boolean;
  /**
   * False while capabilities have never been fetched: the availability flags
   * are placeholders then, so show "loading" instead of "no agents".
   */
  agentsLoaded?: boolean;
  error?: string | null;
  /** Tag suggestions from existing sessions in the workspace. */
  existingTags?: string[];
  /** Offer the Session / Orchestrator switch (orchestrator = planning chat + linked plan). */
  allowOrchestrator?: boolean;
  initialMode?: NewSessionMode;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  create: [
    payload: {
      name: string;
      tags?: string[] | null;
      agentType: AgentType;
      modelSelection?: string | null;
      linkedPlanContext?: LinkedPlanContext | null;
      approvalPolicy: ApprovalPolicy;
      /** Set in orchestrator mode: create a planning chat with a linked plan. */
      orchestrator?: NewOrchestratorOptions;
    }
  ];
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const name = ref('');
const formTags = ref<string[]>([]);
const agentType = ref<AgentType>('cursor-agent');
const modelSelection = ref('');
const modelOptions = ref<AgentModelOption[]>([]);
const bLoadingModels = ref(false);
const bTagsExpanded = ref(false);
const bAdvancedExpanded = ref(false);
const approvalPolicy = ref<ApprovalPolicy>('ask');
const mode = ref<NewSessionMode>('session');
const bSameWorkers = ref(true);
const workerAgentType = ref<AgentType>('cursor-agent');
const workerModelSelection = ref('');
const workerModelOptions = ref<AgentModelOption[]>([]);
const bLoadingWorkerModels = ref(false);
const maxParallel = ref(3);
const bSameVerify = ref(true);
const verifyAgentType = ref<AgentType>('cursor-agent');
const verifyModelSelection = ref('');
const verifyModelOptions = ref<AgentModelOption[]>([]);
const bLoadingVerifyModels = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------
const availableAgents = computed(() => {
  const agents: AgentType[] = [];
  if (props.cursorAvailable !== false) agents.push('cursor-agent');
  if (props.mistralVibeAvailable !== false) agents.push('mistral-vibe');
  if (props.claudeAvailable !== false) agents.push('claude');
  if (props.openCodeAvailable !== false) agents.push('open-code');
  if (props.codexAvailable !== false) agents.push('codex');
  return agents;
});

const GRID_COLS_CLASSES = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5'];
const gridColsClass = computed(
  () => GRID_COLS_CLASSES[Math.min(availableAgents.value.length, GRID_COLS_CLASSES.length - 1)],
);
const bOrchestratorMode = computed(() => mode.value === 'orchestrator');
/** Orchestrator mode always picks the planning model up front. */
const bShowModel = computed(() => props.showModelSelection === true || bOrchestratorMode.value);
const modalTitle = computed(() => (bOrchestratorMode.value ? 'New orchestrator' : props.title ?? 'New session'));
const modalEyebrow = computed(() => `// ${modalTitle.value.toLowerCase()}`);
const createLabel = computed(() => props.submitLabel ?? 'Create');
const modalHelperText = computed(() =>
  bOrchestratorMode.value
    ? 'Opens a planning chat. Describe the work there; the agent writes the spec and splits it into steps you run one by one or in parallel.'
    : props.helperText
);

// -------------------------------------------------- Methods --------------------------------------------------
function isAgentAvailable(agent: AgentType): boolean {
  if (agent === 'cursor-agent') {
    return props.cursorAvailable !== false;
  }
  if (agent === 'claude') {
    return props.claudeAvailable !== false;
  }
  if (agent === 'mistral-vibe') {
    return props.mistralVibeAvailable !== false;
  }
  if (agent === 'open-code') {
    return props.openCodeAvailable !== false;
  }
  if (agent === 'codex') {
    return props.codexAvailable !== false;
  }
  return false;
}

function computeInitialAgentType(): AgentType {
  const preferred = props.defaultAgentType ?? 'cursor-agent';
  if (isAgentAvailable(preferred)) {
    return preferred;
  }
  for (const fallbackAgentType of AGENT_FALLBACK_ORDER) {
    if (isAgentAvailable(fallbackAgentType)) {
      return fallbackAgentType;
    }
  }
  // Fallback to first available if preferred is not available
  return availableAgents.value[0] ?? preferred;
}

const close = (): void => {
  if (!props.loading) {
    emit('update:modelValue', false);
  }
};

const onCreate = (): void => {
  if (props.loading) {
    return;
  }
  const finalName = name.value.trim() || props.defaultSessionName?.trim() || '';
  const tags = formTags.value;
  emit('create', {
    name: finalName,
    ...(tags.length > 0 ? { tags } : {}),
    agentType: agentType.value,
    approvalPolicy: approvalPolicy.value,
    ...(bShowModel.value && modelSelection.value ? { modelSelection: modelSelection.value } : {}),
    ...(bOrchestratorMode.value
      ? {
          orchestrator: {
            workerAgentType: bSameWorkers.value ? agentType.value : workerAgentType.value,
            workerModel: bSameWorkers.value ? null : workerModelSelection.value || null,
            maxParallel: maxParallel.value,
            verifyAgentType: bSameVerify.value ? null : verifyAgentType.value,
            verifyModel: bSameVerify.value ? null : verifyModelSelection.value || null
          }
        }
      : {})
  });
};

function selectAgentType(agent: AgentType): void {
  if (isAgentAvailable(agent)) {
    agentType.value = agent;
  }
}

/** Resolves to null when the request fails so callers can keep a previous catalog. */
async function fetchModelOptions(agent: AgentType): Promise<AgentModelOption[] | null> {
  try {
    const { data } = await settingsApi.getAgentOptions(agent);
    return data.models.length > 0 ? data.models : [AUTO_MODEL_OPTION];
  } catch {
    return null;
  }
}

let modelOptionsAgent: AgentType | null = null;
let workerModelOptionsAgent: AgentType | null = null;
let verifyModelOptionsAgent: AgentType | null = null;

async function loadModelOptions(): Promise<void> {
  if (!bShowModel.value) {
    modelOptions.value = [];
    modelOptionsAgent = null;
    return;
  }
  const agent = agentType.value;
  bLoadingModels.value = true;
  try {
    const fetched = await fetchModelOptions(agent);
    if (agent !== agentType.value) return;
    if (fetched) {
      modelOptions.value = fetched;
      modelOptionsAgent = agent;
    } else if (modelOptionsAgent !== agent || modelOptions.value.length === 0) {
      // Nothing cached for this agent — fall back to Auto; a cached catalog for
      // the same agent survives a flaky request untouched.
      modelOptions.value = [AUTO_MODEL_OPTION];
      modelOptionsAgent = agent;
    }
    if (modelSelection.value && !modelOptions.value.some((option) => option.id === modelSelection.value)) {
      modelSelection.value = '';
    }
  } finally {
    if (agent === agentType.value) {
      bLoadingModels.value = false;
    }
  }
}

async function loadWorkerModelOptions(): Promise<void> {
  const agent = workerAgentType.value;
  bLoadingWorkerModels.value = true;
  try {
    const fetched = await fetchModelOptions(agent);
    if (agent !== workerAgentType.value) return;
    if (fetched) {
      workerModelOptions.value = fetched;
      workerModelOptionsAgent = agent;
    } else if (workerModelOptionsAgent !== agent || workerModelOptions.value.length === 0) {
      workerModelOptions.value = [AUTO_MODEL_OPTION];
      workerModelOptionsAgent = agent;
    }
  } finally {
    if (agent === workerAgentType.value) {
      bLoadingWorkerModels.value = false;
    }
  }
}

function selectWorkerAgentType(agent: AgentType): void {
  if (isAgentAvailable(agent)) {
    workerAgentType.value = agent;
  }
}

async function loadVerifyModelOptions(): Promise<void> {
  const agent = verifyAgentType.value;
  bLoadingVerifyModels.value = true;
  try {
    const fetched = await fetchModelOptions(agent);
    if (agent !== verifyAgentType.value) return;
    if (fetched) {
      verifyModelOptions.value = fetched;
      verifyModelOptionsAgent = agent;
    } else if (verifyModelOptionsAgent !== agent || verifyModelOptions.value.length === 0) {
      verifyModelOptions.value = [AUTO_MODEL_OPTION];
      verifyModelOptionsAgent = agent;
    }
  } finally {
    if (agent === verifyAgentType.value) {
      bLoadingVerifyModels.value = false;
    }
  }
}

function selectVerifyAgentType(agent: AgentType): void {
  if (isAgentAvailable(agent)) {
    verifyAgentType.value = agent;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      formTags.value = [];
      bTagsExpanded.value = false;
      approvalPolicy.value = 'ask';
      const suggestedName = props.defaultSessionName?.trim() ?? '';
      name.value = suggestedName;
      bAdvancedExpanded.value = suggestedName.length > 0 || props.showModelSelection === true;
      agentType.value = computeInitialAgentType();
      modelSelection.value = props.defaultModelSelection ?? '';
      mode.value = props.allowOrchestrator && props.initialMode === 'orchestrator' ? 'orchestrator' : 'session';
      bSameWorkers.value = true;
      workerAgentType.value = agentType.value;
      workerModelSelection.value = '';
      maxParallel.value = 3;
      bSameVerify.value = true;
      verifyAgentType.value = agentType.value;
      verifyModelSelection.value = '';
      void loadModelOptions();
    }
  }
);

watch(agentType, () => {
  if (props.modelValue && bShowModel.value) {
    modelSelection.value = '';
    void loadModelOptions();
  }
});

watch(mode, () => {
  if (props.modelValue && bShowModel.value && modelOptions.value.length === 0) {
    void loadModelOptions();
  }
});

watch(bSameWorkers, (bSame) => {
  if (!bSame) {
    workerAgentType.value = agentType.value;
    void loadWorkerModelOptions();
  }
});

watch(workerAgentType, () => {
  if (props.modelValue && !bSameWorkers.value) {
    workerModelSelection.value = '';
    void loadWorkerModelOptions();
  }
});

watch(bSameVerify, (bSame) => {
  if (!bSame) {
    verifyAgentType.value = agentType.value;
    void loadVerifyModelOptions();
  }
});

watch(verifyAgentType, () => {
  if (props.modelValue && !bSameVerify.value) {
    verifyModelSelection.value = '';
    void loadVerifyModelOptions();
  }
});
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="new-session-title"
    :panel-class="availableAgents.length > 3 ? 'max-w-md' : 'max-w-sm'"
    @update:model-value="close"
  >
    <!-- Panel -->
    <form class="contents" @submit.prevent="onCreate">
          <ModalHeader
            :eyebrow="modalEyebrow"
            :title="modalTitle"
            title-id="new-session-title"
            @close="close"
          />
          <!-- Scrollable region: shrinks when the mobile keyboard reduces the viewport -->
          <div class="min-h-0 flex-1 overflow-y-auto">
            <div v-if="allowOrchestrator" class="px-6 pt-2">
              <div
                class="grid grid-cols-2 rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1"
                role="group"
                aria-label="Session or orchestrator"
              >
                <button
                  v-for="option in (['session', 'orchestrator'] as const)"
                  :key="option"
                  type="button"
                  class="text-xs px-2 py-1.5 rounded-md border transition-colors"
                  :class="
                    mode === option
                      ? 'border-fg/20 bg-fg/[0.1] text-text-primary'
                      : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.06]'
                  "
                  :aria-pressed="mode === option"
                  @click="mode = option"
                >
                  {{ option === 'session' ? 'Session' : 'Orchestrator' }}
                </button>
              </div>
            </div>
            <div v-if="modalHelperText" class="px-6 pt-2">
              <p class="text-xs text-text-muted">{{ modalHelperText }}</p>
            </div>

            <div class="px-6 flex flex-col gap-4 pb-5 pt-2">
              <!-- Agent (ACP) selection -->
              <div class="nc-field">
                <span class="nc-field-label">
                  {{ bOrchestratorMode ? 'Planning agent' : 'Agent' }}
                  <span class="normal-case opacity-60">(ACP)</span>
                </span>
                <div
                  class="grid rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1"
                  :class="gridColsClass"
                >
                  <button
                    v-for="agent in availableAgents"
                    :key="agent"
                    type="button"
                    class="min-w-0 truncate text-xs px-1 sm:px-2 py-1.5 rounded-md border border-transparent transition-colors text-text-muted hover:text-text-primary hover:bg-fg/[0.06]"
                    :style="agentType === agent ? agentSelectedStyle(agent) : {}"
                    :title="
                      agent === 'cursor-agent'
                        ? 'Cursor Agent'
                        : agent === 'mistral-vibe'
                          ? 'Mistral Vibe'
                          : agent === 'claude'
                            ? 'Claude Code'
                            : agent === 'codex'
                              ? 'Codex'
                              : 'OpenCode'
                    "
                    @click="selectAgentType(agent)"
                  >
                    {{
                      agent === 'cursor-agent'
                        ? 'Cursor'
                        : agent === 'mistral-vibe'
                          ? 'Vibe'
                          : agent === 'claude'
                            ? 'Claude'
                            : agent === 'codex'
                              ? 'Codex'
                              : 'OpenCode'
                    }}
                  </button>
                </div>
                <p
                  v-if="availableAgents.length === 0 && agentsLoaded === false"
                  class="text-[11px] text-text-muted"
                >
                  Loading agents…
                </p>
                <p v-else-if="availableAgents.length === 0" class="text-[11px] text-warning">
                  No agents available. Configure an ACP in Settings.
                </p>
              </div>

              <template v-if="bOrchestratorMode">
                <div class="nc-field">
                  <span class="nc-field-label">Planning model</span>
                  <AgentModelPicker
                    v-model="modelSelection"
                    :agent-type="agentType"
                    :model-options="modelOptions"
                    :disabled="loading || bLoadingModels"
                    variant="modal"
                  />
                </div>

                <!-- Step agents: same as the planning chat unless changed -->
                <div class="nc-field">
                  <div class="flex items-center justify-between gap-3">
                    <span class="nc-field-label">Workers use the same agent and model</span>
                    <UiToggle v-model="bSameWorkers" aria-label="Workers use the same agent and model" />
                  </div>
                  <template v-if="!bSameWorkers">
                    <div
                      class="grid rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1 mt-2"
                      :class="gridColsClass"
                      role="group"
                      aria-label="Worker agent"
                    >
                      <button
                        v-for="agent in availableAgents"
                        :key="'worker-' + agent"
                        type="button"
                        class="min-w-0 truncate text-xs px-1 sm:px-2 py-1.5 rounded-md border border-transparent transition-colors text-text-muted hover:text-text-primary hover:bg-fg/[0.06]"
                        :style="workerAgentType === agent ? agentSelectedStyle(agent) : {}"
                        :title="agentTypeLabel(agent)"
                        @click="selectWorkerAgentType(agent)"
                      >
                        {{ agentTypeLabel(agent) }}
                      </button>
                    </div>
                    <div class="mt-2">
                      <AgentModelPicker
                        v-model="workerModelSelection"
                        :agent-type="workerAgentType"
                        :model-options="workerModelOptions"
                        :disabled="loading || bLoadingWorkerModels"
                        variant="modal"
                      />
                    </div>
                  </template>
                </div>

                <!-- Final verify step: same as the planning chat unless changed -->
                <div class="nc-field">
                  <div class="flex items-center justify-between gap-3">
                    <span class="nc-field-label">Verification uses the same agent and model</span>
                    <UiToggle v-model="bSameVerify" aria-label="Verification uses the same agent and model" />
                  </div>
                  <template v-if="!bSameVerify">
                    <div
                      class="grid rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1 mt-2"
                      :class="gridColsClass"
                      role="group"
                      aria-label="Verification agent"
                    >
                      <button
                        v-for="agent in availableAgents"
                        :key="'verify-' + agent"
                        type="button"
                        class="min-w-0 truncate text-xs px-1 sm:px-2 py-1.5 rounded-md border border-transparent transition-colors text-text-muted hover:text-text-primary hover:bg-fg/[0.06]"
                        :style="verifyAgentType === agent ? agentSelectedStyle(agent) : {}"
                        :title="agentTypeLabel(agent)"
                        @click="selectVerifyAgentType(agent)"
                      >
                        {{ agentTypeLabel(agent) }}
                      </button>
                    </div>
                    <div class="mt-2">
                      <AgentModelPicker
                        v-model="verifyModelSelection"
                        :agent-type="verifyAgentType"
                        :model-options="verifyModelOptions"
                        :disabled="loading || bLoadingVerifyModels"
                        variant="modal"
                      />
                    </div>
                  </template>
                </div>
              </template>

              <!-- Approval policy — compact segmented control (same row density as agent) -->
              <div class="nc-field">
                <div class="flex items-center gap-3">
                  <span class="nc-field-label shrink-0">Approval</span>
                  <div
                    class="grid flex-1 grid-cols-2 rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1"
                    role="group"
                    aria-label="Approval policy"
                  >
                    <button
                      type="button"
                      class="text-xs px-2 py-1.5 rounded-md border transition-colors"
                      :class="
                        approvalPolicy === 'ask'
                          ? 'border-fg/20 bg-fg/[0.1] text-text-primary'
                          : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.06]'
                      "
                      :aria-pressed="approvalPolicy === 'ask'"
                      title="Prompt before tool actions"
                      @click="approvalPolicy = 'ask'"
                    >
                      Ask
                    </button>
                    <button
                      type="button"
                      class="text-xs px-2 py-1.5 rounded-md border transition-colors"
                      :class="
                        approvalPolicy === 'allow_all'
                          ? 'border-warning/40 bg-warning/15 text-warning'
                          : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.06]'
                      "
                      :aria-pressed="approvalPolicy === 'allow_all'"
                      title="Auto-approve tool actions"
                      @click="approvalPolicy = 'allow_all'"
                    >
                      Allow all
                    </button>
                  </div>
                </div>
              </div>

              <!-- Name, tags, and optional model stay out of the way -->
              <div class="nc-field">
                <button
                  type="button"
                  class="tags-toggle"
                  :aria-expanded="bAdvancedExpanded"
                  aria-controls="new-session-advanced-panel"
                  @click="bAdvancedExpanded = !bAdvancedExpanded"
                >
                  <ChevronRight v-if="!bAdvancedExpanded" :size="12" aria-hidden="true" />
                  <ChevronDown v-else :size="12" aria-hidden="true" />
                  <span class="nc-field-label">Advanced</span>
                  <span
                    v-if="(name.trim() || formTags.length > 0) && !bAdvancedExpanded"
                    class="rounded-md bg-primary/15 px-1.5 py-px text-[10.5px] leading-4 text-primary"
                  >
                    {{ [name.trim() ? 'name' : null, formTags.length > 0 ? String(formTags.length) : null].filter(Boolean).join(' · ') }}
                  </span>
                </button>
                <div v-if="bAdvancedExpanded" id="new-session-advanced-panel" class="flex flex-col gap-4 pt-3">
                  <div class="nc-field">
                    <label class="nc-field-label" for="new-session-name">Name</label>
                    <input
                      id="new-session-name"
                      v-model="name"
                      type="text"
                      placeholder="AI-generated after first prompt"
                      @keydown.escape="close"
                    />
                  </div>

                  <div class="nc-field">
                    <button
                      type="button"
                      class="tags-toggle"
                      :aria-expanded="bTagsExpanded"
                      aria-controls="new-session-tags-panel"
                      @click="bTagsExpanded = !bTagsExpanded"
                    >
                      <ChevronRight v-if="!bTagsExpanded" :size="12" aria-hidden="true" />
                      <ChevronDown v-else :size="12" aria-hidden="true" />
                      <span class="nc-field-label"
                        >Tags <span class="normal-case opacity-60">(optional)</span></span
                      >
                      <span
                        v-if="formTags.length > 0 && !bTagsExpanded"
                        class="rounded-md bg-primary/15 px-1.5 py-px text-[10.5px] leading-4 text-primary"
                      >
                        {{ formTags.length }}
                      </span>
                    </button>
                    <div v-if="bTagsExpanded" id="new-session-tags-panel">
                      <TagChipsInput
                        v-model="formTags"
                        :suggestions="existingTags ?? []"
                        datalist-id="new-session-tag-suggestions"
                        hint="Separate tags with a comma, or press Enter/Done. Suggestions from other sessions."
                      />
                    </div>
                  </div>

                  <div v-if="bOrchestratorMode" class="nc-field">
                    <label class="nc-field-label" for="new-session-max-parallel">Parallel steps at once</label>
                    <select id="new-session-max-parallel" v-model.number="maxParallel">
                      <option v-for="count in MAX_PARALLEL_CHOICES" :key="count" :value="count">{{ count }}</option>
                    </select>
                  </div>

                  <div v-if="showModelSelection && !bOrchestratorMode" class="nc-field">
                    <span class="nc-field-label">Model</span>
                    <AgentModelPicker
                      v-model="modelSelection"
                      :agent-type="agentType"
                      :model-options="modelOptions"
                      :disabled="loading || bLoadingModels"
                      variant="modal"
                    />
                  </div>
                </div>
              </div>

              <p v-if="error" class="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {{ error }}
              </p>
            </div>
          </div>

          <!-- Actions — pinned below the scrollable fields so Create stays reachable -->
          <div class="flex flex-shrink-0 items-center justify-end gap-2 border-t border-fg/10 px-6 py-4">
            <button
              type="button"
              class="button"
              :disabled="loading"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="button is-primary"
              :disabled="loading"
              data-modal-autofocus
            >
              <div
                v-if="loading"
                class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
              />
              {{ createLabel }}
            </button>
          </div>
    </form>
  </BaseModal>
</template>

<style scoped>
/* Disclosure toggle matching the field-label treatment */
.tags-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  transition: color 0.12s;
}
.tags-toggle:hover,
.tags-toggle:focus-visible {
  color: var(--fg);
}
.tags-toggle:hover .nc-field-label,
.tags-toggle:focus-visible .nc-field-label {
  color: var(--fg);
}
</style>
