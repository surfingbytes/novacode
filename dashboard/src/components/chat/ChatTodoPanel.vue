<script setup lang="ts">
/**
 * Persistent todo panel for the chat tab — shows the agent's current todo list
 * (latest todowrite call, derived via useTodoList) instead of letting it scroll
 * away in the message stream. Two layouts:
 *  - 'strip': mobile — collapsible strip pinned above the composer; tapping the
 *    header toggles bi-state: collapsed (header + counter only) ↔ full list
 *  - 'panel': desktop — right-side column of the chat tab, always expanded;
 *    no collapse here, only closable (bClosable)
 */

// node_modules
import { computed } from 'vue';
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next';

// components
import TodoStatusIcon from '@/components/chat/TodoStatusIcon.vue';

// utils
import { getToolIconSvg, type TodoDisplayItem } from '@/utils/chatDisplayItems';

// types
import type { TodoPanelState } from '@/composables/useTodoList';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    todoItems: TodoDisplayItem[];
    doneCount: number;
    panelState: TodoPanelState;
    layout: 'strip' | 'panel';
    bRunning?: boolean;
    bClosable?: boolean;
  }>(),
  { bRunning: false, bClosable: false }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'close'): void;
}>();

// -------------------------------------------------- Constants --------------------------------------------------

const checklistSvg = getToolIconSvg('checklist');

// -------------------------------------------------- Computed --------------------------------------------------

/** Desktop sidebar never collapses — it's either open (full) or closed. */
const bExpanded = computed(() => props.layout === 'panel' || props.panelState === 'full');

// -------------------------------------------------- Methods --------------------------------------------------

function bDone(status: string): boolean {
  return status === 'TODO_STATUS_COMPLETED' || status === 'TODO_STATUS_CANCELLED';
}
</script>

<template>
  <div
    class="flex flex-col overflow-hidden"
    :class="
      layout === 'strip'
        ? 'chat-card mx-3 mb-2 rounded-lg shrink-0'
        : 'todo-panel-surface h-full min-h-0 border-l border-fg/10'
    "
  >
    <!-- Header — always visible; tap toggles collapsed ↔ full (strip only) -->
    <div
      class="flex items-center shrink-0"
      :class="bExpanded ? 'border-b border-fg/10' : ''"
    >
      <button
        type="button"
        class="flex flex-1 items-center gap-2 px-3 py-1.5 min-w-0"
        :class="layout === 'panel' ? 'cursor-default' : ''"
        @click="layout === 'strip' && emit('toggle')"
      >
        <span class="shrink-0 select-none text-text-muted" v-html="checklistSvg" />
        <span class="text-xs font-medium text-text-primary shrink-0">Tasks</span>
        <span class="ml-auto flex items-center gap-1.5 shrink-0">
          <svg
            v-if="bRunning"
            class="animate-spin text-primary select-none"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
          <span v-else class="text-xs text-text-muted">{{ doneCount }}/{{ todoItems.length }}</span>
          <template v-if="layout === 'strip'">
            <ChevronUp v-if="panelState === 'collapsed'" :size="13" class="text-text-muted" />
            <ChevronDown v-else :size="13" class="text-text-muted" />
          </template>
        </span>
      </button>
      <button
        v-if="bClosable"
        type="button"
        class="shrink-0 px-2.5 py-1.5 text-text-muted hover:text-text-primary transition-colors"
        aria-label="Close tasks panel"
        @click.stop="emit('close')"
      >
        <X :size="13" />
      </button>
    </div>

    <!-- Body -->
    <ul
      v-if="bExpanded"
      class="px-3 py-1.5 space-y-1"
      :class="layout === 'panel' ? 'flex-1 min-h-0 overflow-y-auto' : 'max-h-[45vh] overflow-y-auto'"
    >
      <li v-for="todo in todoItems" :key="todo.id" class="flex items-start gap-2 text-xs">
        <TodoStatusIcon :status="todo.status" />
        <span
          class="leading-snug"
          :class="bDone(todo.status) ? 'text-text-muted line-through' : 'text-text-primary'"
          >{{ todo.content }}</span
        >
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* Same flat second-level surface as the chat cards (scoped copies per component). */
.chat-card {
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
}
.todo-panel-surface {
  background: var(--bg-elev-2);
}
</style>
