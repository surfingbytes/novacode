<script setup lang="ts">
// utils
import { agentSelectedStyle, agentTypeLabel } from '@/utils/agentTypeMeta';

// types
import type { AgentType } from '@/@types/index';
import type { SessionListFilter, SessionListStatusFilter } from '@/utils/sessionListFilter';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  modelValue: SessionListFilter;
  tags: string[];
  agentTypes: AgentType[];
  counts: { busy: number; unread: number; idle: number };
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  'update:modelValue': [filter: SessionListFilter];
}>();

// -------------------------------------------------- Data --------------------------------------------------
const statusOptions: Array<{ value: SessionListStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'busy', label: 'Busy' },
  { value: 'unread', label: 'Unread' },
  { value: 'idle', label: 'Idle' }
];
const activeChipClass = 'bg-primary/15 text-primary border-primary/30';
const inactiveChipClass = 'border-border text-text-muted hover:text-text-primary';

// -------------------------------------------------- Methods --------------------------------------------------
function update(patch: Partial<SessionListFilter>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch });
}

function statusCount(status: SessionListStatusFilter): number | null {
  if (status === 'all') {
    return null;
  }
  return props.counts[status];
}

function onTextInput(event: Event): void {
  update({ text: (event.target as HTMLInputElement).value });
}

function clearText(): void {
  update({ text: '' });
}

function toggleAgentType(agentType: AgentType): void {
  update({ agentType: props.modelValue.agentType === agentType ? null : agentType });
}

function toggleTag(tag: string): void {
  update({ tag: props.modelValue.tag === tag ? null : tag });
}
</script>

<template>
  <div class="flex flex-col gap-2 mb-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:w-64">
        <input
          :value="modelValue.text"
          type="text"
          class="input w-full pr-8"
          placeholder="Filter sessions"
          aria-label="Filter sessions by name or tag"
          @input="onTextInput"
          @keydown.esc.prevent="clearText"
        />
        <button
          v-if="modelValue.text"
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
          aria-label="Clear text filter"
          @click="clearText"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        <button
          v-for="option in statusOptions"
          :key="option.value"
          type="button"
          class="text-xs px-2.5 py-1 rounded-full border transition-colors"
          :class="modelValue.status === option.value ? activeChipClass : inactiveChipClass"
          :aria-pressed="modelValue.status === option.value"
          @click="update({ status: option.value })"
        >
          {{ option.label }}
          <span v-if="statusCount(option.value) !== null" class="tabular-nums opacity-70">
            {{ statusCount(option.value) }}
          </span>
        </button>
      </div>
    </div>

    <div
      v-if="agentTypes.length >= 2"
      class="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Filter by agent"
    >
      <span class="text-xs text-text-muted shrink-0">Agent</span>
      <button
        type="button"
        class="text-xs px-2.5 py-1 rounded-full border transition-colors"
        :class="modelValue.agentType === null ? activeChipClass : inactiveChipClass"
        :aria-pressed="modelValue.agentType === null"
        @click="update({ agentType: null })"
      >
        All
      </button>
      <button
        v-for="agentType in agentTypes"
        :key="agentType"
        type="button"
        class="text-xs px-2.5 py-1 rounded-full border transition-colors"
        :class="modelValue.agentType === agentType ? '' : inactiveChipClass"
        :style="modelValue.agentType === agentType ? agentSelectedStyle(agentType) : undefined"
        :aria-pressed="modelValue.agentType === agentType"
        @click="toggleAgentType(agentType)"
      >
        {{ agentTypeLabel(agentType) }}
      </button>
    </div>

    <div v-if="tags.length > 0" class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-text-muted shrink-0">Tags</span>
      <button
        type="button"
        class="text-xs px-2.5 py-1 rounded-full border transition-colors"
        :class="modelValue.tag === null ? activeChipClass : inactiveChipClass"
        @click="update({ tag: null })"
      >
        All
      </button>
      <button
        v-for="tag in tags"
        :key="tag"
        type="button"
        class="text-xs px-2.5 py-1 rounded-full border transition-colors"
        :class="modelValue.tag === tag ? activeChipClass : inactiveChipClass"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
    </div>
  </div>
</template>
