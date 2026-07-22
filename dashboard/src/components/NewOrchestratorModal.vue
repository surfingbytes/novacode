<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// types
import type { AgentType } from '@/@types/index';

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
  defaultAgentType?: AgentType | null;
  /** Whether Claude can be used for new orchestrators (CLI available and token configured). */
  claudeAvailable?: boolean;
  /** Whether Cursor can be used for new orchestrators (authenticated). */
  cursorAvailable?: boolean;
  /** Whether Mistral Vibe can be used (CLI on PATH and API key configured). */
  mistralVibeAvailable?: boolean;
  /** Whether OpenCode can be used (CLI on PATH and ACP server available). */
  codexAvailable?: boolean;
  openCodeAvailable?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  create: [payload: { name: string; tags?: string | null; agentType?: AgentType }];
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const name = ref('');
const tags = ref('');
const defaultName = ref('');
const agentType = ref<AgentType>('cursor-agent');

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

const bCanCreate = computed(() => availableAgents.value.length > 0);

const gridColsClass = computed(() => `grid-cols-${Math.min(availableAgents.value.length, 3)}`);

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
  if (props.loading || !bCanCreate.value) {
    return;
  }
  const finalName = name.value.trim() || defaultName.value;
  const normalizedTags = tags.value.trim() || null;
  emit('create', {
    name: finalName,
    ...(normalizedTags ? { tags: normalizedTags } : {}),
    agentType: agentType.value
  });
};

function selectAgentType(agent: AgentType): void {
  if (isAgentAvailable(agent)) {
    agentType.value = agent;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = '';
      defaultName.value = `Task plan ${new Date().toLocaleString()}`;
      tags.value = '';
      agentType.value = computeInitialAgentType();
    }
  }
);
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="new-orchestrator-title"
    panel-class="max-w-sm"
    @update:model-value="close"
  >
    <form class="contents" @submit.prevent="onCreate">
          <ModalHeader
            eyebrow="// new orchestrator"
            title="New orchestrator"
            title-id="new-orchestrator-title"
            @close="close"
          />

          <div class="px-6 flex flex-col gap-4 pb-5">
            <div class="nc-field">
              <label class="nc-field-label" for="new-orchestrator-name">Name</label>
              <input
                id="new-orchestrator-name"
                v-model="name"
                type="text"
                :placeholder="defaultName"
                data-modal-autofocus
                @keydown.escape="close"
              />
            </div>

            <div class="nc-field">
              <label class="nc-field-label" for="new-orchestrator-tags">
                Tags <span class="normal-case opacity-60">(optional)</span>
              </label>
              <input
                id="new-orchestrator-tags"
                v-model="tags"
                type="text"
                placeholder="e.g. Flow, Refactor…"
                @keydown.escape="close"
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
          </div>

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
              :disabled="loading || !bCanCreate"
            >
              <div
                v-if="loading"
                class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
              />
              Create
            </button>
          </div>
    </form>
  </BaseModal>
</template>
