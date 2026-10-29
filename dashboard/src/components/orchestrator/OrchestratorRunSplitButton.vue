<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ChevronDown } from 'lucide-vue-next';

// types
import type { OrchestratorRunMode } from '@/@types/index';
import type { RunChoice } from '@/composables/useOrchestratorRunState';

/**
 * Run button with the preferred mode plus a menu of the other run choices.
 * While `parallelBlockedReason` is set the parallel choices are disabled and the main button falls back to
 * one by one. Extracted from OrchestratorPanel.vue.
 */

// -------------------------------------------------- Types --------------------------------------------------

interface RunChoiceItem {
  id: RunChoice;
  label: string;
  hint: string;
  bDisabled: boolean;
}

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  preferredRunMode: OrchestratorRunMode;
  maxParallel: number;
  /** Why a parallel run cannot start (null = it can) */
  parallelBlockedReason: string | null;
  bDisabled: boolean;
  bStartingRun: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'run', choice: RunChoice): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const bRunMenuOpen = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------

const bParallelBlocked = computed(() => typeof props.parallelBlockedReason === 'string');

const runChoices = computed<RunChoiceItem[]>(() => {
  const parallelHint = (hint: string) => (bParallelBlocked.value ? (props.parallelBlockedReason as string) : hint);
  return [
    { id: 'sequential', label: 'Run one by one', hint: 'Steps in the workspace, in order; done steps are kept', bDisabled: false },
    {
      id: 'parallel',
      label: 'Run in parallel',
      hint: parallelHint(
        `Up to ${props.maxParallel} at once, each in its own git worktree; merged back automatically. Done steps are kept`
      ),
      bDisabled: bParallelBlocked.value
    },
    { id: 'next', label: 'Run next step', hint: 'Only the first step that is ready', bDisabled: false },
    { id: 'sequential-fresh', label: 'Run all again one by one', hint: 'Every step runs again, done ones too', bDisabled: false },
    {
      id: 'parallel-fresh',
      label: 'Run all again in parallel',
      hint: parallelHint('Every step runs again, done ones too'),
      bDisabled: bParallelBlocked.value
    }
  ];
});
/** Main button choice: the preferred mode unless parallel is blocked */
const mainRunChoice = computed<RunChoice>(() =>
  props.preferredRunMode === 'parallel' && !bParallelBlocked.value ? 'parallel' : 'sequential'
);
const mainRunLabel = computed(() => (mainRunChoice.value === 'parallel' ? 'Run in parallel' : 'Run one by one'));

// -------------------------------------------------- Methods --------------------------------------------------

function run(choice: RunChoice): void {
  if (runChoices.value.find((item) => item.id === choice)?.bDisabled) {
    return;
  }
  bRunMenuOpen.value = false;
  emit('run', choice);
}

function closeRunMenu(): void {
  bRunMenuOpen.value = false;
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  document.addEventListener('click', closeRunMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeRunMenu);
});
</script>

<template>
  <div class="relative">
    <div class="inline-flex items-stretch rounded-lg overflow-hidden btn-primary-solid">
      <button
        type="button"
        class="px-4 py-2.5 text-sm font-medium disabled:opacity-40 transition-opacity flex items-center gap-2"
        :disabled="bDisabled || bStartingRun"
        @click="run(mainRunChoice)"
      >
        <span
          v-if="bStartingRun"
          class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
        />
        {{ bStartingRun ? 'Starting…' : mainRunLabel }}
      </button>
      <button
        type="button"
        class="px-2 border-l border-white/20 disabled:opacity-40"
        aria-haspopup="true"
        :aria-expanded="bRunMenuOpen"
        aria-label="Run options"
        title="Run options"
        :disabled="bDisabled || bStartingRun"
        @click.stop="bRunMenuOpen = !bRunMenuOpen"
      >
        <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>
    <div
      v-if="bRunMenuOpen"
      class="absolute right-0 bottom-full mb-1 z-50 w-72 rounded-lg border border-border bg-surface py-1 shadow-lg"
      role="menu"
      @click.stop
    >
      <button
        v-for="choice in runChoices"
        :key="choice.id"
        type="button"
        class="w-full px-3 py-2 text-left transition-colors"
        :class="choice.bDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-fg/[0.06]'"
        role="menuitem"
        :disabled="choice.bDisabled"
        :aria-disabled="choice.bDisabled"
        @click="run(choice.id)"
      >
        <span class="block text-sm" :class="choice.bDisabled ? 'text-text-muted' : 'text-text-primary'">{{ choice.label }}</span>
        <span class="block text-xs text-text-muted">{{ choice.hint }}</span>
      </button>
    </div>
  </div>
</template>
