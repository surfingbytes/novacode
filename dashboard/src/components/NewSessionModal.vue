<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import TagChipsInput from '@/components/input/TagChipsInput.vue';
import AgentModelPicker from '@/components/AgentModelPicker.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// classes
import { settingsApi } from '@/classes/api';

// types
import type { AgentModelOption, AgentType, LinkedPlanContext } from '@/@types/index';

// utils
import { agentSelectedStyle } from '@/utils/agentTypeMeta';

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
  error?: string | null;
  /** Tag suggestions from existing sessions in the workspace. */
  existingTags?: string[];
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
    }
  ];
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const name = ref('');
const formTags = ref<string[]>([]);
const defaultName = ref('');
const agentType = ref<AgentType>('cursor-agent');
const modelSelection = ref('');
const modelOptions = ref<AgentModelOption[]>([]);
const bLoadingModels = ref(false);

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

const gridColsClass = computed(() => `grid-cols-${Math.min(availableAgents.value.length, 3)}`);
const modalTitle = computed(() => props.title ?? 'New session');
const modalEyebrow = computed(() => (props.title ? `// ${props.title.toLowerCase()}` : '// new session'));
const createLabel = computed(() => props.submitLabel ?? 'Create');

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
  const finalName = name.value.trim() || defaultName.value;
  const tags = formTags.value;
  emit('create', {
    name: finalName,
    ...(tags.length > 0 ? { tags } : {}),
    agentType: agentType.value,
    ...(props.showModelSelection && modelSelection.value ? { modelSelection: modelSelection.value } : {})
  });
};

function selectAgentType(agent: AgentType): void {
  if (isAgentAvailable(agent)) {
    agentType.value = agent;
  }
}

async function loadModelOptions(): Promise<void> {
  if (!props.showModelSelection) {
    modelOptions.value = [];
    return;
  }
  bLoadingModels.value = true;
  try {
    const { data } = await settingsApi.getAgentOptions(agentType.value);
    modelOptions.value = data.models.length > 0
      ? data.models
      : [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }];
    if (modelSelection.value && !modelOptions.value.some((option) => option.id === modelSelection.value)) {
      modelSelection.value = '';
    }
  } catch {
    modelOptions.value = [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }];
  } finally {
    bLoadingModels.value = false;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      formTags.value = [];
      defaultName.value = props.defaultSessionName || `Session ${new Date().toLocaleString()}`;
      // Prefill only when a suggested name is provided (e.g. plan handoff);
      // otherwise keep the datetime as placeholder so the user can type a fresh name.
      name.value = props.defaultSessionName?.trim() ? defaultName.value : '';
      agentType.value = computeInitialAgentType();
      modelSelection.value = props.defaultModelSelection ?? '';
      void loadModelOptions();
    }
  }
);

watch(agentType, () => {
  if (props.modelValue && props.showModelSelection) {
    modelSelection.value = '';
    void loadModelOptions();
  }
});
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="new-session-title"
    panel-class="max-w-sm"
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
          <div v-if="helperText" class="px-6 pt-2">
            <p class="text-xs text-text-muted">{{ helperText }}</p>
          </div>

          <div class="px-6 flex flex-col gap-4 pb-5">
            <!-- Name -->
            <div class="nc-field">
              <label class="nc-field-label" for="new-session-name">Name</label>
              <input
                id="new-session-name"
                v-model="name"
                type="text"
                :placeholder="defaultName"
                data-modal-autofocus
                @keydown.escape="close"
              />
            </div>

            <!-- Tags -->
            <div class="nc-field">
              <span class="nc-field-label"
                >Tags <span class="normal-case opacity-60">(optional)</span></span
              >
              <TagChipsInput
                v-model="formTags"
                :suggestions="existingTags ?? []"
                datalist-id="new-session-tag-suggestions"
                hint="Separate tags with a comma, or press Enter/Done. Suggestions from other sessions."
              />
            </div>

            <!-- Agent selection -->
            <div class="nc-field">
              <span class="nc-field-label">
                Agent
                <span class="normal-case opacity-60">(required)</span>
              </span>
              <div
                class="grid rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1"
                :class="gridColsClass"
              >
                <button
                  v-for="agent in availableAgents"
                  :key="agent"
                  type="button"
                  class="text-xs px-2 py-1.5 rounded-md border border-transparent transition-colors text-text-muted hover:text-text-primary hover:bg-fg/[0.06]"
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
              <p v-if="availableAgents.length === 0" class="text-[11px] text-warning">
                No agents available. Configure Cursor, Mistral Vibe, or Claude in Settings.
              </p>
            </div>

            <!-- Model selection -->
            <div v-if="showModelSelection" class="nc-field">
              <span class="nc-field-label">
                Model
              </span>
              <AgentModelPicker
                v-model="modelSelection"
                :agent-type="agentType"
                :model-options="modelOptions"
                :disabled="loading || bLoadingModels"
                variant="modal"
              />
            </div>

            <p v-if="error" class="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {{ error }}
            </p>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 px-6 pb-5">
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
