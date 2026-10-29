<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ChevronDown } from 'lucide-vue-next';

// types
import type { OrchestratorRunMode } from '@/@types/index';
import type { RunChoice } from '@/composables/useOrchestratorRunState';

/** Run button with the preferred mode plus a menu of the other run choices. Extracted from OrchestratorPanel.vue. */

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  preferredRunMode: OrchestratorRunMode;
  maxParallel: number;
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

const runChoices = computed<{ id: RunChoice; label: string; hint: string }[]>(() => [
  { id: 'sequential', label: 'Run one by one', hint: 'Every step in the workspace, in order' },
  {
    id: 'parallel',
    label: 'Run in parallel',
    hint: `Up to ${props.maxParallel} at once, each in its own git worktree; merged back automatically. Done steps are kept`
  },
  { id: 'parallel-fresh', label: 'Run all again in parallel', hint: 'Like Run in parallel, but done steps run again too' },
  { id: 'next', label: 'Run next step', hint: 'Only the first step that is ready' }
]);
const mainRunLabel = computed(() => (props.preferredRunMode === 'parallel' ? 'Run in parallel' : 'Run one by one'));

// -------------------------------------------------- Methods --------------------------------------------------

function run(choice: RunChoice): void {
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
        @click="run(preferredRunMode)"
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
        class="w-full px-3 py-2 text-left hover:bg-fg/[0.06] transition-colors"
        role="menuitem"
        @click="run(choice.id)"
      >
        <span class="block text-sm text-text-primary">{{ choice.label }}</span>
        <span class="block text-xs text-text-muted">{{ choice.hint }}</span>
      </button>
    </div>
  </div>
</template>
