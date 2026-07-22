<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// types
import type { AgentType, Automation, Workspace } from '@/@types/index';

// utils
import { agentSelectedStyle, agentTypeLabel } from '@/utils/agentTypeMeta';

// -------------------------------------------------- Constants --------------------------------------------------

const intervalPresets = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '12 hours', value: 720 },
  { label: '24 hours (daily)', value: 1440 },
  { label: '7 days (weekly)', value: 10080 }
];

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
  /** Automation being edited; null/undefined means create mode. */
  automation?: Automation | null;
  workspaces: Workspace[];
  /** Whether Claude can be used (CLI available and token configured). */
  claudeAvailable?: boolean;
  /** Whether Cursor can be used (authenticated). */
  cursorAvailable?: boolean;
  /** Whether Mistral Vibe can be used (CLI on PATH and API key in `~/.vibe/.env`). */
  mistralVibeAvailable?: boolean;
  /** Whether OpenCode can be used (CLI on PATH and ACP server available). */
  openCodeAvailable?: boolean;
  /** Whether Codex can be used. */
  codexAvailable?: boolean;
  bSaving?: boolean;
  /** Server-side error from the last save attempt, shown inside the dialog. */
  serverError?: string | null;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [
    payload: {
      name: string;
      workspaceId: string;
      agentType: AgentType;
      intervalMinutes: number;
      prompt: string;
      enabled: boolean;
    }
  ];
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const name = ref('');
const workspaceId = ref('');
const agentType = ref<AgentType>('cursor-agent');
const intervalMinutes = ref(60);
const prompt = ref('');
const bEnabled = ref(true);
const validationError = ref<string | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const bIsEdit = computed(() => props.automation != null);
const modalEyebrow = computed(() => (bIsEdit.value ? '// edit automation' : '// new automation'));
const modalTitle = computed(() => (bIsEdit.value ? 'Edit automation' : 'New automation'));
const submitLabel = computed(() => (bIsEdit.value ? 'Save' : 'Create'));

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

const displayedError = computed(() => validationError.value || props.serverError);

const bSubmitDisabled = computed(
  () =>
    Boolean(props.bSaving) ||
    !name.value.trim() ||
    !prompt.value.trim() ||
    (!bIsEdit.value && !workspaceId.value)
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
  if (isAgentAvailable('cursor-agent')) {
    return 'cursor-agent';
  }
  for (const fallbackAgentType of AGENT_FALLBACK_ORDER) {
    if (isAgentAvailable(fallbackAgentType)) {
      return fallbackAgentType;
    }
  }
  return availableAgents.value[0] ?? 'cursor-agent';
}

function selectAgentType(agent: AgentType): void {
  if (isAgentAvailable(agent)) {
    agentType.value = agent;
  }
}

const close = (): void => {
  if (!props.bSaving) {
    emit('update:modelValue', false);
  }
};

const onSave = (): void => {
  if (props.bSaving) {
    return;
  }
  validationError.value = null;
  if (!name.value.trim()) {
    validationError.value = 'Name is required';
    return;
  }
  if (!bIsEdit.value && !workspaceId.value) {
    validationError.value = 'Workspace is required';
    return;
  }
  if (!prompt.value.trim()) {
    validationError.value = 'Prompt is required';
    return;
  }
  if (intervalMinutes.value < 1) {
    validationError.value = 'Interval must be at least 1 minute';
    return;
  }
  emit('save', {
    name: name.value.trim(),
    workspaceId: workspaceId.value,
    agentType: agentType.value,
    intervalMinutes: intervalMinutes.value,
    prompt: prompt.value.trim(),
    enabled: bEnabled.value
  });
};

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.modelValue,
  (bOpen) => {
    if (!bOpen) {
      return;
    }
    validationError.value = null;
    const automation = props.automation;
    if (automation) {
      name.value = automation.name;
      workspaceId.value = automation.workspaceId;
      agentType.value = automation.agentType;
      intervalMinutes.value = automation.intervalMinutes;
      prompt.value = automation.prompt;
      bEnabled.value = automation.enabled;
    } else {
      name.value = '';
      workspaceId.value = props.workspaces[0]?.id ?? '';
      agentType.value = computeInitialAgentType();
      intervalMinutes.value = 60;
      prompt.value = '';
      bEnabled.value = true;
    }
  }
);
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="automation-form-title"
    panel-class="max-w-md"
    @update:model-value="close"
  >
    <!-- Panel -->
    <form class="contents" @submit.prevent="onSave">
      <ModalHeader
        :eyebrow="modalEyebrow"
        :title="modalTitle"
        title-id="automation-form-title"
        @close="close"
      />

      <div class="px-6 flex flex-col gap-4 pb-5 pt-4">
        <!-- Name -->
        <div class="nc-field">
          <label class="nc-field-label" for="automation-form-name">Name</label>
          <input
            id="automation-form-name"
            v-model="name"
            type="text"
            placeholder="e.g. Daily security audit"
            data-modal-autofocus
            :disabled="bSaving"
          />
        </div>

        <!-- Workspace (create only — not editable afterwards) -->
        <div v-if="!bIsEdit" class="nc-field">
          <label class="nc-field-label" for="automation-form-workspace">Workspace</label>
          <select id="automation-form-workspace" v-model="workspaceId" :disabled="bSaving">
            <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>

        <!-- Agent selection -->
        <div class="nc-field">
          <span class="nc-field-label">Agent</span>
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
              :disabled="bSaving"
              @click="selectAgentType(agent)"
            >
              {{ agentTypeLabel(agent) }}
            </button>
          </div>
          <p v-if="availableAgents.length === 0" class="text-[11px] text-warning">
            No agents available. Configure an agent in Settings.
          </p>
        </div>

        <!-- Interval -->
        <div class="nc-field">
          <label class="nc-field-label" for="automation-form-interval">Interval</label>
          <select id="automation-form-interval" v-model="intervalMinutes" :disabled="bSaving">
            <option v-for="p in intervalPresets" :key="p.value" :value="p.value">
              {{ p.label }}
            </option>
          </select>
        </div>

        <!-- Prompt -->
        <div class="nc-field">
          <label class="nc-field-label" for="automation-form-prompt">Prompt</label>
          <textarea
            id="automation-form-prompt"
            v-model="prompt"
            rows="4"
            placeholder="Describe what the agent should do each time it runs…"
            :disabled="bSaving"
          />
        </div>

        <p
          v-if="displayedError"
          class="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2"
        >
          {{ displayedError }}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-end gap-2 px-6 pb-5">
        <label class="flex items-center gap-2 cursor-pointer mr-auto">
          <input v-model="bEnabled" type="checkbox" class="accent-primary w-4 h-4" :disabled="bSaving" />
          <span class="text-sm text-text-muted">Enabled</span>
        </label>
        <button type="button" class="button" :disabled="bSaving" @click="close">Cancel</button>
        <button type="submit" class="button is-primary" :disabled="bSubmitDisabled">
          <div
            v-if="bSaving"
            class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
          />
          {{ submitLabel }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>
