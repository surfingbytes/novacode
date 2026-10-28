<script setup lang="ts">
/**
 * Status rows between the message list and the composer: socket connection
 * indicator, the chip that reopens a closed todo panel (wide layout) and the
 * background-subagent progress line. Extracted from SessionChat.vue.
 */
// classes
import { getToolIconSvg } from '@/utils/chatDisplayItems';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  bWsConnected: boolean;
  bWsReconnecting: boolean;
  /** Wide layout with the todo panel closed — show the reopen chip. */
  bShowTodoChip: boolean;
  todoDoneCount: number;
  todoCount: number;
  /** Background tasks still running during a stream, or null when idle. */
  busySubagents: { running: number; total: number } | null;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'open-todo-panel'): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const todoChecklistSvg = getToolIconSvg('checklist');
</script>

<template>
  <!-- Connection indicator (initial connect and reconnects) -->
  <div v-if="!bWsConnected" class="flex justify-center py-1.5 shrink-0">
    <span class="text-xs text-text-muted flex items-center gap-1.5">
      <span
        class="w-3 h-3 border border-text-muted/40 border-t-text-muted rounded-full animate-spin inline-block"
      ></span>
      {{ bWsReconnecting ? 'Reconnecting…' : 'Connecting…' }}
    </span>
  </div>

  <!-- Wide: reopen chip when the todo panel is closed -->
  <div v-if="bShowTodoChip" class="flex justify-end px-4 pb-1 shrink-0">
    <button
      type="button"
      class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-fg/15 bg-fg/[0.02] text-xs text-text-muted hover:text-text-primary transition-colors"
      @click="emit('open-todo-panel')"
    >
      <span class="select-none" v-html="todoChecklistSvg" />
      Tasks {{ todoDoneCount }}/{{ todoCount }}
    </button>
  </div>

  <div
    v-if="busySubagents"
    class="flex items-center gap-2 px-4 pb-1 text-xs text-text-muted shrink-0"
    role="status"
    aria-live="polite"
  >
    <span
      class="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin shrink-0"
    />
    Background tasks {{ busySubagents.running }}/{{ busySubagents.total }} still running
  </div>
</template>
