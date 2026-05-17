<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import TagChipsInput from '@/components/input/TagChipsInput.vue';

// types
import type { AgentType } from '@/@types/index';

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
  /** Whether Claude can be used for new sessions (CLI available and token configured). */
  claudeAvailable?: boolean;
  /** Whether Cursor can be used for new sessions (authenticated). */
  cursorAvailable?: boolean;
  /** Whether Mistral Vibe can be used (CLI on PATH and API key in `~/.vibe/.env`). */
  mistralVibeAvailable?: boolean;
  /** Whether OpenCode can be used (CLI on PATH and ACP server available). */
  codexAvailable?: boolean;
  openCodeAvailable?: boolean;
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
    }
  ];
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const name = ref('');
const formTags = ref<string[]>([]);
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
  if (props.loading) {
    return;
  }
  const finalName = name.value.trim() || defaultName.value;
  const tags = formTags.value;
  emit('create', {
    name: finalName,
    ...(tags.length > 0 ? { tags } : {}),
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
      formTags.value = [];
      defaultName.value = `Session ${new Date().toLocaleString()}`;
      agentType.value = computeInitialAgentType();
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/75 backdrop-blur-sm" @click="close" />

        <!-- Panel -->
        <form
          class="modal-panel relative w-full max-w-sm bg-surface border border-fg/[0.09] rounded-2xl shadow-2xl shadow-black/60"
          @submit.prevent="onCreate"
        >
          <div class="px-6 pt-5 pb-4">
            <h2 id="new-session-title" class="font-semibold text-text-primary text-lg">
              New session
            </h2>
          </div>

          <div class="px-6 flex flex-col gap-4 pb-5">
            <!-- Name -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-text-muted">Name</label>
              <input
                v-model="name"
                type="text"
                :placeholder="defaultName"
                autofocus
                class="w-full text-sm px-3 py-3 rounded-lg border border-fg/[0.12] bg-fg/[0.04] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                @keydown.escape="close"
              />
            </div>

            <!-- Tags -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-text-muted"
                >Tags <span class="font-normal opacity-60">(optional)</span></label
              >
              <TagChipsInput
                v-model="formTags"
                :suggestions="existingTags ?? []"
                datalist-id="new-session-tag-suggestions"
                hint="Separate tags with a comma, or press Enter/Done. Suggestions from other sessions."
              />
            </div>

            <!-- Agent selection -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-text-muted">
                Agent
                <span class="font-normal opacity-60">(required)</span>
              </label>
              <div
                class="grid rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1"
                :class="gridColsClass"
              >
                <button
                  v-for="agent in availableAgents"
                  :key="agent"
                  type="button"
                  class="text-xs px-2 py-1.5 rounded-md transition-colors text-text-muted hover:text-text-primary hover:bg-fg/[0.06]"
                  :class="{ 'bg-primary text-white': agentType === agent }"
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

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 px-6 pb-5">
            <button
              type="button"
              class="px-4 py-2.5 text-sm text-text-muted hover:text-text-primary bg-fg/[0.04] hover:bg-fg/[0.08] border border-fg/[0.08] rounded-lg transition-all disabled:opacity-50"
              :disabled="loading"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
              :disabled="loading"
            >
              <div
                v-if="loading"
                class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
              />
              Create
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
